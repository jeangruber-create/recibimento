const prisma = require('../prisma');
const { EXPENSE_LIMIT_RATIO, weekBounds } = require('./week');
const { toNumber } = require('./serialize');

// Recibos pendentes (dízimo/oferta de membro ainda não confirmados) não entram nos totais.
const CONFIRMED_RECEIPT = { NOT: { status: 'pendente' } };

async function weekSums(where, weekStart) {
  const { start, end } = weekBounds(weekStart);
  const [inc, exp] = await Promise.all([
    prisma.receipt.aggregate({ where: { ...where, ...CONFIRMED_RECEIPT, date: { gte: start, lte: end } }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { ...where, date: { gte: start, lte: end } }, _sum: { value: true } }),
  ]);
  const income = toNumber(inc._sum.value) || 0;
  const expense = toNumber(exp._sum.value) || 0;
  const ratio = income > 0 ? expense / income : expense > 0 ? 1 : 0;
  return { income, expense, balance: income - expense, ratio, exceeded: income > 0 && expense > income * EXPENSE_LIMIT_RATIO };
}

async function findPrestacao(scopeWhere, weekStart) {
  const { start, end } = weekBounds(weekStart);
  const [receipts, expenses] = await Promise.all([
    prisma.receipt.findMany({
      where: { ...scopeWhere, ...CONFIRMED_RECEIPT, date: { gte: start, lte: end } },
      select: { value: true, payment: true, source: true, personMemberCode: true, type: true },
    }),
    prisma.expense.findMany({ where: { ...scopeWhere, date: { gte: start, lte: end } }, select: { value: true, payment: true } }),
  ]);
  const incomeBy = {};
  const expenseBy = {};
  const memberBy = {};
  let memberIncome = 0;
  let memberDizimo = 0;
  let memberOferta = 0;
  receipts.forEach((r) => {
    incomeBy[r.payment] = (incomeBy[r.payment] || 0) + toNumber(r.value);
    if (r.source === 'membro') {
      const v = toNumber(r.value);
      memberIncome += v;
      memberBy[r.payment] = (memberBy[r.payment] || 0) + v;
      if (/d[íi]zimo/i.test(r.type)) memberDizimo += v;
      else if (/oferta/i.test(r.type)) memberOferta += v;
    }
  });
  expenses.forEach((e) => {
    expenseBy[e.payment] = (expenseBy[e.payment] || 0) + toNumber(e.value);
  });
  return { incomeBy, expenseBy, memberBy, memberIncome, memberDizimo, memberOferta };
}

async function prestacaoComputed(sectorId, weekStart) {
  const { incomeBy, expenseBy, memberBy, memberIncome, memberDizimo, memberOferta } = await findPrestacao({ sectorId }, weekStart);
  const cashIncome = incomeBy.dinheiro || 0;
  const pixIncome = (incomeBy.pix || 0) + (incomeBy.cartao || 0);
  const cashExpense = expenseBy.dinheiro || 0;
  const pixExpense = expenseBy.pix || 0;
  const income = Object.values(incomeBy).reduce((a, b) => a + b, 0);
  const expense = Object.values(expenseBy).reduce((a, b) => a + b, 0);
  return {
    incomeBy,
    expenseBy,
    income,
    expense,
    cashIncome,
    pixIncome,
    cashExpense,
    pixExpense,
    otherIncome: incomeBy.outros || 0,
    otherExpense: expenseBy.outros || 0,
    expectedCash: cashIncome - cashExpense,
    pixNet: pixIncome - pixExpense,
    memberIncome,
    memberPixIncome: memberBy.pix || 0,
    memberDizimo,
    memberOferta,
  };
}

