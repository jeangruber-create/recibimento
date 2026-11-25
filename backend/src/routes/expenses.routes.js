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

// Quem aprova/rejeita despesa é o setor responsável ou a sede. A própria
// congregação nunca aprova as contas que lançou.
function isExpenseReviewer(user) {
  return user.role === 'sede' || user.role === 'tesoureiro_setor';
}

function canReviewExpense(user, e) {
  if (user.role === 'sede') return true;
  if (user.role === 'tesoureiro_setor') return e.sectorId === user.sectorId;
  return false;
}

// Cancelamento é sempre lógico: o registro permanece para auditoria.
function isVoided(e) {
  return !!e && (e.status === 'voided' || e.reviewStatus === 'voided' || e.status === 'canceled');
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
    // Despesa lançada por setor/sede já entra aprovada (quem aprova é o setor).
    // Despesa lançada pela congregação aguarda aprovação do setor.
    const autoApprove = isExpenseReviewer(req.user);
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          date: data.date ? new Date(data.date) : new Date(),
          category: data.category,
          description: data.description ?? null,
          value: data.value,
          payment: data.payment || 'dinheiro',
          status: autoApprove ? 'approved' : 'pending',
          reviewStatus: autoApprove ? 'approved' : 'pending',
          reviewedById: autoApprove ? req.user.sub : null,
          reviewedByName: autoApprove ? (req.user.name || req.user.email || null) : null,
          reviewedAt: autoApprove ? new Date() : null,
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

const reviewSchema = z.object({
  reviewStatus: z.enum(['pending', 'reviewed', 'approved', 'rejected', 'flagged', 'voided']).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'paid', 'voided']).optional(),
  action: z.enum(['review', 'approve', 'reject', 'flag', 'pending', 'pay', 'cancel']).optional(),
  note: z.string().max(500).optional().nullable(),
});

function resolveExpenseReview(action, reviewStatus, status) {
  let rs = reviewStatus || null;
  let st = status || null;
  if (action === 'approve' || action === 'review') { rs = rs || 'approved'; st = st || 'approved'; }
  else if (action === 'reject') { rs = rs || 'rejected'; st = st || 'rejected'; }
  else if (action === 'flag') { rs = rs || 'flagged'; }
  else if (action === 'pending') { rs = rs || 'pending'; st = st || 'pending'; }
  else if (action === 'pay') { rs = rs || 'approved'; st = st || 'paid'; }
  else if (action === 'cancel') { rs = 'voided'; st = 'voided'; }
  return { reviewStatus: rs, status: st };
}

