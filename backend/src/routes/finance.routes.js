const express = require('express');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { toNumber } = require('../lib/serialize');

const router = express.Router();
router.use(authRequired);

const MANAGE_ROLES = ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao'];

function requireFinanceAccess(req) {
  if (!MANAGE_ROLES.includes(req.user.role)) throw httpError(403, 'Sem permissão para o controle financeiro');
}

function scopedWhere(user, q, kind) {
  const where = {};
  const sectorId = q.sectorId ? Number(q.sectorId) : null;
  const congregationId = q.congregationId ? Number(q.congregationId) : null;

  if (user.role === 'sede') {
    if (sectorId) where.sectorId = sectorId;
    if (congregationId) where.congregationId = congregationId;
  } else if (user.role === 'tesoureiro_setor') {
    where.sectorId = user.sectorId;
    if (congregationId) where.congregationId = congregationId;
  } else if (user.role === 'tesoureiro_congregacao') {
    where.congregationId = user.congregationId;
  } else {
    where.sectorId = -1;
  }
  return where;
}

function dateRange(q) {
  if (!q.from && !q.to) return null;
  const range = {};
  if (q.from) range.gte = new Date(String(q.from));
  if (q.to) {
    const end = new Date(String(q.to));
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return range;
}

function sumDecimal(rows, field) {
  return rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

// GET /api/finance/overview?from=&to=&sectorId=&congregationId=
router.get('/overview', async (req, res, next) => {
  try {
    requireFinanceAccess(req);
    const q = req.query || {};
    const rWhere = scopedWhere(req.user, q, 'receipt');
    const eWhere = scopedWhere(req.user, q, 'expense');
    const dr = dateRange(q);
    if (dr) { rWhere.date = dr; eWhere.date = dr; }

    // Entradas realizadas: confirmadas e não anuladas
    const incomeWhere = { ...rWhere, status: 'confirmado', NOT: { reviewStatus: 'voided' } };
    // Entradas pendentes (ex.: PIX membro aguardando confirmação)
    const incomePendingWhere = { ...rWhere, status: { not: 'confirmado' }, NOT: { reviewStatus: 'voided' } };
    // Saídas realizadas: pagas/aprovadas, não rejeitadas/anuladas/pendentes
    const expenseWhere = { ...eWhere, status: { in: ['approved', 'paid'] }, NOT: { reviewStatus: { in: ['rejected', 'voided'] } } };
    const expensePendingWhere = { ...eWhere, OR: [{ status: 'pending' }, { reviewStatus: { in: ['pending', 'flagged'] } }], NOT: { status: { in: ['rejected', 'voided'] } } };

    // Contas a pagar (obrigações) - escopo por setor/congregação; vencimento no período quando filtrado
    const pWhere = scopedWhere(req.user, q, 'payable');
    if (dr) pWhere.dueDate = dr;
    const openPayableWhere = { ...pWhere, status: { in: ['draft', 'pending_approval', 'approved', 'scheduled', 'partially_paid'] } };
    const overduePayableWhere = { ...pWhere, status: { in: ['pending_approval', 'approved', 'scheduled', 'partially_paid'] }, dueDate: { ...(pWhere.dueDate || {}), lt: new Date() } };

    const settleWhere = scopedWhere(req.user, q, 'settlement');
    if (q.week) settleWhere.weekStart = new Date(String(q.week));
    const settlePendingQ = prisma.settlementItem ? prisma.settlementItem.count({ where: { ...settleWhere, sedeValidationStatus: 'pending', status: 'paid_by_setor' } }).catch(() => 0) : Promise.resolve(0);

    const [incomeAgg, incomePendingAgg, expenseAgg, expensePendingAgg, incomeByPay, expenseByPay, receiptsCount, expensesCount, openPayables, overdueAgg, settlementPendingValidation] = await Promise.all([
      prisma.receipt.aggregate({ where: incomeWhere, _sum: { value: true }, _count: { _all: true } }),
      prisma.receipt.aggregate({ where: incomePendingWhere, _sum: { value: true }, _count: { _all: true } }),
      prisma.expense.aggregate({ where: expenseWhere, _sum: { value: true }, _count: { _all: true } }),
      prisma.expense.aggregate({ where: expensePendingWhere, _sum: { value: true }, _count: { _all: true } }),
      prisma.receipt.groupBy({ by: ['payment'], where: incomeWhere, _sum: { value: true } }),
      prisma.expense.groupBy({ by: ['payment'], where: expenseWhere, _sum: { value: true } }),
      prisma.receipt.count({ where: incomeWhere }),
      prisma.expense.count({ where: expenseWhere }),
      prisma.payable.findMany({ where: openPayableWhere, select: { amount: true, amountPaid: true, status: true } }),
      prisma.payable.aggregate({ where: overduePayableWhere, _count: { _all: true } }),
      settlePendingQ,
    ]);

    const income = Number(incomeAgg._sum.value || 0);
    const expense = Number(expenseAgg._sum.value || 0);
    const byPayment = (arr) => arr.reduce((o, r) => { o[r.payment] = Number(r._sum.value || 0); return o; }, {});
    const obligationsOpen = openPayables.reduce((acc, p) => acc + Math.max(0, Number(p.amount) - Number(p.amountPaid || 0)), 0);
    const obligationsApprovalCount = openPayables.filter((p) => p.status === 'draft' || p.status === 'pending_approval').length;
    const realizedBalance = income - expense;

    res.json({
      period: { from: q.from || null, to: q.to || null },
      scope: { sectorId: rWhere.sectorId ?? null, congregationId: rWhere.congregationId ?? null, role: req.user.role },
      realized: {
        income,
        expense,
        balance: realizedBalance,
        receiptsCount,
        expensesCount,
        incomeByPayment: byPayment(incomeByPay),
        expenseByPayment: byPayment(expenseByPay),
      },
      obligations: {
        openAmount: obligationsOpen,
        openCount: openPayables.length,
        overdueCount: overdueAgg._count._all || 0,
        pendingApprovalCount: obligationsApprovalCount,
      },
      projected: {
        balance: realizedBalance - obligationsOpen,
        note: 'Saldo realizado menos contas a pagar em aberto no filtro/escopo',
      },
      settlement: {
        pendingValidationCount: settlementPendingValidation || 0,
        note: 'Itens pagos pelo setor aguardando validação do perfil admin (sede)',
      },
      pending: {
        income: Number(incomePendingAgg._sum.value || 0),
        incomeCount: incomePendingAgg._count._all || 0,
        expense: Number(expensePendingAgg._sum.value || 0),
        expenseCount: expensePendingAgg._count._all || 0,
        settlementValidationCount: settlementPendingValidation || 0,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/finance/pending?from=&to=&sectorId=&congregationId=&kind=all|receipt|expense|payable|settlement&limit=
router.get('/pending', async (req, res, next) => {
  try {
    requireFinanceAccess(req);
    const q = req.query || {};
    const kind = String(q.kind || 'all');
    const take = Math.min(Number(q.limit) || 100, 500);
    const dr = dateRange(q);
    const items = [];

    if (kind === 'all' || kind === 'receipt') {
      const where = scopedWhere(req.user, q, 'receipt');
      if (dr) where.date = dr;
      where.OR = [
        { reviewStatus: { in: ['pending', 'flagged'] } },
        { status: { not: 'confirmado' }, reviewStatus: { not: 'voided' } },
      ];
      const rows = await prisma.receipt.findMany({ where, orderBy: [{ date: 'desc' }], take });
      for (const r of rows) {
        items.push({
          kind: 'receipt',
          id: r.id,
          date: r.date instanceof Date ? r.date.toISOString() : r.date,
          label: `${r.type}: ${r.personName}`,
          value: Number(r.value),
          payment: r.payment,
          status: r.status,
          reviewStatus: r.reviewStatus,
          reviewNote: r.reviewNote || '',
          sectorId: r.sectorId,
          congregationId: r.congregationId,
          meta: { number: r.number, source: r.source || null },
        });
      }
    }

    if (kind === 'all' || kind === 'expense') {
      const where = scopedWhere(req.user, q, 'expense');
      if (dr) where.date = dr;
      where.OR = [
        { status: 'pending' },
        { reviewStatus: { in: ['pending', 'flagged'] } },
      ];
      where.NOT = { status: { in: ['rejected', 'voided'] } };
      const rows = await prisma.expense.findMany({ where, orderBy: [{ date: 'desc' }], take });
      for (const r of rows) {
        items.push({
          kind: 'expense',
          id: r.id,
          date: r.date instanceof Date ? r.date.toISOString() : r.date,
          label: `${r.category}${r.description ? ': ' + r.description : ''}`,
          value: Number(r.value),
          payment: r.payment,
          status: r.status,
          reviewStatus: r.reviewStatus,
          reviewNote: r.reviewNote || '',
          sectorId: r.sectorId,
          congregationId: r.congregationId,
          meta: { hasProof: !!(r.proofData || r.proofName), proofName: r.proofName || null },
        });
      }
    }

    if (kind === 'all' || kind === 'payable') {
      const where = scopedWhere(req.user, q, 'payable');
      if (dr) where.dueDate = dr;
      where.status = { in: ['draft', 'pending_approval'] };
      const rows = await prisma.payable.findMany({ where, orderBy: [{ dueDate: 'asc' }], take });
      for (const r of rows) {
        items.push({
          kind: 'payable',
          id: r.id,
          date: r.dueDate instanceof Date ? r.dueDate.toISOString() : r.dueDate,
          label: `${r.category}${r.payee ? ' · ' + r.payee : ''}${r.description ? ': ' + r.description : ''}`,
          value: Number(r.amount),
          payment: r.payment,
          status: r.status,
          reviewStatus: r.status,
          reviewNote: r.note || '',
          sectorId: r.sectorId,
          congregationId: r.congregationId,
          meta: { nature: r.nature || null, amountOpen: Math.max(0, Number(r.amount) - Number(r.amountPaid || 0)) },
        });
      }
    }

    // Fatia 3: itens do acerto executados pelo setor e pendentes de validação da sede (admin)
    if (kind === 'all' || kind === 'settlement') {
      try {
        const where = scopedWhere(req.user, q, 'settlement');
        if (q.week) where.weekStart = new Date(String(q.week)); // opcional
        where.sedeValidationStatus = 'pending';
        where.status = 'paid_by_setor';
        const rows = await prisma.settlementItem.findMany({ where, orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }], take });
        for (const r of rows) {
          items.push({
            kind: 'settlement',
            id: r.id,
            date: r.executedAt ? (r.executedAt instanceof Date ? r.executedAt.toISOString() : r.executedAt) : (r.weekStart instanceof Date ? r.weekStart.toISOString() : r.weekStart),
            label: `Acerto (validar sede): ${r.label || r.category || 'Conta'} — pago pelo setor`,
            value: Number(r.amountPaid || r.amount || 0),
            payment: null,
            status: r.status,
            reviewStatus: r.sedeValidationStatus,
            reviewNote: r.sedeValidationNote || r.note || '',
            sectorId: r.sectorId,
            congregationId: r.congregationId,
            meta: { disposition: r.disposition, amount: Number(r.amount || 0), amountPaid: Number(r.amountPaid || 0), remaining: Number(r.remaining || 0), payableId: r.payableId, weekStart: r.weekStart },
          });
        }
      } catch (e2) {
        // SettlementItem pode não existir se client não foi regenerado
        if (process.env.NODE_ENV !== 'production') console.warn('[finance/pending settlement]', e2 && e2.message);
      }
    }

    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    res.json({ items: items.slice(0, take), generatedAt: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
