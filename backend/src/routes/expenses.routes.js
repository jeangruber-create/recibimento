const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { resolveReceiptScope } = require('../lib/scope');
const { expense: serializeExpense } = require('../lib/serialize');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

const PROOF_MAX_BYTES = 2 * 1024 * 1024;

const proofSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(3),
  size: z.number().int().nonnegative().max(PROOF_MAX_BYTES),
  data: z.string().min(16),
});

const createSchema = z.object({
  date: z.string().optional(),
  category: z.string().min(1),
  description: z.string().optional(),
  value: z.number().positive(),
  payment: z.enum(['dinheiro', 'pix', 'outros']).optional(),
  sectorId: z.number().int().positive().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
  comprovante: proofSchema,
});

const updateSchema = createSchema.partial();

function expenseWhere(user) {
  if (user.role === 'sede') return {};
  if (user.role === 'tesoureiro_setor') return { sectorId: user.sectorId };
  if (user.role === 'tesoureiro_congregacao') return { congregationId: user.congregationId };
  return { sectorId: -1 };
}

function canWriteExpense(user, e) {
  if (user.role === 'sede') return true;
  if (user.role === 'tesoureiro_setor') return e.sectorId === user.sectorId;
  if (user.role === 'tesoureiro_congregacao') return e.congregationId === user.congregationId;
  return false;
}

function expenseScopeWhere(user) {
  if (user.role === 'sede') return {};
  if (user.role === 'tesoureiro_setor') return { sectorId: user.sectorId };
  if (user.role === 'tesoureiro_congregacao') return { congregationId: user.congregationId };
  return { sectorId: -1 };
}

router.get('/', async (req, res, next) => {
  try {
    const where = expenseScopeWhere(req.user);
    const { from, to, sectorId, congregationId, category, limit } = req.query;
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
    if (category) where.category = String(category);
    const take = Math.min(Number(limit) || 200, 1000);
    const expenses = await prisma.expense.findMany({ where, orderBy: { date: 'desc' }, take });
    res.json({ expenses: expenses.map((e) => serializeExpense(e, false)) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const expense = await prisma.expense.findFirst({ where: { ...expenseScopeWhere(req.user), id: req.params.id } });
    if (!expense) throw httpError(404, 'Despesa não encontrada');
    res.json({ expense: serializeExpense(expense, true) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const scope = await resolveReceiptScope(prisma, req.user, data);
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          date: data.date ? new Date(data.date) : new Date(),
          category: data.category,
          description: data.description ?? null,
          value: data.value,
          payment: data.payment || 'dinheiro',
          sectorId: scope.sectorId,
          congregationId: scope.congregationId,
          proofName: data.comprovante.name,
          proofType: data.comprovante.type,
          proofSize: data.comprovante.size,
          proofData: data.comprovante.data,
          createdByName: req.user.name || '',
          createdById: req.user.sub,
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'expense.create',
        entity: 'Expense',
        entityId: created.id,
        sectorId: created.sectorId,
        congregationId: created.congregationId,
        summary: `${created.category}: ${Number(created.value)}`,
        after: { category: created.category, value: Number(created.value), payment: created.payment, description: created.description ?? '' },
      });
      return created;
    });
    res.status(201).json({ expense: serializeExpense(expense, true) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = createSchema.partial().parse(req.body);
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Despesa não encontrada');
    if (!canWriteExpense(req.user, existing)) throw httpError(403, 'Sem permissão para alterar esta despesa');

    const expense = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: req.params.id },
        data: {
          date: data.date ? new Date(data.date) : existing.date,
          category: data.category ?? existing.category,
          description: data.description ?? existing.description,
          value: data.value ?? existing.value,
          payment: data.payment ?? existing.payment,
          proofName: data.comprovante ? data.comprovante.name : existing.proofName,
          proofType: data.comprovante ? data.comprovante.type : existing.proofType,
          proofSize: data.comprovante ? data.comprovante.size : existing.proofSize,
          proofData: data.comprovante ? data.comprovante.data : existing.proofData,
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'expense.update',
        entity: 'Expense',
        entityId: existing.id,
        sectorId: existing.sectorId,
        congregationId: existing.congregationId,
        summary: `Alteração de ${existing.category}`,
        before: { category: existing.category, value: Number(existing.value), payment: existing.payment, description: existing.description ?? '' },
        after: { category: updated.category, value: Number(updated.value), payment: updated.payment, description: updated.description ?? '' },
      });
      return updated;
    });
    res.json({ expense: serializeExpense(expense, true) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Despesa não encontrada');
    if (!canWriteExpense(req.user, existing)) throw httpError(403, 'Sem permissão para excluir esta despesa');
    await prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id: req.params.id } });
      await logAudit(tx, {
        user: req.user,
        action: 'expense.delete',
        entity: 'Expense',
        entityId: existing.id,
        sectorId: existing.sectorId,
        congregationId: existing.congregationId,
        summary: `Exclusão de ${existing.category}`,
        before: { category: existing.category, value: Number(existing.value), payment: existing.payment, description: existing.description ?? '' },
      });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
