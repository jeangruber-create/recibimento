const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { sector: serializeSector } = require('../lib/serialize');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

const createSchema = z.object({ name: z.string().trim().min(2) });
const createCongSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(2),
  address: z.string().optional().nullable(),
});

function requireSede(req) {
  if (req.user.role !== 'sede') throw httpError(403, 'Somente a Tesouraria Sede gerencia setores e congregações');
}

// Criação/edição de congregações: sede em qualquer setor; tesoureiro de setor apenas no seu.
function canManageSectorStructure(req, sectorId) {
  if (req.user.role === 'sede') return;
  if (req.user.role === 'tesoureiro_setor' && req.user.sectorId === sectorId) return;
  throw httpError(403, 'Sem permissão para gerenciar congregações deste setor');
}

// Contagem de dados dependentes: só é permitido excluir estrutura sem movimento financeiro.
async function sectorCounts(id) {
  const s = await prisma.sector.findUnique({
    where: { id },
    include: { _count: { select: { users: true, receipts: true, expenses: true, closures: true, prestacoes: true, alerts: true, congregations: true } } },
  });
  if (!s) throw httpError(404, 'Setor não encontrado');
  return s;
}

function assertSectorEmpty(c) {
  const d = c._count;
  const busy = [];
  if (d.users) busy.push(`${d.users} usuário(s)`);
  if (d.receipts) busy.push(`${d.receipts} recibo(s)`);
  if (d.expenses) busy.push(`${d.expenses} despesa(s)`);
  if (d.closures) busy.push(`${d.closures} fechamento(s)`);
  if (d.prestacoes) busy.push(`${d.prestacoes} prestação(ões)`);
  if (d.alerts) busy.push(`${d.alerts} alerta(s)`);
  if (busy.length) throw httpError(409, `Setor com dados vinculados: ${busy.join(', ')}. Exclua ou transfira antes.`);
}

async function congregationCounts(cid) {
  const c = await prisma.congregation.findUnique({
    where: { id: cid },
    include: { _count: { select: { users: true, receipts: true, expenses: true } } },
  });
  if (!c) throw httpError(404, 'Congregação não encontrada');
  return c;
}

