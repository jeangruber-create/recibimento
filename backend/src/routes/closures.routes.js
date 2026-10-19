const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { closure: serializeClosure } = require('../lib/serialize');
const { resolveWeekStart, weekBounds, EXPENSE_LIMIT_RATIO } = require('../lib/week');
const { weekSums } = require('../lib/weekly');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

const closeSchema = z.object({
  scope: z.enum(['congregacao', 'setor']),
  week: z.string().optional(),
  sectorId: z.number().int().positive().optional(),
  congregationId: z.number().int().positive().optional(),
  justification: z.string().optional(),
});

function startOfWeek(week) {
  return resolveWeekStart(week);
}

function canManageClosure(user, sectorId, congregationId) {
  if (user.role === 'sede') return true;
  if (user.role === 'tesoureiro_setor') return user.sectorId === sectorId;
  if (user.role === 'tesoureiro_congregacao') return user.congregationId === congregationId;
  return false;
}

function getClosure(scope, sectorId, congregationId, weekStart) {
  return prisma.weekClosure.findFirst({
    where: { scope, sectorId, congregationId: congregationId ?? null, weekStart },
  });
}

async function upsertAlert(db, { scope, sectorId, congregationId, weekStart, sums, justification, user }) {
  const cid = congregationId ?? null;
  const existing = await db.alert.findFirst({ where: { scope, sectorId, congregationId: cid, weekStart } });
  const data = {
    type: 'excedente_despesa',
    scope,
    sectorId,
    congregationId: cid,
    weekStart,
    income: sums.income,
    expense: sums.expense,
    ratio: sums.ratio,
    limitPct: EXPENSE_LIMIT_RATIO,
  };
  if (justification !== undefined) data.justification = justification;
  if (existing) return db.alert.update({ where: { id: existing.id }, data });
  return db.alert.create({ data: { ...data, createdBy: user?.name || '' } });
}

router.get('/', async (req, res, next) => {
  try {
    const weekStart = resolveWeekStart(req.query.week);
    const where = { weekStart };
    if (req.user.role === 'tesoureiro_setor') where.sectorId = req.user.sectorId;
    else if (req.user.role === 'tesoureiro_congregacao') where.congregationId = req.user.congregationId;
    else if (req.user.role !== 'sede') throw httpError(403, 'Sem acesso aos fechamentos');
    const closures = await prisma.weekClosure.findMany({ where });
    res.json({ week: weekStart.toISOString(), closures: closures.map(serializeClosure) });
  } catch (e) {
    next(e);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede' && req.user.role !== 'tesoureiro_setor') {
      throw httpError(403, 'Sem acesso ao resumo por setor');
    }
    const weekStart = resolveWeekStart(req.query.week);
    const { start, end } = weekBounds(weekStart);

    const sectorWhere = req.user.role === 'sede' ? {} : { id: req.user.sectorId };
    const sectors = await prisma.sector.findMany({
      where: sectorWhere,
      orderBy: { id: 'asc' },
      include: { congregations: { orderBy: { name: 'asc' } } },
    });
    const [receipts, expenses, closures] = await Promise.all([
      prisma.receipt.findMany({ where: { date: { gte: start, lte: end } }, select: { sectorId: true, congregationId: true, value: true } }),
      prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, select: { sectorId: true, congregationId: true, value: true } }),
      prisma.weekClosure.findMany({ where: { weekStart } }),
    ]);

    const incomeByCong = new Map();
    const expenseByCong = new Map();
    receipts.forEach((r) => incomeByCong.set(r.congregationId, (incomeByCong.get(r.congregationId) || 0) + Number(r.value)));
    expenses.forEach((e) => expenseByCong.set(e.congregationId, (expenseByCong.get(e.congregationId) || 0) + Number(e.value)));

    const closureBy = new Map();
    closures.forEach((c) => closureBy.set(`${c.scope}:${c.sectorId}:${c.congregationId ?? ''}`, c));

    const summary = sectors.map((sector) => {
      let sectorIncome = 0;
      let sectorExpense = 0;
      let validatedCount = 0;
      const congregations = sector.congregations.map((cong) => {
        const income = incomeByCong.get(cong.id) || 0;
        const expense = expenseByCong.get(cong.id) || 0;
        const ratio = income > 0 ? expense / income : expense > 0 ? 1 : 0;
        sectorIncome += income;
        sectorExpense += expense;
        const closure = closureBy.get(`congregacao:${sector.id}:${cong.id}`) || null;
        if (closure && closure.status === 'validated') validatedCount += 1;
        return {
          id: cong.id,
          name: cong.name,
          income,
          expense,
          balance: income - expense,
          ratio,
          exceeded: income > 0 && expense > income * EXPENSE_LIMIT_RATIO,
          closure: closure ? serializeClosure(closure) : null,
        };
      });
      const sectorClosure = closureBy.get(`setor:${sector.id}:`) || null;
      return {
        sectorId: sector.id,
        sectorName: sector.name,
        income: sectorIncome,
        expense: sectorExpense,
        balance: sectorIncome - sectorExpense,
        ratio: sectorIncome > 0 ? sectorExpense / sectorIncome : sectorExpense > 0 ? 1 : 0,
        exceeded: sectorIncome > 0 && sectorExpense > sectorIncome * EXPENSE_LIMIT_RATIO,
        totalCongregations: congregations.length,
        validatedCongregations: validatedCount,
        closure: sectorClosure ? serializeClosure(sectorClosure) : null,
        congregations,
      };
    });

    res.json({ week: weekStart.toISOString(), sectors: summary });
  } catch (e) {
    next(e);
  }
});

