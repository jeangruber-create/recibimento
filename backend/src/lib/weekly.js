const prisma = require('../prisma');
const { EXPENSE_LIMIT_RATIO, weekBounds } = require('./week');
const { toNumber } = require('./serialize');

async function weekSums(where, weekStart) {
  const { start, end } = weekBounds(weekStart);
  const [inc, exp] = await Promise.all([
    prisma.receipt.aggregate({ where: { ...where, date: { gte: start, lte: end } }, _sum: { value: true } }),
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
    prisma.receipt.findMany({ where: { ...scopeWhere, date: { gte: start, lte: end } }, select: { value: true, payment: true } }),
    prisma.expense.findMany({ where: { ...scopeWhere, date: { gte: start, lte: end } }, select: { value: true, payment: true } }),
  ]);
  const incomeBy = {};
  const expenseBy = {};
  receipts.forEach((r) => {
    incomeBy[r.payment] = (incomeBy[r.payment] || 0) + toNumber(r.value);
  });
  expenses.forEach((e) => {
    expenseBy[e.payment] = (expenseBy[e.payment] || 0) + toNumber(e.value);
  });
  return { incomeBy, expenseBy };
}

async function prestacaoComputed(sectorId, weekStart) {
  const { incomeBy, expenseBy } = await findPrestacao({ sectorId }, weekStart);
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
  };
}

function prestacaoWhere(user) {
  if (user.role === 'sede') return {};
  return { sectorId: user.sectorId };
}

module.exports = { weekSums, findPrestacao, prestacaoComputed, prestacaoWhere, EXPENSE_LIMIT_RATIO };
