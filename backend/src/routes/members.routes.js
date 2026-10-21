const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

// Perfis que podem enxergar/gerir a base de membros (mesmo escopo do Gerenciar).
const MANAGERS = ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao'];

function requireManager(req, res, next) {
  if (!MANAGERS.includes(req.user.role)) return next(httpError(403, 'Acesso restrito à liderança'));
  next();
}

// O coletor também cadastra no balcão (dados parciais); sede/setor/congregação
// enxergam e editam a base completa.
const CAN_REGISTER = ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao', 'coletor'];

function requireRegister(req, res, next) {
  if (!CAN_REGISTER.includes(req.user.role)) return next(httpError(403, 'Sem permissão para cadastrar pessoas'));
  next();
}

// Escopo de leitura: sede vê tudo; setor vê o seu setor; congregação vê a sua.
function memberWhere(user, base = {}) {
  const where = { role: 'membro', ...base };
  if (user.role === 'sede') return where;
  if (user.role === 'tesoureiro_setor') return { ...where, sectorId: user.sectorId };
  if (user.role === 'tesoureiro_congregacao') return { ...where, congregationId: user.congregationId };
  return { ...where, id: -1 };
}

function serializeMember(u, totals = null) {
  const complete = !!(u.name && u.cpf && u.cep && u.addressNumber && u.phone);
  return {
    id: u.id,
    name: u.name,
    memberCode: u.memberCode ?? null,
    email: u.email,
    phone: u.phone ?? null,
    cpf: u.cpf ?? null,
    cep: u.cep ?? null,
    addressNumber: u.addressNumber ?? null,
    role: u.role,
    sectorId: u.sectorId ?? null,
    congregationId: u.congregationId ?? null,
    sectorName: u.sector?.name ?? null,
    congregationCode: u.congregation?.code ?? null,
    congregationName: u.congregation?.name ?? null,
    profileComplete: complete,
    hasLogin: !!u.profileCompletedAt,
    verified: !!u.emailVerifiedAt,
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
    totals: totals || { count: 0, total: 0, dizimo: 0, oferta: 0, lastDate: null },
  };
}

// Agrega a contribuição por pessoa: prefere o vínculo por ID (personUserId),
// caindo para o código de membro em recibos antigos (gravados só por texto).
async function totalsByMember(members) {
  const byId = new Map(members.map((m) => [m.id, { count: 0, total: 0, dizimo: 0, oferta: 0, lastDate: null }]));
  const byCode = new Map(members.filter((m) => m.memberCode).map((m) => [m.memberCode, m.id]));
  if (!members.length) return byId;

  const rows = await prisma.receipt.findMany({
    where: {
      status: { not: 'pendente' },
      OR: [
        { personUserId: { in: members.map((m) => m.id) } },
        { personMemberCode: { in: members.map((m) => m.memberCode).filter(Boolean) } },
      ],
    },
    select: { personUserId: true, personMemberCode: true, type: true, value: true, date: true },
  });

  for (const r of rows) {
    const id = r.personUserId || byCode.get(r.personMemberCode);
    const t = id ? byId.get(id) : null;
    if (!t) continue;
    const v = Number(r.value);
    t.count += 1;
    t.total += v;
    if ((r.type || '').startsWith('Dízimo')) t.dizimo += v;
    else if ((r.type || '').startsWith('Oferta')) t.oferta += v;
    if (!t.lastDate || new Date(r.date) > new Date(t.lastDate)) {
      t.lastDate = r.date instanceof Date ? r.date.toISOString() : r.date;
    }
  }
  return byId;
}

