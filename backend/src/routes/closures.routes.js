const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { closure: serializeClosure, prestacao: serializePrestacao } = require('../lib/serialize');
const { resolveWeekStart, weekBounds, isoWeekInfo, EXPENSE_LIMIT_RATIO } = require('../lib/week');
const { weekSums, CONFIRMED_RECEIPT } = require('../lib/weekly');
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
    const info = isoWeekInfo(weekStart);
    res.json({
      week: weekStart.toISOString(),
      weekNumber: info.week,
      weekYear: info.year,
      weekLabel: info.label,
      closures: closures.map(serializeClosure),
    });
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
      prisma.receipt.findMany({ where: { ...CONFIRMED_RECEIPT, date: { gte: start, lte: end } }, select: { sectorId: true, congregationId: true, value: true } }),
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

    const info = isoWeekInfo(weekStart);
    res.json({
      week: weekStart.toISOString(),
      weekNumber: info.week,
      weekYear: info.year,
      weekLabel: info.label,
      sectors: summary,
    });
  } catch (e) {
    next(e);
  }
});

// Visão geral por semana (número da semana anual + períodos):
// - congregações em aberto / fechadas / validadas (estágio congregação -> setor)
// - prestação e fechamento do setor (estágio setor -> sede)
router.get('/overview', async (req, res, next) => {
  try {
    const role = req.user.role;
    if (role !== 'sede' && role !== 'tesoureiro_setor' && role !== 'tesoureiro_congregacao') {
      throw httpError(403, 'Sem acesso à visão geral de fechamentos');
    }
    const weeksCount = Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26);
    const anchor = resolveWeekStart(req.query.week);
    const weekStarts = [];
    for (let i = 0; i < weeksCount; i++) {
      weekStarts.push(resolveWeekStart(new Date(anchor.getTime() - i * 7 * 86400000)));
    }
    const firstWeek = weekStarts[weekStarts.length - 1];
    const { end: lastEnd } = weekBounds(anchor);
    const nowWeekStart = resolveWeekStart(new Date());

    const sectorWhere = role === 'sede' ? {} : { id: req.user.sectorId };
    const sectorsRaw = await prisma.sector.findMany({
      where: sectorWhere,
      orderBy: { id: 'asc' },
      include: { congregations: { orderBy: { code: 'asc' } } },
    });
    // Tesoureiro de congregação vê apenas a própria congregação.
    const sectors = sectorsRaw.map((s) => (
      role === 'tesoureiro_congregacao'
        ? { ...s, congregations: s.congregations.filter((c) => c.id === req.user.congregationId) }
        : s
    ));
    const sectorIds = sectors.map((s) => s.id);
    const congFilter = role === 'tesoureiro_congregacao' ? { congregationId: req.user.congregationId } : {};

    const [closures, prestacoes, receipts, expenses] = await Promise.all([
      prisma.weekClosure.findMany({ where: { sectorId: { in: sectorIds }, weekStart: { gte: firstWeek } } }),
      prisma.prestacao.findMany({ where: { sectorId: { in: sectorIds }, weekStart: { gte: firstWeek } } }),
      prisma.receipt.findMany({
        where: { sectorId: { in: sectorIds }, ...congFilter, ...CONFIRMED_RECEIPT, date: { gte: firstWeek, lte: lastEnd } },
        select: { sectorId: true, congregationId: true, value: true, date: true },
      }),
      prisma.expense.findMany({
        where: { sectorId: { in: sectorIds }, ...congFilter, date: { gte: firstWeek, lte: lastEnd } },
        select: { sectorId: true, congregationId: true, value: true, date: true },
      }),
    ]);

    const weekKeyOf = (d) => resolveWeekStart(d).getTime();
    const incomeBy = new Map();
    const expenseBy = new Map();
    receipts.forEach((r) => {
      const k = `${weekKeyOf(r.date)}|${r.sectorId}|${r.congregationId ?? ''}`;
      incomeBy.set(k, (incomeBy.get(k) || 0) + Number(r.value));
    });
    expenses.forEach((e) => {
      const k = `${weekKeyOf(e.date)}|${e.sectorId}|${e.congregationId ?? ''}`;
      expenseBy.set(k, (expenseBy.get(k) || 0) + Number(e.value));
    });

    const closureMap = new Map(closures.map((c) => [
      `${c.weekStart.getTime()}|${c.scope}|${c.sectorId}|${c.congregationId ?? ''}`, c,
    ]));
    const prestacaoMap = new Map(prestacoes.map((p) => [`${p.weekStart.getTime()}|${p.sectorId}`, p]));

    const weeks = weekStarts.map((weekStart) => {
      const info = isoWeekInfo(weekStart);
      const { start, end } = weekBounds(weekStart);
      const wkTime = weekStart.getTime();

      const sectorRows = sectors.map((sector) => {
        const sectorClosure = closureMap.get(`${wkTime}|setor|${sector.id}|`) || null;
        const prestacao = prestacaoMap.get(`${wkTime}|${sector.id}`) || null;

        const congregations = sector.congregations.map((cong) => {
          const cl = closureMap.get(`${wkTime}|congregacao|${sector.id}|${cong.id}`) || null;
          const k = `${wkTime}|${sector.id}|${cong.id}`;
          const income = incomeBy.get(k) || 0;
          const expense = expenseBy.get(k) || 0;
          const ratio = income > 0 ? expense / income : (expense > 0 ? 1 : 0);
          return {
            id: cong.id,
            code: cong.code,
            name: cong.name,
            status: cl ? cl.status : 'open',
            income,
            expense,
            balance: income - expense,
            ratio,
            exceeded: income > 0 && expense > income * EXPENSE_LIMIT_RATIO,
            hasMovement: income > 0 || expense > 0,
            closure: cl ? serializeClosure(cl) : null,
          };
        });

        const open = congregations.filter((c) => c.status === 'open').length;
        const closed = congregations.filter((c) => c.status === 'closed').length;
        const validated = congregations.filter((c) => c.status === 'validated').length;

        return {
          sectorId: sector.id,
          sectorName: sector.name,
          sectorCode: String(sector.id).padStart(2, '0'),
          closure: sectorClosure ? serializeClosure(sectorClosure) : null,
          sectorStatus: sectorClosure ? sectorClosure.status : 'open',
          prestacao: prestacao ? serializePrestacao(prestacao) : null,
          toSede: {
            prestacaoStatus: prestacao ? prestacao.status : 'open',
            sentAt: prestacao && prestacao.submittedAt ? prestacao.submittedAt.toISOString() : null,
            receivedAt: prestacao && prestacao.receivedAt ? prestacao.receivedAt.toISOString() : null,
            received: !!(prestacao && prestacao.status === 'received'),
          },
          congregations,
          totals: { congregations: congregations.length, open, closed, validated, pending: open + closed },
        };
      });

      const totals = sectorRows.reduce((acc, s) => {
        acc.congregations += s.totals.congregations;
        acc.open += s.totals.open;
        acc.closed += s.totals.closed;
        acc.validated += s.totals.validated;
        acc.pending += s.totals.pending;
        acc.sectors += 1;
        if (s.toSede.received) acc.sectorsReceived += 1;
        return acc;
      }, { congregations: 0, open: 0, closed: 0, validated: 0, pending: 0, sectors: 0, sectorsReceived: 0 });

      return {
        weekStart: weekStart.toISOString(),
        weekNumber: info.week,
        weekYear: info.year,
        label: info.label,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        isCurrent: wkTime === nowWeekStart.getTime(),
        sectors: sectorRows,
        totals,
      };
    });

    const anchorInfo = isoWeekInfo(anchor);
    res.json({
      anchorWeek: anchor.toISOString(),
      anchorWeekNumber: anchorInfo.week,
      anchorWeekYear: anchorInfo.year,
      weeks,
    });
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
    if (validated.size < sector.congregations.length && req.user.role !== 'sede') {
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
    // Tesoureiro de setor pode reabrir movimentos/fechamentos SOMENTE das suas congregações (não do setor).
    if (req.user.role === 'tesoureiro_setor' && closure.scope === 'setor') {
      throw httpError(403, 'Tesoureiro de setor só pode reabrir fechamentos de congregações (não do setor)');
    }

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
