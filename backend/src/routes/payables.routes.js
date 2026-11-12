const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { resolveReceiptScope, payableWhere, canWritePayable } = require('../lib/scope');
const { resolveWeekStart } = require('../lib/week');
const { payable: serializePayable, expense: serializeExpense } = require('../lib/serialize');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

const MANAGE_ROLES = ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao'];
function requireManage(req) {
  if (!MANAGE_ROLES.includes(req.user.role)) throw httpError(403, 'Sem permissão para contas a pagar');
}

const PROOF_MAX_BYTES = 2 * 1024 * 1024;
const proofSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(3),
  size: z.number().int().nonnegative().max(PROOF_MAX_BYTES),
  data: z.string().min(16),
}).optional().nullable();

const requiredProofSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(3),
  size: z.number().int().nonnegative().max(PROOF_MAX_BYTES),
  data: z.string().min(16),
});

const createSchema = z.object({
  category: z.string().min(1),
  description: z.string().optional().nullable(),
  payee: z.string().optional().nullable(),
  nature: z.string().optional().nullable(),
  amount: z.number().positive(),
  payment: z.enum(['dinheiro', 'pix', 'cartao', 'outros']).optional(),
  dueDate: z.string().min(1),
  competenceDate: z.string().optional().nullable(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'scheduled']).optional(),
  note: z.string().optional().nullable(),
  sectorId: z.number().int().positive().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
  comprovante: proofSchema,
});

const updateSchema = createSchema.partial();

function moneyEq(a, b) { return Math.abs(Number(a) - Number(b)) < 0.005; }

