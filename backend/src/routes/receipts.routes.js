const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { receiptWhere, resolveReceiptScope, canWriteReceipt } = require('../lib/scope');
const { receipt: serializeReceipt } = require('../lib/serialize');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

const createSchema = z.object({
  number: z.string().min(1).optional(),
  person: z.object({
    name: z.string().min(1),
    memberCode: z.string().optional().nullable(),
  }),
  type: z.string().min(1),
  value: z.number().nonnegative(),
  payment: z.enum(['dinheiro', 'pix', 'cartao']).optional(),
  sectorId: z.number().int().positive().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
  date: z.string().optional(),
  status: z.string().optional(),
});

const updateSchema = z.object({
  person: z
    .object({
      name: z.string().min(1),
      memberCode: z.string().optional().nullable(),
    })
    .optional(),
  type: z.string().min(1).optional(),
  value: z.number().nonnegative().optional(),
  payment: z.enum(['dinheiro', 'pix', 'cartao']).optional(),
  date: z.string().optional(),
  status: z.string().optional(),
  number: z.string().min(1).optional(),
});

function generateNumber() {
  return String(Date.now()).slice(-8);
}

router.get('/', async (req, res, next) => {
  try {
    const where = receiptWhere(req.user);
    const { from, to, sectorId, congregationId, type, search, limit } = req.query;

    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(String(from));
      if (to) {
        const end = new Date(String(to));
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }
    if (sectorId && req.user.role === 'sede') where.sectorId = Number(sectorId);
    if (congregationId && (req.user.role === 'sede' || req.user.role === 'tesoureiro_setor')) {
      where.congregationId = Number(congregationId);
    }
    if (type) where.type = String(type);
    if (search) where.personName = { contains: String(search), mode: 'insensitive' };

    const take = Math.min(Number(limit) || 200, 1000);
    const receipts = await prisma.receipt.findMany({ where, orderBy: { date: 'desc' }, take });
    res.json({ receipts: receipts.map(serializeReceipt) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const receipt = await prisma.receipt.findFirst({ where: receiptWhere(req.user, { id: req.params.id }) });
    if (!receipt) throw httpError(404, 'Recebimento não encontrado');
    res.json({ receipt: serializeReceipt(receipt) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const scope = await resolveReceiptScope(prisma, req.user, data);
    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.receipt.create({
        data: {
          number: data.number || generateNumber(),
          personName: data.person.name,
          personMemberCode: data.person.memberCode ?? null,
          type: data.type,
          value: data.value,
          payment: data.payment || 'dinheiro',
          status: data.status || 'confirmado',
          date: data.date ? new Date(data.date) : new Date(),
          sectorId: scope.sectorId,
          congregationId: scope.congregationId,
          createdById: req.user.sub,
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'receipt.create',
        entity: 'Receipt',
        entityId: created.id,
        sectorId: created.sectorId,
        congregationId: created.congregationId,
        summary: `${created.type}: ${created.personName}`,
        after: { number: created.number, personName: created.personName, type: created.type, value: Number(created.value), payment: created.payment },
      });
      return created;
    });
    res.status(201).json({ receipt: serializeReceipt(receipt) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const existing = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Recebimento não encontrado');
    if (!canWriteReceipt(req.user, existing)) throw httpError(403, 'Sem permissão para alterar este recebimento');

    const receipt = await prisma.$transaction(async (tx) => {
      const updated = await tx.receipt.update({
        where: { id: req.params.id },
        data: {
          number: data.number ?? existing.number,
          personName: data.person?.name ?? existing.personName,
          personMemberCode: data.person ? data.person.memberCode ?? null : existing.personMemberCode,
          type: data.type ?? existing.type,
          value: data.value ?? existing.value,
          payment: data.payment ?? existing.payment,
          status: data.status ?? existing.status,
          date: data.date ? new Date(data.date) : existing.date,
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'receipt.update',
        entity: 'Receipt',
        entityId: existing.id,
        sectorId: existing.sectorId,
        congregationId: existing.congregationId,
        summary: `Alteração de ${existing.type}`,
        before: { number: existing.number, personName: existing.personName, type: existing.type, value: Number(existing.value), payment: existing.payment, status: existing.status },
        after: { number: updated.number, personName: updated.personName, type: updated.type, value: Number(updated.value), payment: updated.payment, status: updated.status },
      });
      return updated;
    });
    res.json({ receipt: serializeReceipt(receipt) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Recebimento não encontrado');
    if (!canWriteReceipt(req.user, existing)) throw httpError(403, 'Sem permissão para excluir este recebimento');
    await prisma.$transaction(async (tx) => {
      await tx.receipt.delete({ where: { id: req.params.id } });
      await logAudit(tx, {
        user: req.user,
        action: 'receipt.delete',
        entity: 'Receipt',
        entityId: existing.id,
        sectorId: existing.sectorId,
        congregationId: existing.congregationId,
        summary: `Exclusão de ${existing.type}`,
        before: { number: existing.number, personName: existing.personName, type: existing.type, value: Number(existing.value), payment: existing.payment },
      });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