// ---- Lista de membros (com busca, filtros e totais de contribuição) ----
router.get('/', requireManager, async (req, res, next) => {
  try {
    const { search, sectorId, congregationId, status, sort } = req.query;
    const where = memberWhere(req.user);

    if (search) {
      const q = String(search).trim();
      const digits = q.replace(/\D/g, '');
      where.AND = [
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { memberCode: { contains: q, mode: 'insensitive' } },
            ...(digits.length >= 3 ? [{ cpf: { contains: digits } }] : []),
            ...(digits.length >= 8 ? [{ phone: { contains: digits } }] : []),
          ],
        },
      ];
    }
    if (sectorId && req.user.role === 'sede') where.sectorId = Number(sectorId);
    if (congregationId && (req.user.role === 'sede' || req.user.role === 'tesoureiro_setor')) {
      where.congregationId = Number(congregationId);
    }
    if (status === 'complete' || status === 'incomplete') {
      // "completo" = tem perfil preenchido no autocadastro (profileCompletedAt).
      if (status === 'complete') where.profileCompletedAt = { not: null };
      else where.profileCompletedAt = null;
    }

    const members = await prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { sector: true, congregation: true },
    });
    const totals = await totalsByMember(members);
    let list = members.map((m) => serializeMember(m, totals.get(m.id)));

    if (sort === 'total') list.sort((a, b) => b.totals.total - a.totals.total);
    else if (sort === 'recent') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      members: list,
      summary: {
        count: list.length,
        complete: list.filter((m) => m.profileComplete).length,
        incomplete: list.filter((m) => !m.profileComplete).length,
        contributors: list.filter((m) => m.totals.count > 0).length,
        total: list.reduce((s, m) => s + m.totals.total, 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

// ---- Detalhe de um membro + histórico de contribuições ----
router.get('/:id', requireManager, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');

    const member = await prisma.user.findFirst({
      where: memberWhere(req.user, { id }),
      include: { sector: true, congregation: true },
    });
    if (!member) throw httpError(404, 'Membro não encontrado');

    const receipts = await prisma.receipt.findMany({
      where: {
        status: { not: 'pendente' },
        OR: [
          { personUserId: id },
          ...(member.memberCode ? [{ personMemberCode: member.memberCode }] : []),
        ],
      },
      orderBy: { date: 'desc' },
      take: 200,
    });

    const totals = { count: 0, total: 0, dizimo: 0, oferta: 0, lastDate: null };
    for (const r of receipts) {
      const v = Number(r.value);
      totals.count += 1;
      totals.total += v;
      if ((r.type || '').startsWith('Dízimo')) totals.dizimo += v;
      else if ((r.type || '').startsWith('Oferta')) totals.oferta += v;
      if (!totals.lastDate) totals.lastDate = r.date instanceof Date ? r.date.toISOString() : r.date;
    }

    const { receipt: serializeReceipt } = require('../lib/serialize');
    res.json({ member: serializeMember(member, totals), receipts: receipts.map(serializeReceipt) });
  } catch (e) {
    next(e);
  }
});

// ---- Cadastro no balcão (coletor não cria usuário pela rota de usuários) ----
// Cria um membro com dados parciais, SEM login ativo (só é liberado quando o
// próprio membro completar o autocadastro com este código ADM).
const createSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
  sectorId: z.number().int().positive().optional().nullable(),
});

async function generateMemberCode() {
  for (let i = 0; i < 20; i++) {
    const code = 'ADM' + String(Math.floor(100000 + Math.random() * 899999));
    const exists = await prisma.user.findUnique({ where: { memberCode: code } });
    if (!exists) return code;
  }
  throw httpError(500, 'Não foi possível gerar código de membro');
}

router.post('/', requireRegister, async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const digits = (v) => String(v ?? '').replace(/\D/g, '');
    const cpf = input.cpf ? digits(input.cpf) : null;
    if (cpf && cpf.length !== 11) throw httpError(422, 'CPF inválido');
    const phone = input.phone ? digits(input.phone) : null;

    // Resolve setor/congregação dentro do escopo do ator.
    let sectorId = input.sectorId ?? req.user.sectorId ?? null;
    let congregationId = input.congregationId ?? req.user.congregationId ?? null;
    if (req.user.role === 'tesoureiro_setor' && congregationId) {
      const cong = await prisma.congregation.findUnique({ where: { id: congregationId } });
      if (!cong || cong.sectorId !== req.user.sectorId) throw httpError(403, 'Congregação fora do seu setor');
      sectorId = cong.sectorId;
    }
    if (req.user.role === 'tesoureiro_congregacao') {
      congregationId = req.user.congregationId;
      sectorId = req.user.sectorId;
    }
    if (congregationId) {
      const cong = await prisma.congregation.findUnique({ where: { id: congregationId } });
      if (!cong) throw httpError(400, 'Congregação não encontrada');
      sectorId = cong.sectorId;
    }

    if (cpf) {
      const dup = await prisma.user.findUnique({ where: { cpf } });
      if (dup) throw httpError(409, 'Já existe cadastro com este CPF');
    }

    const memberCode = await generateMemberCode();
    // E-mail placeholder (login desativado até o autocadastro) e senha aleatória.
    const email = `balcao+${memberCode.toLowerCase()}@adm.local`;
    const randomPassword = crypto.randomBytes(24).toString('hex');

    const member = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: input.name,
          role: 'membro',
          phone,
          cpf,
          sectorId,
          congregationId,
          memberCode,
          passwordHash: await bcrypt.hash(randomPassword, 10),
          profileCompletedAt: null,
        },
        include: { sector: true, congregation: true },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'member.create',
        entity: 'User',
        entityId: created.id,
        sectorId,
        congregationId,
        summary: `Cadastro de membro (balcão) ${created.name}`,
        after: { memberCode, name: created.name, phone, cpf },
      });
      return created;
    });

    res.status(201).json({ member: serializeMember(member) });
  } catch (e) {
    next(e);
  }
});

