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

function prestacaoWhere(user) {
  if (user.role === 'sede') return {};
  return { sectorId: user.sectorId };
}

module.exports = { weekSums, findPrestacao, prestacaoComputed, prestacaoWhere, CONFIRMED_RECEIPT, EXPENSE_LIMIT_RATIO };