router.post('/close', async (req, res, next) => {
  try {
    const data = closeSchema.parse(req.body);
    const weekStart = resolveWeekStart(data.week);

    if (data.scope === 'congregacao') {
      if (!data.congregationId) throw httpError(400, 'congregationId é obrigatório');
      const cong = await prisma.congregation.findUnique({ where: { id: data.congregationId } });
      if (!cong) throw httpError(404, 'Congregação não encontrada');
      if (!canManageClosure(req.user, cong.sectorId, cong.id)) throw httpError(403, 'Sem permissão para fechar esta congregação');

      const existing = await getClosure('congregacao', cong.sectorId, cong.id, weekStart);
      if (existing) return res.status(200).json({ closure: serializeClosure(existing) });

      const sums = await weekSums({ congregationId: cong.id }, weekStart);
      const closure = await prisma.$transaction(async (tx) => {
        const created = await tx.weekClosure.create({
          data: {
            weekStart,
            scope: 'congregacao',
            sectorId: cong.sectorId,
            congregationId: cong.id,
            income: sums.income,
            expense: sums.expense,
            balance: sums.balance,
            ratio: sums.ratio,
            exceeded: sums.exceeded,
            justification: data.justification || '',
            status: 'closed',
            closedBy: req.user.name || '',
            closedAt: new Date(),
          },
        });
        if (sums.exceeded) {
          await upsertAlert(tx, { scope: 'congregacao', sectorId: cong.sectorId, congregationId: cong.id, weekStart, sums, justification: data.justification, user: req.user });
        }
        await logAudit(tx, {
          user: req.user,
          action: 'closure.close',
          entity: 'WeekClosure',
          entityId: created.id,
          sectorId: cong.sectorId,
          congregationId: cong.id,
          summary: `Fechamento de congregação (${weekStart.toISOString().slice(0, 10)})`,
          after: { income: sums.income, expense: sums.expense, ratio: sums.ratio, exceeded: sums.exceeded },
        });
        return created;
      });
      return res.status(201).json({ closure: serializeClosure(closure) });
    }

    const sectorId = req.user.role === 'sede' ? data.sectorId : req.user.sectorId;
    if (!sectorId) throw httpError(400, 'sectorId é obrigatório');
    const sector = await prisma.sector.findUnique({ where: { id: sectorId }, include: { congregations: true } });
    if (!sector) throw httpError(404, 'Setor não encontrado');
    if (!canManageClosure(req.user, sector.id, null)) throw httpError(403, 'Sem permissão para fechar este setor');

    const closuresForWeek = await prisma.weekClosure.findMany({ where: { weekStart, scope: 'congregacao', sectorId: sector.id } });
    const validated = new Set(closuresForWeek.filter((c) => c.status === 'validated').map((c) => c.congregationId));
    if (validated.size < sector.congregations.length) {
      throw httpError(400, 'Todas as congregações precisam estar validadas antes de fechar o setor');
    }

    const existingSector = await getClosure('setor', sector.id, null, weekStart);
    if (existingSector) return res.status(200).json({ closure: serializeClosure(existingSector) });

    const sums = await weekSums({ sectorId: sector.id }, weekStart);
    const closure = await prisma.$transaction(async (tx) => {
      const created = await tx.weekClosure.create({
        data: {
          weekStart,
          scope: 'setor',
          sectorId: sector.id,
          congregationId: null,
          income: sums.income,
          expense: sums.expense,
          balance: sums.balance,
          ratio: sums.ratio,
          exceeded: sums.exceeded,
          justification: data.justification || '',
          status: 'closed',
          closedBy: req.user.name || '',
          closedAt: new Date(),
        },
      });
      if (sums.exceeded) {
        await upsertAlert(tx, { scope: 'setor', sectorId: sector.id, congregationId: null, weekStart, sums, justification: data.justification, user: req.user });
      }
      await logAudit(tx, {
        user: req.user,
        action: 'closure.close',
        entity: 'WeekClosure',
        entityId: created.id,
        sectorId: sector.id,
        summary: `Fechamento de setor (${weekStart.toISOString().slice(0, 10)})`,
        after: { income: sums.income, expense: sums.expense, ratio: sums.ratio, exceeded: sums.exceeded },
      });
      return created;
    });
    res.status(201).json({ closure: serializeClosure(closure) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/validate', async (req, res, next) => {
  try {
    const body = z.object({ justification: z.string().optional() }).parse(req.body || {});
    const closure = await prisma.weekClosure.findUnique({ where: { id: req.params.id } });
    if (!closure) throw httpError(404, 'Fechamento não encontrado');
    if (!canManageClosure(req.user, closure.sectorId, closure.congregationId)) throw httpError(403, 'Sem permissão para validar este fechamento');
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.weekClosure.update({
        where: { id: closure.id },
        data: {
          status: 'validated',
          justification: body.justification !== undefined ? body.justification : closure.justification,
          validatedBy: req.user.name || '',
          validatedAt: new Date(),
        },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'closure.validate',
        entity: 'WeekClosure',
        entityId: closure.id,
        sectorId: closure.sectorId,
        congregationId: closure.congregationId,
        summary: 'Validação de fechamento',
        before: { status: closure.status },
        after: { status: 'validated' },
      });
      return u;
    });
    res.json({ closure: serializeClosure(updated) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/reopen', async (req, res, next) => {
  try {
    const closure = await prisma.weekClosure.findUnique({ where: { id: req.params.id } });
    if (!closure) throw httpError(404, 'Fechamento não encontrado');
    if (!canManageClosure(req.user, closure.sectorId, closure.congregationId)) throw httpError(403, 'Sem permissão para reabrir este fechamento');

    await prisma.$transaction(async (tx) => {
      await tx.weekClosure.delete({ where: { id: closure.id } });
      if (closure.scope === 'congregacao') {
        await tx.weekClosure.deleteMany({ where: { weekStart: closure.weekStart, scope: 'setor', sectorId: closure.sectorId } });
      }
      await logAudit(tx, {
        user: req.user,
        action: 'closure.reopen',
        entity: 'WeekClosure',
        entityId: closure.id,
        sectorId: closure.sectorId,
        congregationId: closure.congregationId,
        summary: 'Reabertura de fechamento',
        before: { status: closure.status, income: Number(closure.income), expense: Number(closure.expense) },
      });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.put('/:id/justification', async (req, res, next) => {
  try {
    const body = z.object({ justification: z.string() }).parse(req.body || {});
    const closure = await prisma.weekClosure.findUnique({ where: { id: req.params.id } });
    if (!closure) throw httpError(404, 'Fechamento não encontrado');
    if (!canManageClosure(req.user, closure.sectorId, closure.congregationId)) throw httpError(403, 'Sem permissão para alterar este fechamento');
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.weekClosure.update({ where: { id: closure.id }, data: { justification: body.justification } });
      await logAudit(tx, {
        user: req.user,
        action: 'closure.justification',
        entity: 'WeekClosure',
        entityId: closure.id,
        sectorId: closure.sectorId,
        congregationId: closure.congregationId,
        summary: 'Alteração de justificativa',
        before: { justification: closure.justification ?? '' },
        after: { justification: body.justification },
      });
      return u;
    });
    res.json({ closure: serializeClosure(updated) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