// ---- Edição dos dados de contato do membro ----
const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  cep: z.string().optional().nullable(),
  addressNumber: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
});

router.put('/:id', requireManager, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');
    const input = updateSchema.parse(req.body);

    const target = await prisma.user.findFirst({ where: memberWhere(req.user, { id }) });
    if (!target) throw httpError(404, 'Membro não encontrado');

    const digits = (v) => String(v ?? '').replace(/\D/g, '');
    const data = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) data.phone = input.phone ? digits(input.phone) : null;
    if (input.cpf !== undefined) {
      const cpf = input.cpf ? digits(input.cpf) : null;
      if (cpf && cpf.length !== 11) throw httpError(422, 'CPF inválido');
      if (cpf && cpf !== target.cpf) {
        const dup = await prisma.user.findUnique({ where: { cpf } });
        if (dup) throw httpError(409, 'Já existe cadastro com este CPF');
      }
      data.cpf = cpf;
    }
    if (input.cep !== undefined) data.cep = input.cep ? digits(input.cep) : null;
    if (input.addressNumber !== undefined) data.addressNumber = input.addressNumber || null;
    if (input.email !== undefined && input.email) {
      const email = input.email.toLowerCase();
      if (email !== target.email) {
        const dup = await prisma.user.findUnique({ where: { email } });
        if (dup) throw httpError(409, 'Já existe cadastro com este e-mail');
      }
      data.email = email;
    }
    if (input.congregationId !== undefined && req.user.role !== 'tesoureiro_congregacao') {
      if (input.congregationId) {
        const cong = await prisma.congregation.findUnique({ where: { id: input.congregationId } });
        if (!cong) throw httpError(400, 'Congregação não encontrada');
        if (req.user.role === 'tesoureiro_setor' && cong.sectorId !== req.user.sectorId) {
          throw httpError(403, 'Congregação fora do seu setor');
        }
        data.congregationId = cong.id;
        data.sectorId = cong.sectorId;
      } else {
        data.congregationId = null;
      }
    }

    if (!Object.keys(data).length) {
      return res.json({ member: serializeMember(await prisma.user.findUnique({ where: { id }, include: { sector: true, congregation: true } })) });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data, include: { sector: true, congregation: true } });
      await logAudit(tx, {
        user: req.user,
        action: 'member.update',
        entity: 'User',
        entityId: id,
        sectorId: u.sectorId,
        congregationId: u.congregationId,
        summary: `Edição de membro ${u.name}`,
        after: { name: u.name, phone: u.phone, cpf: u.cpf },
      });
      return u;
    });

    res.json({ member: serializeMember(updated) });
  } catch (e) {
    next(e);
  }
});

// ---- Exclusão de membro (somente sede) ----
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede pode excluir membros');
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');

    const target = await prisma.user.findFirst({ where: { id, role: 'membro' } });
    if (!target) throw httpError(404, 'Membro não encontrado');

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } });
      await logAudit(tx, {
        user: req.user,
        action: 'member.delete',
        entity: 'User',
        entityId: id,
        sectorId: target.sectorId,
        congregationId: target.congregationId,
        summary: `Exclusão de membro ${target.name}`,
        before: { memberCode: target.memberCode, name: target.name, cpf: target.cpf },
      });
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