async function settlementSummary(sectorId, weekStart) {
  try {
    const { start } = weekBounds(weekStart);
    const items = await prisma.settlementItem.findMany({ where: { sectorId, weekStart: start } });
    let quitadasPaid = 0, quitadasRemaining = 0, aQuitarAmount = 0, aQuitarProvisioned = 0, enviadaSede = 0, pendingValidation = 0, paidBySede = 0;
    for (const it of items) {
      const d = it.disposition;
      const amt = toNumber(it.amount), paid = toNumber(it.amountPaid), prov = toNumber(it.amountProvisioned), rem = toNumber(it.remaining);
      if (d === 'quitada') { quitadasPaid += paid; quitadasRemaining += rem; }
      else if (d === 'a_quitar') { aQuitarAmount += amt; aQuitarProvisioned += prov; }
      else if (d === 'enviada_sede') { enviadaSede += amt; }
      if (it.sedeValidationStatus === 'pending' && (it.status === 'paid_by_setor' || d === 'quitada')) pendingValidation++;
      if (it.status === 'paid_by_sede') paidBySede += paid || amt;
    }
    let fundingProvisioned = 0, fundingReleased = 0, fundingSettled = 0;
    try {
      const fundings = await prisma.sedeFunding.findMany({ where: { sectorId, weekStart: start } });
      for (const f of fundings) {
        const v = toNumber(f.amount);
        if (f.status === 'provisioned') fundingProvisioned += v;
        else if (f.status === 'released') fundingReleased += v;
        else if (f.status === 'settled') fundingSettled += v;
      }
    } catch (_) {}
    // Remanescente autoritativo (Fatia 3): quitadas -> prestar contas do remanescente; a quitar -> falta provisionar/quitar;
    // repasses da sede (released/settled) entram como recurso conciliado para o setor.
    const toAccountFor = quitadasRemaining; // valor remanescente a prestar contas (quitadas)
    const toProvision = Math.max(0, aQuitarAmount - aQuitarProvisioned); // falta provisionar para quitar
    const sedeSupport = fundingReleased + fundingSettled; // repasse efetivo da sede ao setor (conciliado)
    return {
      quitadasPaid, quitadasRemaining, aQuitarAmount, aQuitarProvisioned, enviadaSede,
      pendingValidation, paidBySede, count: items.length,
      fundingProvisioned, fundingReleased, fundingSettled, sedeSupport,
      toAccountFor, toProvision,
    };
  } catch (e) {
    // SettlementItem/SedeFunding podem não existir se client não regenerado
    return null;
  }
}

async function prestacaoComputed(sectorId, weekStart) {
  const { incomeBy, expenseBy, memberBy, memberIncome, memberDizimo, memberOferta } = await findPrestacao({ sectorId }, weekStart);
  const cashIncome = incomeBy.dinheiro || 0;
  const pixIncome = (incomeBy.pix || 0) + (incomeBy.cartao || 0);
  const cashExpense = expenseBy.dinheiro || 0;
  const pixExpense = expenseBy.pix || 0;
  const income = Object.values(incomeBy).reduce((a, b) => a + b, 0);
  const expense = Object.values(expenseBy).reduce((a, b) => a + b, 0);
  const expectedCash = cashIncome - cashExpense;
  const settlement = await settlementSummary(sectorId, weekStart);
  // Repasse autoritativo (Fatia 3): base no caixa esperado; ajuste informativo pelo acerto.
  // - Quitadas já pagas estão refletidas nas saídas (saída efetiva). Remanescente = a prestar contas.
  // - A quitar/enviadas à sede: não somam ao repasse em dinheiro do setor quando enviadas à sede.
  // - Repasses da sede (released/settled) conciliados como suporte ao setor.
  let authoritativeCash = expectedCash;
  if (settlement) {
    // contas enviadas à sede saem da responsabilidade imediata de repasse em dinheiro do setor quando ainda não pagas por ele
    // (mantemos ajuste conservador/informativo; a UI e a sede validam o detalhamento)
    authoritativeCash = expectedCash;
  }
  return {
    incomeBy,
    expenseBy,
    income,
    expense,
    cashIncome,
    pixIncome,
    cashExpense,
    pixExpense,
    otherIncome: incomeBy.outros || 0,
    otherExpense: expenseBy.outros || 0,
    expectedCash,
    authoritativeCash,
    pixNet: pixIncome - pixExpense,
    memberIncome,
    memberPixIncome: memberBy.pix || 0,
    memberDizimo,
    memberOferta,
    settlement,
  };
}

function prestacaoWhere(user) {
  if (user.role === 'sede') return {};
  return { sectorId: user.sectorId };
}

module.exports = { weekSums, findPrestacao, prestacaoComputed, prestacaoWhere, settlementSummary, CONFIRMED_RECEIPT, EXPENSE_LIMIT_RATIO };