router.get('/', async (req, res, next) => {
  try {
    requireManage(req);
    const q = req.query || {};
    const where = payableWhere(req.user);
    if (q.from || q.to) {
      where.dueDate = {};
      if (q.from) where.dueDate.gte = new Date(String(q.from));
      if (q.to) { const end = new Date(String(q.to)); end.setHours(23, 59, 59, 999); where.dueDate.lte = end; }
    }
    if (q.sectorId && req.user.role === 'sede') where.sectorId = Number(q.sectorId);
    if (q.congregationId && (req.user.role === 'sede' || req.user.role === 'tesoureiro_setor')) where.congregationId = Number(q.congregationId);
    if (q.status) {
      const st = String(q.status);
      if (st === 'open') where.status = { in: ['draft', 'pending_approval', 'approved', 'scheduled', 'partially_paid'] };
      else if (st === 'overdue') { where.status = { in: ['pending_approval', 'approved', 'scheduled', 'partially_paid'] }; where.dueDate = { ...(where.dueDate || {}), lt: new Date() }; }
      else where.status = st;
    }
    if (q.category) where.category = { contains: String(q.category), mode: 'insensitive' };
    const take = Math.min(Number(q.limit) || 200, 1000);
    const rows = await prisma.payable.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take });
    res.json({ payables: rows.map((p) => serializePayable(p, false)) });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    requireManage(req);
    const row = await prisma.payable.findFirst({ where: payableWhere(req.user, { id: req.params.id }), include: { expenses: { orderBy: { date: 'desc' }, take: 20 } } });
    if (!row) throw httpError(404, 'Conta a pagar não encontrada');
    const out = serializePayable(row, true);
    out.expenses = (row.expenses || []).map((e) => serializeExpense(e, false));
    res.json({ payable: out });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    requireManage(req);
    const data = createSchema.parse(req.body);
    const scope = await resolveReceiptScope(prisma, req.user, data);
    const dueDate = new Date(data.dueDate);
    if (isNaN(dueDate.getTime())) throw httpError(400, 'Data de vencimento inválida');
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.payable.create({
        data: {
          category: data.category,
          description: data.description ?? null,
          payee: data.payee ?? null,
          nature: data.nature ?? null,
          amount: data.amount,
          payment: data.payment || 'dinheiro',
          dueDate,
          competenceDate: data.competenceDate ? new Date(data.competenceDate) : null,
          status: data.status || 'pending_approval',
          note: data.note ?? null,
          sectorId: scope.sectorId,
          congregationId: scope.congregationId,
          proofName: data.comprovante?.name ?? null,
          proofType: data.comprovante?.type ?? null,
          proofSize: data.comprovante?.size ?? null,
          proofData: data.comprovante?.data ?? null,
          createdById: req.user.sub,
          createdByName: req.user.name || req.user.email || '',
        },
      });
      await logAudit(tx, {
        user: req.user, action: 'payable.create', entity: 'Payable', entityId: created.id,
        sectorId: created.sectorId, congregationId: created.congregationId,
        summary: `${created.category}: ${Number(created.amount)} (vence ${dueDate.toISOString().slice(0,10)})`,
        after: { category: created.category, amount: Number(created.amount), dueDate: created.dueDate, status: created.status, payee: created.payee },
      });
      return created;
    });
    res.status(201).json({ payable: serializePayable(row, true) });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    requireManage(req);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.payable.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Conta a pagar não encontrada');
    if (!canWritePayable(req.user, existing)) throw httpError(403, 'Sem permissão para alterar esta conta');
    // Perfil admin (sede) tem privilégio de alterar inclusive registros finalizados (auditado).
    if (['paid', 'canceled'].includes(existing.status) && req.user.role !== 'sede') throw httpError(409, 'Conta já finalizada; use estorno/ajuste auditado se necessário');
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.payable.update({
        where: { id: existing.id },
        data: {
          category: data.category ?? existing.category,
          description: data.description === undefined ? existing.description : data.description,
          payee: data.payee === undefined ? existing.payee : data.payee,
          nature: data.nature === undefined ? existing.nature : data.nature,
          amount: data.amount ?? existing.amount,
          payment: data.payment ?? existing.payment,
          dueDate: data.dueDate ? new Date(data.dueDate) : existing.dueDate,
          competenceDate: data.competenceDate ? new Date(data.competenceDate) : (data.competenceDate === null ? null : existing.competenceDate),
          note: data.note === undefined ? existing.note : data.note,
          proofName: data.comprovante ? data.comprovante.name : existing.proofName,
          proofType: data.comprovante ? data.comprovante.type : existing.proofType,
          proofSize: data.comprovante ? data.comprovante.size : existing.proofSize,
          proofData: data.comprovante ? data.comprovante.data : existing.proofData,
        },
      });
      await logAudit(tx, { user: req.user, action: 'payable.update', entity: 'Payable', entityId: existing.id, sectorId: existing.sectorId, congregationId: existing.congregationId, summary: `Alteração: ${existing.category}`, before: { amount: Number(existing.amount), dueDate: existing.dueDate, status: existing.status }, after: { amount: Number(updated.amount), dueDate: updated.dueDate, status: updated.status } });
      return updated;
    });
    res.json({ payable: serializePayable(row, true) });
  } catch (e) { next(e); }
});

const actionSchema = z.object({ action: z.enum(['approve', 'schedule', 'cancel', 'reopen']), note: z.string().optional().nullable() });

router.put('/:id/status', async (req, res, next) => {
  try {
    requireManage(req);
    const { action, note } = actionSchema.parse(req.body);
    const existing = await prisma.payable.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Conta a pagar não encontrada');
    if (!canWritePayable(req.user, existing)) throw httpError(403, 'Sem permissão');
    // Perfil admin (sede): privilégios de reabrir/alterar; demais seguem regras de negócio.
    if (existing.status === 'paid' && action !== 'reopen' && req.user.role !== 'sede') throw httpError(409, 'Conta já paga');
    let patch = {};
    if (action === 'approve') {
      if (existing.status === 'canceled' && req.user.role !== 'sede') throw httpError(409, 'Conta cancelada');
      patch = { status: 'approved', approvedById: req.user.sub, approvedByName: req.user.name || req.user.email || '', approvedAt: new Date() };
    } else if (action === 'schedule') {
      if (!['approved', 'pending_approval', 'scheduled', 'partially_paid'].includes(existing.status) && req.user.role !== 'sede') throw httpError(409, 'Aprove antes de agendar');
      patch = { status: 'scheduled', approvedById: existing.approvedById || req.user.sub, approvedByName: existing.approvedByName || req.user.name || '', approvedAt: existing.approvedAt || new Date() };
    } else if (action === 'cancel') {
      if (existing.status === 'paid' && req.user.role !== 'sede') throw httpError(409, 'Conta paga não pode ser cancelada');
      patch = { status: 'canceled', canceledAt: new Date() };
    } else if (action === 'reopen') {
      // Sede (admin) pode reabrir inclusive contas pagas/parciais/canceladas (auditado; saídas já geradas não são apagadas automaticamente).
      if (req.user.role === 'sede') {
        patch = { status: 'pending_approval', canceledAt: null, paidAt: null };
      } else {
        if (!['canceled'].includes(existing.status)) throw httpError(409, 'Só é possível reabrir conta cancelada');
        patch = { status: 'pending_approval', canceledAt: null };
      }
    }
    if (note !== undefined) patch.note = note;
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.payable.update({ where: { id: existing.id }, data: patch });
      await logAudit(tx, { user: req.user, action: `payable.${action}`, entity: 'Payable', entityId: existing.id, sectorId: existing.sectorId, congregationId: existing.congregationId, summary: `${existing.category}: ${action}`, before: { status: existing.status }, after: { status: updated.status } });
      return updated;
    });
    res.json({ payable: serializePayable(row, true) });
  } catch (e) { next(e); }
});

