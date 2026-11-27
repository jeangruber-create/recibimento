const express = require('express');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { resolveWeekStart, weekBounds, isoWeekInfo, EXPENSE_LIMIT_RATIO } = require('../lib/week');
const { CONFIRMED_RECEIPT, settlementSummary } = require('../lib/weekly');

const router = express.Router();
router.use(authRequired);

const MANAGE_ROLES = ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao'];

const OPEN_PAYABLE_STATUSES = ['draft', 'pending_approval', 'approved', 'scheduled', 'partially_paid'];
const ACTIVE_EXPENSE_NOT = [
  { status: 'voided' },
  { reviewStatus: 'voided' },
  { status: 'canceled' },
  { status: 'rejected' },
  { reviewStatus: 'rejected' },
];
const PENDING_EXPENSE_WHERE = {
  NOT: [{ status: 'voided' }, { reviewStatus: 'voided' }],
  OR: [
    { status: { in: ['pending', 'rejected'] } },
    { reviewStatus: { in: ['pending', 'rejected', 'flagged'] } },
  ],
};

const CLOSURE_LABELS = {
  open: 'Em aberto',
  closed: 'Fechado',
  validated: 'Validado',
};
const PRESTACAO_LABELS = {
  open: 'Não enviada',
  submitted: 'Enviada à sede',
  approved: 'Aprovada pela sede',
  rejected: 'Devolvida',
  received: 'Recebida pela sede',
};

function requireAccess(req) {
  if (!MANAGE_ROLES.includes(req.user.role)) throw httpError(403, 'Sem acesso às consultas');
}

function num(v) {
  return Number(v || 0);
}