// Validação/aprovação administrativa da despesa (Fase 1 controle financeiro).
router.put('/:id/review', async (req, res, next) => {
  try {
    const data = reviewSchema.parse(req.body);
    const resolved = resolveExpenseReview(data.action, data.reviewStatus, data.status);
    if (!resolved.reviewStatus && !resolved.status) throw httpError(400, 'Informe action, reviewStatus ou status');
    const existing = await prisma.expense.findFirst({ where: { ...expenseScopeWhere(req.user), id: req.params.id } });
    if (!existing) throw httpError(404, 'Despesa não encontrada');
    if (!canReviewExpense(req.user, existing)) {
      throw httpError(403, 'Apenas o tesoureiro de setor ou a sede podem aprovar despesas');
    }
    if (isVoided(existing) && data.action !== 'cancel' && resolved.status !== 'voided' && resolved.reviewStatus !== 'voided') {
      throw httpError(409, 'Despesa cancelada; o registro é mantido apenas para auditoria');
    }

    const expense = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: existing.id },
        data: {
          ...(resolved.reviewStatus ? { reviewStatus: resolved.reviewStatus } : {}),
          ...(resolved.status ? { status: resolved.status } : {}),
          reviewedById: req.user.sub,
          reviewedByName: req.user.name || req.user.email || null,
          reviewedAt: new Date(),
          reviewNote: data.note ?? existing.reviewNote ?? null,
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: data.action === 'cancel' ? 'expense.cancel' : 'expense.review',
        entity: 'Expense',
        entityId: existing.id,
        sectorId: existing.sectorId,
        congregationId: existing.congregationId,
        summary: `Validação de ${existing.category}: ${updated.reviewStatus}/${updated.status}`,
        before: { reviewStatus: existing.reviewStatus, status: existing.status, reviewNote: existing.reviewNote ?? null },
        after: { reviewStatus: updated.reviewStatus, status: updated.status, reviewNote: updated.reviewNote ?? null },
      });
      return updated;
    });
    res.json({ expense: serializeExpense(expense, true) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = createSchema.partial().parse(req.body);
    const existing = await prisma.expense.findFirst({ where: { ...expenseScopeWhere(req.user), id: req.params.id } });
    if (!existing) throw httpError(404, 'Despesa não encontrada');
    if (!canWriteExpense(req.user, existing)) throw httpError(403, 'Sem permissão para alterar esta despesa');
    if (isVoided(existing)) throw httpError(409, 'Despesa cancelada; o registro é mantido apenas para auditoria');

    // Edição feita pela congregação volta para a fila de aprovação do setor.
    // Edição feita pelo setor/sede já é considerada aprovada por quem revisou.
    const reviewer = isExpenseReviewer(req.user);
    const reviewReset = reviewer
      ? {
          status: 'approved',
          reviewStatus: 'approved',
          reviewedById: req.user.sub,
          reviewedByName: req.user.name || req.user.email || null,
          reviewedAt: new Date(),
        }
      : {
          status: 'pending',
          reviewStatus: 'pending',
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
          reviewNote: null,
        };

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
          ...reviewReset,
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
        before: { category: existing.category, value: Number(existing.value), payment: existing.payment, description: existing.description ?? '', reviewStatus: existing.reviewStatus, status: existing.status },
        after: { category: updated.category, value: Number(updated.value), payment: updated.payment, description: updated.description ?? '', reviewStatus: updated.reviewStatus, status: updated.status },
      });
      return updated;
    });
    res.json({ expense: serializeExpense(expense, true) });
  } catch (e) {
    next(e);
  }
});

const cancelSchema = z.object({
  note: z.string().max(500).optional().nullable(),
});

// Cancelamento lógico: a despesa continua no banco e nas listagens como CANCELADA.
// Nunca mais há exclusão física de despesa, para preservar a trilha de auditoria.
async function cancelExpense(req, res, next) {
  try {
    const { note } = cancelSchema.parse(req.body || {});
    const existing = await prisma.expense.findFirst({ where: { ...expenseScopeWhere(req.user), id: req.params.id } });
    if (!existing) throw httpError(404, 'Despesa não encontrada');
    if (!canWriteExpense(req.user, existing)) throw httpError(403, 'Sem permissão para cancelar esta despesa');
    if (isVoided(existing)) return res.json({ ok: true, expense: serializeExpense(existing, true) });

    const reason = (note || '').trim() || 'Cancelada pelo tesoureiro';
    const expense = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: existing.id },
        data: {
          status: 'voided',
          reviewStatus: 'voided',
          reviewNote: existing.reviewNote ? `${existing.reviewNote} • ${reason}` : reason,
          reviewedById: req.user.sub,
          reviewedByName: req.user.name || req.user.email || null,
          reviewedAt: new Date(),
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'expense.cancel',
        entity: 'Expense',
        entityId: existing.id,
        sectorId: existing.sectorId,
        congregationId: existing.congregationId,
        summary: `Cancelamento de ${existing.category} (registro mantido para auditoria)`,
        before: {
          status: existing.status,
          reviewStatus: existing.reviewStatus,
          category: existing.category,
          value: Number(existing.value),
          reviewNote: existing.reviewNote ?? null,
        },
        after: {
          status: updated.status,
          reviewStatus: updated.reviewStatus,
          category: updated.category,
          value: Number(updated.value),
          reviewNote: updated.reviewNote ?? null,
        },
      });
      return updated;
    });
    res.json({ ok: true, expense: serializeExpense(expense, true) });
  } catch (e) {
    next(e);
  }
}

router.post('/:id/cancel', cancelExpense);
// Mantido por compatibilidade com clientes antigos: DELETE agora cancela, nunca exclui.
router.delete('/:id', cancelExpense);

module.exports = router;
