const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { publicUser } = require('../lib/serialize');
const { canCreateRole, needsSector, needsCongregation } = require('../lib/roles');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  role: z.enum(['sede', 'tesoureiro_setor', 'tesoureiro_congregacao', 'coletor', 'membro']),
  phone: z.string().optional().nullable(),
  sectorId: z.number().int().positive().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
  memberCode: z.string().optional().nullable(),
});

// E-mail é o identificador de login e não é editável pela UI.
const updateSchema = z.object({
  name: z.string().min(2).optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['sede', 'tesoureiro_setor', 'tesoureiro_congregacao', 'coletor', 'membro']).optional(),
  phone: z.string().optional().nullable(),
  sectorId: z.number().int().positive().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
});

function listWhere(user) {
  if (user.role === 'sede') return {};
  if (user.role === 'tesoureiro_setor') return { sectorId: user.sectorId };
  if (user.role === 'tesoureiro_congregacao') return { congregationId: user.congregationId };
  return { id: user.sub };
}

// Espelho da regra do front (canManageUser): só quem pode CRIAR um perfil
// pode editá-lo/excluí-lo, sempre dentro do próprio escopo e nunca a si mesmo.
function canManageTarget(actor, target) {
  if (!target) return false;
  if (target.id === actor.sub) return false;
  if (!canCreateRole(actor.role, target.role)) return false;
  if (actor.role === 'sede') return true;
  if (actor.role === 'tesoureiro_setor') return target.sectorId === actor.sectorId;
  if (actor.role === 'tesoureiro_congregacao') return target.congregationId === actor.congregationId;
  return false;
}

async function resolveAssignment(actor, input) {
  let sectorId = input.sectorId ?? null;
  let congregationId = input.congregationId ?? null;

  if (needsSector(input.role)) {
    if (actor.role === 'sede') {
      if (!sectorId) throw httpError(400, 'Informe o setor');
    } else {
      sectorId = actor.sectorId;
    }
    const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
    if (!sector) throw httpError(400, 'Setor não encontrado');
  } else {
    sectorId = null;
  }

  if (needsCongregation(input.role)) {
    if (actor.role === 'sede') {
      if (!congregationId) throw httpError(400, 'Informe a congregação');
    } else if (actor.role === 'tesoureiro_setor') {
      if (!congregationId) throw httpError(400, 'Informe a congregação');
    } else {
      congregationId = actor.congregationId;
    }
    const cong = await prisma.congregation.findUnique({ where: { id: congregationId } });
    if (!cong) throw httpError(400, 'Congregação não encontrada');
    if (sectorId && cong.sectorId !== sectorId) throw httpError(400, 'Congregação não pertence ao setor');
    sectorId = cong.sectorId;
  }

  return { sectorId, congregationId };
}

async function generateMemberCode() {
  for (let i = 0; i < 20; i++) {
    const code = 'ADM' + String(Math.floor(100000 + Math.random() * 899999));
    const exists = await prisma.user.findUnique({ where: { memberCode: code } });
    if (!exists) return code;
  }
  throw httpError(500, 'Não foi possível gerar código de membro');
}

function normalizePhone(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length < 10 || d.length > 11) throw httpError(422, 'Telefone inválido (DDD + número)');
  return d;
}

router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ where: listWhere(req.user), orderBy: { name: 'asc' } });
    res.json({ users: users.map(publicUser) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    if (!canCreateRole(req.user.role, input.role)) throw httpError(403, 'Você não pode cadastrar este perfil');

    const { sectorId, congregationId } = await resolveAssignment(req.user, input);
    let memberCode = input.memberCode ?? null;
    if (input.role === 'membro' && !memberCode) memberCode = await generateMemberCode();

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          role: input.role,
          phone: normalizePhone(input.phone) ?? null,
          sectorId,
          congregationId,
          memberCode,
          passwordHash: await bcrypt.hash(input.password, 10),
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'create',
        entity: 'User',
        entityId: created.id,
        sectorId,
        congregationId,
        summary: `Cadastro de usuário ${created.email}`,
        after: publicUser(created),
      });
      return created;
    });
    res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');
    const input = updateSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw httpError(404, 'Usuário não encontrado');
    if (!canManageTarget(req.user, target)) throw httpError(403, 'Usuário fora do seu escopo');

    const nextRole = input.role ?? target.role;
    if (input.role && input.role !== target.role && !canCreateRole(req.user.role, input.role)) {
      throw httpError(403, 'Você não pode alterar para este perfil');
    }

    const { sectorId, congregationId } = await resolveAssignment(req.user, {
      role: nextRole,
      sectorId: input.sectorId !== undefined ? input.sectorId : target.sectorId,
      congregationId: input.congregationId !== undefined ? input.congregationId : target.congregationId,
    });

    const data = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.password !== undefined) data.passwordHash = await bcrypt.hash(input.password, 10);
    if (input.phone !== undefined) data.phone = normalizePhone(input.phone) ?? null;
    if (nextRole !== target.role) data.role = nextRole;
    if (sectorId !== target.sectorId) data.sectorId = sectorId;
    if (congregationId !== target.congregationId) data.congregationId = congregationId;
    if (!Object.keys(data).length) return res.json({ user: publicUser(target) });

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data });
      await logAudit(tx, {
        user: req.user,
        action: 'update',
        entity: 'User',
        entityId: id,
        sectorId: updated.sectorId,
        congregationId: updated.congregationId,
        summary: `Edição de usuário ${updated.email}`,
        before: publicUser(target),
        after: publicUser(updated),
      });
      return updated;
    });
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

// Reset de senha pelo admin: gera senha temporária que o fiel troca no 1º acesso.
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw httpError(404, 'Usuário não encontrado');
    if (!canManageTarget(req.user, target)) throw httpError(403, 'Usuário fora do seu escopo');

    const temp = String(Math.floor(100000 + Math.random() * 900000));
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash: await bcrypt.hash(temp, 10),
          resetCodeHash: require('crypto').createHash('sha256').update(temp).digest('hex'),
          resetCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'reset-password',
        entity: 'User',
        entityId: id,
        sectorId: target.sectorId,
        congregationId: target.congregationId,
        summary: `Reset de senha de ${target.email}`,
        before: { email: target.email },
      });
    });
    res.json({ ok: true, temporaryPassword: temp });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw httpError(404, 'Usuário não encontrado');
    if (target.id === req.user.sub) throw httpError(400, 'Você não pode excluir a si mesmo');
    if (!canManageTarget(req.user, target)) throw httpError(403, 'Usuário fora do seu escopo');
    if (target.role === 'sede') {
      const others = await prisma.user.count({ where: { role: 'sede', id: { not: id } } });
      if (others < 1) throw httpError(409, 'Não é possível excluir o último usuário Sede');
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } });
      await logAudit(tx, {
        user: req.user,
        action: 'delete',
        entity: 'User',
        entityId: id,
        sectorId: target.sectorId,
        congregationId: target.congregationId,
        summary: `Exclusão de usuário ${target.email}`,
        before: publicUser(target),
      });
    });
    res.json({ ok: true, id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