function parseRange(q) {
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

// Escopo único para todos os recursos (receitas, despesas, contas e acerto).
function scopedWhere(user, q) {
  const sectorId = q.sectorId ? Number(q.sectorId) : null;
  const congregationId = q.congregationId ? Number(q.congregationId) : null;
  const where = {};

  if (user.role === 'sede') {
    if (sectorId) where.sectorId = sectorId;
    if (congregationId) where.congregationId = congregationId;
    return where;
  }
  if (user.role === 'tesoureiro_setor') {
    where.sectorId = user.sectorId;
    if (congregationId) where.congregationId = congregationId;
    return where;
  }
  where.congregationId = user.congregationId;
  return where;
}

function canManageCongregation(user, sectorId, congregationId) {
  if (user.role === 'sede') return true;
  if (user.role === 'tesoureiro_setor') return Number(user.sectorId) === Number(sectorId);
  return Number(user.congregationId) === Number(congregationId);
}

function canManageSector(user, sectorId) {
  if (user.role === 'sede') return true;
  return user.role === 'tesoureiro_setor' && Number(user.sectorId) === Number(sectorId);
}

function closureInfo(closure) {
  if (!closure) return { status: 'open', label: CLOSURE_LABELS.open, id: null, closedAt: null, validatedAt: null };
  return {
    id: closure.id,
    status: String(closure.status),
    label: CLOSURE_LABELS[String(closure.status)] || String(closure.status),
    closedBy: closure.closedBy || '',
    closedAt: closure.closedAt ? closure.closedAt.toISOString() : null,
    validatedBy: closure.validatedBy || '',
    validatedAt: closure.validatedAt ? closure.validatedAt.toISOString() : null,
    exceeded: !!closure.exceeded,
    justification: closure.justification || '',
  };
}

function prestacaoInfo(prestacao) {
  const status = prestacao ? String(prestacao.status) : 'open';
  return {
    id: prestacao ? prestacao.id : null,
    status,
    label: PRESTACAO_LABELS[status] || status,
    submittedAt: prestacao && prestacao.submittedAt ? prestacao.submittedAt.toISOString() : null,
    receivedAt: prestacao && prestacao.receivedAt ? prestacao.receivedAt.toISOString() : null,
  };
}

function contributorKey(receipt) {
  if (receipt.personUserId) return `u:${receipt.personUserId}`;
  if (receipt.personMemberCode) return `c:${String(receipt.personMemberCode).trim()}`;
  const name = String(receipt.personName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return name ? `n:${name}` : `r:${receipt.id}`;
}

function buildContributors(receipts, users) {
  const usersById = new Map(users.filter((u) => u.id).map((u) => [u.id, u]));
  const usersByCode = new Map(users.filter((u) => u.memberCode).map((u) => [String(u.memberCode).trim(), u]));
  const map = new Map();

  receipts.forEach((r) => {
    const linked = (r.personUserId && usersById.get(r.personUserId))
      || (r.personMemberCode && usersByCode.get(String(r.personMemberCode).trim()))
      || null;
    const key = contributorKey(r);
    const name = linked?.name || r.personName || 'Não informado';
    const code = linked?.memberCode || r.personMemberCode || '';
    const phone = linked?.phone || '';
    const isTithe = /d[íi]zim/i.test(String(r.type || ''));
    const value = num(r.value);

    let item = map.get(key);
    if (!item) {
      item = {
        key,
        name,
        memberCode: code,
        phone,
        count: 0,
        total: 0,
        titheCount: 0,
        titheTotal: 0,
        offeringCount: 0,
        offeringTotal: 0,
        lastDate: null,
        congregationId: r.congregationId,
        sectorId: r.sectorId,
      };
      map.set(key, item);
    }
    item.count += 1;
    item.total += value;
    if (isTithe) { item.titheCount += 1; item.titheTotal += value; }
    else if (/oferta/i.test(String(r.type || ''))) { item.offeringCount += 1; item.offeringTotal += value; }
    const dateIso = r.date instanceof Date ? r.date.toISOString() : (r.date ? String(r.date) : '');
    if (dateIso && (!item.lastDate || dateIso > item.lastDate)) {
      item.lastDate = dateIso;
      item.congregationId = r.congregationId;
      item.sectorId = r.sectorId;
    }
    if (!item.phone && phone) item.phone = phone;
    if (!item.memberCode && code) item.memberCode = code;
  });

  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// GET /api/consultas/resumo?from=&to=&sectorId=&congregationId=
// Consolida, numa única chamada, tudo que o usuário precisa ver na tela de Consultas.
router.get('/resumo', async (req, res, next) => {
  try {
    requireAccess(req);
    const q = req.query || {};
    const role = req.user.role;
    // Isolamento por instância: congregação enxerga só a própria congregação;
    // setor enxerga só o próprio setor; sede enxerga tudo.
    const isCongregation = role === 'tesoureiro_congregacao';
    const canSeeSectorLevel = role === 'sede' || role === 'tesoureiro_setor';
    const range = parseRange(q);
    const toDate = q.to ? new Date(String(q.to)) : new Date();
    const weekStart = resolveWeekStart(toDate);
    const { start: weekFrom, end: weekTo } = weekBounds(weekStart);
    const weekInfo = isoWeekInfo(weekStart);
    const where = scopedWhere(req.user, q);

    const sectorFilter = role === 'sede'
      ? (q.sectorId ? { id: Number(q.sectorId) } : {})
      : { id: req.user.sectorId };
    const sectorsRaw = await prisma.sector.findMany({
      where: sectorFilter,
      orderBy: { id: 'asc' },
      include: { congregations: { orderBy: { name: 'asc' } } },
    });

    const selectedCongId = q.congregationId ? Number(q.congregationId) : null;
    if (role === 'tesoureiro_congregacao') {
      sectorsRaw.forEach((s) => {
        s.congregations = s.congregations.filter((c) => c.id === req.user.congregationId);
      });
    } else if (selectedCongId) {
      sectorsRaw.forEach((s) => {
        s.congregations = s.congregations.filter((c) => c.id === selectedCongId);
      });
    }
    const visibleSectors = sectorsRaw.filter((s) => s.congregations.length > 0);
    const sectorIds = visibleSectors.map((s) => s.id);
    const congIds = visibleSectors.flatMap((s) => s.congregations.map((c) => c.id));
    const sectorIdsWhere = { sectorId: { in: sectorIds.length ? sectorIds : [-1] } };

    const incomeWhere = {
      ...where,
      ...sectorIdsWhere,
      ...(range ? { date: range } : {}),
      ...CONFIRMED_RECEIPT,
      NOT: [{ status: 'pendente' }, { reviewStatus: 'voided' }],
    };
    const expenseWhere = {
      ...where,
      ...sectorIdsWhere,
      ...(range ? { date: range } : {}),
      NOT: ACTIVE_EXPENSE_NOT,
    };
    const payableWhere = {
      ...where,
      ...sectorIdsWhere,
      ...(range ? { dueDate: range } : {}),
      status: { in: OPEN_PAYABLE_STATUSES },
    };
    const pendingExpenseWhere = {
      ...where,
      ...sectorIdsWhere,
      date: { gte: weekFrom, lte: weekTo },
      ...PENDING_EXPENSE_WHERE,
    };

    // Fechamentos: a congregação só pode consultar os fechamentos da própria
    // congregação. Fechamento de setor/prestação são instâncias superiores.
    const closureWhere = isCongregation
      ? { weekStart, sectorId: req.user.sectorId, congregationId: req.user.congregationId }
      : { weekStart, ...sectorIdsWhere };
    const prestacaoWhere = {
      weekStart,
      sectorId: canSeeSectorLevel ? { in: sectorIds } : -1,
    };

    const [receipts, expenses, payables, pendingExpenses, closures, prestacoes] = await Promise.all([
      prisma.receipt.findMany({
        where: incomeWhere,
        select: {
          id: true, date: true, type: true, value: true, payment: true,
          personName: true, personMemberCode: true, personUserId: true,
          sectorId: true, congregationId: true, source: true,
        },
        orderBy: { date: 'desc' },
      }),
      prisma.expense.findMany({
        where: expenseWhere,
        select: { id: true, date: true, value: true, sectorId: true, congregationId: true, status: true, reviewStatus: true },
        orderBy: { date: 'desc' },
      }),
      prisma.payable.findMany({
        where: payableWhere,
        select: { id: true, amount: true, amountPaid: true, sectorId: true, congregationId: true, status: true, dueDate: true },
      }),
      prisma.expense.findMany({
        where: pendingExpenseWhere,
        select: { id: true, value: true, congregationId: true },
      }),
      prisma.weekClosure.findMany({ where: closureWhere }),
      prisma.prestacao.findMany({ where: prestacaoWhere }),
    ]);

    const userIds = Array.from(new Set(receipts.map((r) => r.personUserId).filter(Boolean)));
    const memberCodes = Array.from(new Set(receipts.map((r) => r.personMemberCode).filter(Boolean)));
    const users = userIds.length || memberCodes.length
      ? await prisma.user.findMany({
        where: {
          OR: [
            { id: { in: userIds } },
            { memberCode: { in: memberCodes.map(String) } },
          ],
        },
        select: { id: true, name: true, phone: true, memberCode: true },
      })
      : [];

    const contributors = buildContributors(receipts, users);
    const income = receipts.reduce((acc, r) => acc + num(r.value), 0);
    const expense = expenses.reduce((acc, e) => acc + num(e.value), 0);
    const payablesOpen = payables.reduce((acc, p) => acc + Math.max(0, num(p.amount) - num(p.amountPaid)), 0);
    const pendingByCong = new Map();
    pendingExpenses.forEach((e) => {
      pendingByCong.set(e.congregationId, (pendingByCong.get(e.congregationId) || 0) + 1);
    });
    const incomeByCong = new Map();
    const expenseByCong = new Map();
    receipts.forEach((r) => incomeByCong.set(r.congregationId, (incomeByCong.get(r.congregationId) || 0) + num(r.value)));
    expenses.forEach((e) => expenseByCong.set(e.congregationId, (expenseByCong.get(e.congregationId) || 0) + num(e.value)));
    const openPayablesByCong = new Map();
    payables.forEach((p) => openPayablesByCong.set(
      p.congregationId,
      (openPayablesByCong.get(p.congregationId) || 0) + Math.max(0, num(p.amount) - num(p.amountPaid))
    ));
    const contributorsByCong = new Map();
    contributors.forEach((c) => contributorsByCong.set(c.congregationId, (contributorsByCong.get(c.congregationId) || 0) + 1));

    const closureByCong = new Map();
    const closureBySector = new Map();
    closures.forEach((c) => {
      if (c.scope === 'congregacao') closureByCong.set(c.congregationId, c);
      else closureBySector.set(c.sectorId, c);
    });
    const prestacaoBySector = new Map(prestacoes.map((p) => [p.sectorId, p]));

    const congregations = [];
    for (const sector of visibleSectors) {
      for (const cong of sector.congregations) {
        const congIncome = incomeByCong.get(cong.id) || 0;
        const congExpense = expenseByCong.get(cong.id) || 0;
        const pendingCount = pendingByCong.get(cong.id) || 0;
        const ratio = congIncome > 0 ? congExpense / congIncome : (congExpense > 0 ? 1 : 0);
        const exceeded = congIncome > 0 && congExpense > congIncome * EXPENSE_LIMIT_RATIO;
        const cl = closureByCong.get(cong.id) || null;
        const info = closureInfo(cl);
        const allowed = canManageCongregation(req.user, sector.id, cong.id);
        const validated = info.status === 'validated';
        let statusLabel = 'Tudo certo — pode fechar';
        let tone = 'ok';
        if (validated) { statusLabel = 'Fechamento validado'; tone = 'ok'; }
        else if (info.status === 'closed') { statusLabel = 'Fechado — aguardando validação'; tone = 'wait'; }
        else if (pendingCount > 0) { statusLabel = `${pendingCount} despesa(s) aguardando aprovação`; tone = 'alert'; }
        else if (exceeded) { statusLabel = 'Atenção: despesas acima de 40%'; tone = 'alert'; }

        congregations.push({
          id: cong.id,
          code: cong.code,
          name: cong.name,
          sectorId: sector.id,
          // A congregação nunca recebe o nome do setor (instância superior).
          sectorName: isCongregation ? '' : sector.name,
          income: congIncome,
          expense: congExpense,
          balance: congIncome - congExpense,
          pendingExpenses: pendingCount,
          openPayables: openPayablesByCong.get(cong.id) || 0,
          contributors: contributorsByCong.get(cong.id) || 0,
          ratio,
          exceeded,
          closure: info,
          statusLabel,
          tone,
          canClose: allowed && !cl && pendingCount === 0,
          canValidate: (role === 'sede' || role === 'tesoureiro_setor') && info.status === 'closed',
        });
      }
    }

    // Congregação nunca recebe o bloco de acerto setor × sede (instância superior).
    const sectors = [];
    for (const sector of (canSeeSectorLevel ? visibleSectors : [])) {
      const secIncome = sector.congregations.reduce((acc, c) => acc + (incomeByCong.get(c.id) || 0), 0);
      const secExpense = sector.congregations.reduce((acc, c) => acc + (expenseByCong.get(c.id) || 0), 0);
      const secClosures = sector.congregations.map((c) => closureByCong.get(c.id)).filter(Boolean);
      const validatedCount = secClosures.filter((c) => c.status === 'validated').length;
      const closedCount = secClosures.filter((c) => c.status === 'closed').length;
      const pendingCount = sector.congregations.reduce((acc, c) => acc + (pendingByCong.get(c.id) || 0), 0);
      const acl = closureBySector.get(sector.id) || null;
      const aInfo = closureInfo(acl);
      const prestacao = prestacaoInfo(prestacaoBySector.get(sector.id) || null);
      const settlement = await settlementSummary(sector.id, weekStart);
      const allowed = canManageSector(req.user, sector.id);
      let statusLabel = 'Tudo certo — pode fechar';
      let tone = 'ok';
      if (aInfo.status === 'validated') { statusLabel = 'Fechamento validado'; tone = 'ok'; }
      else if (aInfo.status === 'closed') { statusLabel = 'Fechado — aguardando validação'; tone = 'wait'; }
      else if (validatedCount < sector.congregations.length) {
        statusLabel = `Faltam ${sector.congregations.length - validatedCount} congregação(ões)`;
        tone = 'alert';
      } else if (pendingCount > 0) { statusLabel = 'Aguardando aprovação de despesas'; tone = 'alert'; }

      sectors.push({
        id: sector.id,
        name: sector.name,
        code: String(sector.id).padStart(2, '0'),
        income: secIncome,
        expense: secExpense,
        balance: secIncome - secExpense,
        congregations: sector.congregations.length,
        validatedCongregations: validatedCount,
        closedCongregations: closedCount,
        pendingExpenses: pendingCount,
        closure: aInfo,
        prestacao,
        settlement: settlement || null,
        statusLabel,
        tone,
        canClose: allowed && !acl && validatedCount === sector.congregations.length,
        canValidate: role === 'sede' && aInfo.status === 'closed',
      });
    }

    const attentionCount = congregations.filter((c) => c.tone === 'alert').length;
    const overall = {
      tone: attentionCount ? 'alert' : 'ok',
      label: attentionCount
        ? `Atenção: ${attentionCount} local(is) precisam de ajuste antes de fechar`
        : 'Tudo certo até agora — sem pendências para fechar',
      needAttention: attentionCount,
      weekLabel: weekInfo.label,
      weekStart: weekStart.toISOString(),
    };

    res.json({
      period: {
        from: q.from || null,
        to: q.to || null,
        generatedAt: new Date().toISOString(),
      },
      scope: {
        role,
        sectorId: where.sectorId ?? null,
        congregationId: where.congregationId ?? null,
        label: role === 'sede' ? 'Sede (todos os setores)'
          : role === 'tesoureiro_setor' ? `Setor ${req.user.sectorId}`
            : `Congregação ${req.user.congregationId}`,
      },
      week: {
        start: weekStart.toISOString(),
        label: weekInfo.label,
        number: weekInfo.week,
        year: weekInfo.year,
      },
      totals: {
        income,
        expense,
        balance: income - expense,
        payablesOpen,
        receipts: receipts.length,
        expenses: expenses.length,
        contributors: contributors.length,
        titheContributors: contributors.filter((c) => c.titheCount > 0).length,
      },
      overall,
      congregations,
      sectors,
      contributors,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