router.get('/', async (req, res, next) => {
  try {
    const where = req.user.role === 'sede' ? {} : { id: req.user.sectorId };
    const sectors = await prisma.sector.findMany({
      where,
      orderBy: { id: 'asc' },
      include: { congregations: { orderBy: { id: 'asc' } } },
    });
    res.json({ sectors: sectors.map(serializeSector) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');
    if (req.user.role !== 'sede' && id !== req.user.sectorId) throw httpError(403, 'Setor fora do seu escopo');
    const s = await prisma.sector.findUnique({
      where: { id },
      include: { congregations: { orderBy: { id: 'asc' } } },
    });
    if (!s) throw httpError(404, 'Setor não encontrado');
    res.json({ sector: serializeSector(s) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    requireSede(req);
    const { name } = createSchema.parse(req.body);

    const dup = await prisma.sector.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (dup) throw httpError(409, 'Setor já existe');

    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.sector.create({ data: { name } });
      await logAudit(tx, {
        user: req.user, action: 'create', entity: 'Sector', entityId: s.id,
        sectorId: s.id, summary: 'Cadastro de setor', after: { name },
      });
      return s;
    });
    res.status(201).json({ sector: serializeSector({ ...created, congregations: [] }) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    requireSede(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');
    const { name } = createSchema.parse(req.body);

    const before = await prisma.sector.findUnique({ where: { id }, include: { congregations: true } });
    if (!before) throw httpError(404, 'Setor não encontrado');

    const dup = await prisma.sector.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, id: { not: id } },
    });
    if (dup) throw httpError(409, 'Setor já existe');

    const s = await prisma.$transaction(async (tx) => {
      const updated = await tx.sector.update({ where: { id }, data: { name } });
      await logAudit(tx, {
        user: req.user, action: 'update', entity: 'Sector', entityId: id,
        sectorId: id, summary: `Rename do setor ${before.name} para ${name}`,
        before: { name: before.name }, after: { name },
      });
      return updated;
    });
    res.json({ sector: serializeSector({ ...s, congregations: before.congregations }) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    requireSede(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'ID inválido');
    const before = await sectorCounts(id);
    assertSectorEmpty(before);

    await prisma.$transaction(async (tx) => {
      // Congregações são estrutura do setor e vão junto (cascata).
      await tx.congregation.deleteMany({ where: { sectorId: id } });
      await tx.sector.delete({ where: { id } });
      await logAudit(tx, {
        user: req.user, action: 'delete', entity: 'Sector', entityId: id,
        sectorId: id, summary: `Exclusão do setor ${before.name}`,
        before: { name: before.name, congregations: before.congregations ?? undefined },
      });
    });
    res.json({ ok: true, id });
  } catch (e) {
    next(e);
  }
});

// ---------- Congregações (vinculadas a um setor) ----------

router.post('/:id/congregations', async (req, res, next) => {
  try {
    const sectorId = Number(req.params.id);
    if (!Number.isInteger(sectorId)) throw httpError(400, 'ID inválido');
    canManageSectorStructure(req, sectorId);
    const { code, name, address } = createCongSchema.parse(req.body);

    const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
    if (!sector) throw httpError(404, 'Setor não encontrado');

    const dup = await prisma.congregation.findFirst({
      where: { sectorId, code: { equals: code, mode: 'insensitive' } },
    });
    if (dup) throw httpError(409, 'Código já existe neste setor');

    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.congregation.create({ data: { sectorId, code, name, address: address || null } });
      await logAudit(tx, {
        user: req.user, action: 'create', entity: 'Congregation', entityId: c.id,
        sectorId, congregationId: c.id, summary: 'Cadastro de congregação',
        after: { code, name, address: address || null },
      });
      return c;
    });
    res.status(201).json({ congregation: { id: created.id, code: created.code, name: created.name, address: created.address || '' } });
  } catch (e) {
    next(e);
  }
});

router.put('/:id/congregations/:cid', async (req, res, next) => {
  try {
    const sectorId = Number(req.params.id);
    const cid = Number(req.params.cid);
    if (!Number.isInteger(sectorId) || !Number.isInteger(cid)) throw httpError(400, 'ID inválido');
    canManageSectorStructure(req, sectorId);
    const { code, name, address } = createCongSchema.parse(req.body);

    const existing = await prisma.congregation.findUnique({ where: { id: cid } });
    if (!existing) throw httpError(404, 'Congregação não encontrada');
    if (existing.sectorId !== sectorId) throw httpError(400, 'Congregação não pertence a este setor');

    const dup = await prisma.congregation.findFirst({
      where: { sectorId, code: { equals: code, mode: 'insensitive' }, NOT: { id: cid } },
    });
    if (dup) throw httpError(409, 'Código já existe neste setor');

    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.congregation.update({
        where: { id: cid },
        data: { code, name, address: address || null },
      });
      await logAudit(tx, {
        user: req.user, action: 'update', entity: 'Congregation', entityId: cid,
        sectorId, congregationId: cid, summary: `Alteração da congregação ${code} — ${name}`,
        before: { code: existing.code, name: existing.name, address: existing.address },
        after: { code, name, address: address || null },
      });
      return c;
    });
    res.json({ congregation: { id: updated.id, code: updated.code, name: updated.name, address: updated.address || '' } });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/congregations/:cid', async (req, res, next) => {
  try {
    requireSede(req);
    const sectorId = Number(req.params.id);
    const cid = Number(req.params.cid);
    if (!Number.isInteger(sectorId) || !Number.isInteger(cid)) throw httpError(400, 'ID inválido');

    const before = await congregationCounts(cid);
    if (before.sectorId !== sectorId) throw httpError(400, 'Congregação não pertence a este setor');

    const d = before._count;
    const busy = [];
    if (d.users) busy.push(`${d.users} usuário(s)`);
    if (d.receipts) busy.push(`${d.receipts} recibo(s)`);
    if (d.expenses) busy.push(`${d.expenses} despesa(s)`);
    if (busy.length) throw httpError(409, `Congregação com dados vinculados: ${busy.join(', ')}. Exclua ou transfira antes.`);

    await prisma.$transaction(async (tx) => {
      await tx.congregation.delete({ where: { id: cid } });
      await logAudit(tx, {
        user: req.user, action: 'delete', entity: 'Congregation', entityId: cid,
        sectorId, congregationId: cid, summary: `Exclusão da congregação ${before.code} — ${before.name}`,
        before: { code: before.code, name: before.name },
      });
    });
    res.json({ ok: true, id: cid });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