const paySchema = z.object({
  amount: z.number().positive().optional(), // default: remaining
  paidAt: z.string().optional(),
  payment: z.enum(['dinheiro', 'pix', 'cartao', 'outros']).optional(),
  note: z.string().optional().nullable(),
  comprovante: requiredProofSchema,
});

// Registra pagamento: gera despesa realizada (saída) e baixa a obrigação.
router.post('/:id/pay', async (req, res, next) => {
  try {
    requireManage(req);
    if (!req.body || !req.body.comprovante) throw httpError(400, 'Comprovante do pagamento é obrigatório');
    const data = paySchema.parse(req.body);
    const existing = await prisma.payable.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Conta a pagar não encontrada');
    if (!canWritePayable(req.user, existing)) throw httpError(403, 'Sem permissão');
    if (['canceled'].includes(existing.status)) throw httpError(409, 'Conta cancelada');
    if (['draft', 'pending_approval'].includes(existing.status)) throw httpError(409, 'Aprove a conta antes de registrar o pagamento');
    if (existing.status === 'paid') throw httpError(409, 'Conta já está paga');

    const remaining = Number(existing.amount) - Number(existing.amountPaid || 0);
    const amountToPay = data.amount != null ? Number(data.amount) : remaining;
    if (!(amountToPay > 0)) throw httpError(400, 'Valor de pagamento inválido');
    if (amountToPay - remaining > 0.005) throw httpError(400, 'Valor excede o saldo em aberto da obrigação');
    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
    const newPaid = Number(existing.amountPaid || 0) + amountToPay;
    const fullyPaid = moneyEq(newPaid, Number(existing.amount)) || newPaid > Number(existing.amount) - 0.005;
    const nextStatus = fullyPaid ? 'paid' : 'partially_paid';

    const result = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          date: paidAt,
          category: existing.category,
          description: [existing.description, existing.payee ? `Favorecido: ${existing.payee}` : null, data.note].filter(Boolean).join(' · ') || null,
          value: amountToPay,
          payment: data.payment || existing.payment || 'dinheiro',
          status: 'paid',
          reviewStatus: 'approved',
          sectorId: existing.sectorId,
          congregationId: existing.congregationId,
          payableId: existing.id,
          proofName: data.comprovante?.name ?? existing.proofName ?? null,
          proofType: data.comprovante?.type ?? existing.proofType ?? null,
          proofSize: data.comprovante?.size ?? existing.proofSize ?? null,
          proofData: data.comprovante?.data ?? existing.proofData ?? null,
          createdByName: req.user.name || req.user.email || '',
          createdById: req.user.sub,
          reviewedById: req.user.sub,
          reviewedByName: req.user.name || req.user.email || null,
          reviewedAt: paidAt,
          reviewNote: 'Gerada pelo pagamento de conta a pagar',
        },
      });
      const updated = await tx.payable.update({
        where: { id: existing.id },
        data: {
          amountPaid: newPaid,
          status: nextStatus,
          paidAt: fullyPaid ? paidAt : existing.paidAt,
          note: data.note ? [existing.note, data.note].filter(Boolean).join('\n') : existing.note,
        },
      });
      // Fatia 2: pagamento executado pelo setor -> consta no acerto semanal, saída efetiva desde já,
      // valor deduzido do acerto; pendente de validação do admin (sede) quando executado pelo setor.
      try {
        const weekStart = resolveWeekStart(paidAt);
        const isSedeExec = req.user.role === 'sede';
        const disp = fullyPaid ? 'quitada' : 'a_quitar';
        const remainingAmt = Math.max(0, Number(existing.amount) - newPaid);
        const siExisting = await tx.settlementItem.findFirst({ where: { payableId: existing.id, sectorId: existing.sectorId, weekStart } });
        const siData = {
          sectorId: existing.sectorId,
          congregationId: existing.congregationId,
          weekStart,
          payableId: existing.id,
          expenseId: expense.id,
          label: `${existing.category || 'Conta'}${existing.payee ? ' - ' + existing.payee : ''}`,
          category: existing.category || null,
          isBasic: !!existing.isBasic,
          disposition: disp,
          amount: Number(existing.amount),
          amountPaid: newPaid,
          amountProvisioned: siExisting ? Number(siExisting.amountProvisioned || 0) : 0,
          remaining: disp === 'quitada' ? 0 : remainingAmt,
          responsible: existing.sentToSede ? 'sede' : 'setor',
          status: isSedeExec ? 'paid_by_sede' : 'paid_by_setor',
          sedeValidationStatus: isSedeExec ? 'approved' : 'pending',
          executedById: req.user.sub,
          executedByName: req.user.name || req.user.email || null,
          executedAt: paidAt,
          note: data.note || (siExisting ? siExisting.note : existing.description) || null,
        };
        if (siExisting) await tx.settlementItem.update({ where: { id: siExisting.id }, data: siData });
        else await tx.settlementItem.create({ data: { ...siData, createdById: req.user.sub, createdByName: req.user.name || null } });
      } catch (e2) {
        console.warn('[acerto] falha ao registrar item no acerto:', e2 && e2.message ? e2.message : e2);
      }
      await logAudit(tx, { user: req.user, action: 'payable.pay', entity: 'Payable', entityId: existing.id, sectorId: existing.sectorId, congregationId: existing.congregationId, summary: `Pagamento ${Number(amountToPay)} -> despesa ${expense.id}`, before: { status: existing.status, amountPaid: Number(existing.amountPaid || 0) }, after: { status: updated.status, amountPaid: Number(updated.amountPaid), expenseId: expense.id } });
      await logAudit(tx, { user: req.user, action: 'expense.create_from_payable', entity: 'Expense', entityId: expense.id, sectorId: expense.sectorId, congregationId: expense.congregationId, summary: `Saída realizada (conta a pagar ${existing.id})`, after: { category: expense.category, value: Number(expense.value), payableId: existing.id, status: expense.status } });
      return { payable: updated, expense };
    });

    res.json({ payable: serializePayable(result.payable, true), expense: serializeExpense(result.expense, true) });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    requireManage(req);
    const existing = await prisma.payable.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Conta a pagar não encontrada');
    if (!canWritePayable(req.user, existing)) throw httpError(403, 'Sem permissão');
    // Perfil admin (sede) pode excluir com auditoria mesmo com restrições operacionais; demais seguem regra de integridade.
    if ((Number(existing.amountPaid || 0) > 0 || existing.status === 'paid') && req.user.role !== 'sede') throw httpError(409, 'Conta com pagamento registrado não pode ser excluída; cancele/ajuste com auditoria');
    await prisma.$transaction(async (tx) => {
      await tx.payable.delete({ where: { id: existing.id } });
      await logAudit(tx, { user: req.user, action: 'payable.delete', entity: 'Payable', entityId: existing.id, sectorId: existing.sectorId, congregationId: existing.congregationId, summary: `Exclusão: ${existing.category}`, before: { amount: Number(existing.amount), dueDate: existing.dueDate, status: existing.status } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
