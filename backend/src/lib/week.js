const EXPENSE_LIMIT_RATIO = 0.4;

function startOfWeekMonday(date) {
  const x = new Date(date);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function weekBounds(weekStart) {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function resolveWeekStart(input) {
  let d;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    d = new Date(`${input}T00:00:00`);
  } else {
    d = input ? new Date(input) : new Date();
  }
  return startOfWeekMonday(d);
}

module.exports = { EXPENSE_LIMIT_RATIO, startOfWeekMonday, weekBounds, resolveWeekStart };
