const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { prestacao: serializePrestacao } = require('../lib/serialize');
const { resolveWeekStart } = require('../lib/week');
const { prestacaoComputed } = require('../lib/weekly');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

const PROOF_MAX_BYTES = 2 * 1024 * 1024;
const TOLERANCE = 0.01;

const proofSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(3),
  size: z.number().int().nonnegative().max(PROOF_MAX_BYTES),
  data: z.string().min(16),
});

const submitSchema = z.object({
  week: z.string().optional(),
  sectorId: z.number().int().positive().optional(),
  declaredCash: z.number().nonnegative(),
  declaredPix: z.number().nonnegative().optional(),
  note: z.string().optional(),
  repasseProof: proofSchema.optional(),
  pixProofs: z.array(proofSchema).optional(),
});

function prestacaoWhere(user) {
  if (user.role === 'sede') return {};
  return { sectorId: user.sectorId };
}

function canAccessSector(user, sectorId) {
  if (user.role === 'sede') return true;
  return user.role === 'tesoureiro_setor' && user.sectorId === sectorId;
}

router.get('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede' && req.user.role !== 'tesoureiro_setor') {
      throw httpError(403, 'Sem acesso às prestações');
    }
    const weekStart = resolveWeekStart(req.query.week);
    const where = { ...prestacaoWhere(req.user), weekStart };
    const prestacoes = await prisma.prestacao.findMany({ where });
    res.json({ week: weekStart.toISOString(), prestacoes: prestacoes.map(serializePrestacao) });
  } catch (e) {
    next(e);
  }
});

router.get('/pending', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede' && req.user.role !== 'tesoureiro_setor') {
      throw httpError(403, 'Sem acesso ao indicador de pendências');
    }
    const weekStart = req.query.week ? resolveWeekStart(req.query.week) : resolveWeekStart(new Date(Date.now() - 7 * 86400000));
    const sectorWhere = req.user.role === 'sede' ? {} : { id: req.user.sectorId };
    const sectors = await prisma.sector.findMany({ where: sectorWhere, orderBy: { id: 'asc' } });
    const prestacoes = await prisma.prestacao.findMany({ where: { weekStart } });
    const bySector = new Map(prestacoes.map((p) => [p.sectorId, p]));

    const rows = [];
    for (const sector of sectors) {
      const p = bySector.get(sector.id);
      const computed = await prestacaoComputed(sector.id, weekStart);
      rows.push({
        sectorId: sector.id,
        sectorName: sector.name,
        status: p ? 'informado' : 'previsto',
        repass: p ? Number(p.declaredCash) : computed.expectedCash,
        expectedCash: computed.expectedCash,
        hasPrestacao: !!p,
        prestacaoStatus: p ? p.status : null,
      });
    }
    const total = rows.reduce((acc, r) => acc + r.repass, 0);
    res.json({ week: weekStart.toISOString(), total, sectors: rows });
  } catch (e) {
    next(e);
  }
});

router.get('/:sectorId', async (req, res, next) => {
  try {
    const sectorId = Number(req.params.sectorId);
    if (!canAccessSector(req.user, sectorId)) throw httpError(403, 'Sem acesso a esta prestação');
    const weekStart = resolveWeekStart(req.query.week);
    const computed = await prestacaoComputed(sectorId, weekStart);
    const prestacao = await prisma.prestacao.findFirst({ where: { sectorId, weekStart } });
    res.json({
      week: weekStart.toISOString(),
      computed,
      prestacao: prestacao ? serializePrestacao(prestacao) : null,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede' && req.user.role !== 'tesoureiro_setor') {
      throw httpError(403, 'Sem acesso para enviar prestações');
    }
    const data = submitSchema.parse(req.body);
    const sectorId = req.user.role === 'sede' ? data.sectorId : req.user.sectorId;
    if (!sectorId) throw httpError(400, 'sectorId é obrigatório');
    if (!canAccessSector(req.user, sectorId)) throw httpError(403, 'Sem acesso a este setor');

    const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
    if (!sector) throw httpError(404, 'Setor não encontrado');

    const weekStart = resolveWeekStart(data.week);
    const declaredPix = data.declaredPix || 0;
    const computed = await prestacaoComputed(sectorId, weekStart);

    const cashDivergent = Math.abs(data.declaredCash - computed.expectedCash) > TOLERANCE;
    const pixDivergent = Math.abs(declaredPix - computed.pixIncome) > TOLERANCE;
    if ((cashDivergent || pixDivergent) && !(data.note && data.note.trim())) {
      throw httpError(400, 'Divergência detectada: informe a justificativa');
    }
    if (computed.pixIncome > 0 && !(data.pixProofs && data.pixProofs.length)) {
      throw httpError(400, 'Comprovante PIX/POS obrigatório');
    }

    const existing = await prisma.prestacao.findFirst({ where: { sectorId, weekStart } });
    if (existing && existing.status === 'approved') throw httpError(400, 'Prestação já aprovada');
    if (existing && existing.status === 'submitted') throw httpError(400, 'Prestação já enviada e aguardando análise');

    const payload = {
      sectorId,
      weekStart,
      status: 'submitted',
      declaredCash: data.declaredCash,
      declaredPix,
      incomeBy: computed.incomeBy,
      expenseBy: computed.expenseBy,
      note: data.note || '',
      repasseProof: data.repasseProof ?? null,
      pixProofs: data.pixProofs || [],
      submittedById: req.user.sub,
      submittedAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: '',
    };

    const prestacao = await prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.prestacao.update({ where: { id: existing.id }, data: payload })
        : await tx.prestacao.create({ data: payload });
      await logAudit(tx, {
        user: req.user,
        action: existing ? 'prestacao.resubmit' : 'prestacao.submit',
        entity: 'Prestacao',
        entityId: saved.id,
        sectorId,
        summary: `Prestação da semana ${weekStart.toISOString().slice(0, 10)}`,
        after: { declaredCash: data.declaredCash, declaredPix: declaredPix, status: 'submitted' },
      });
      return saved;
    });
    res.status(201).json({ prestacao: serializePrestacao(prestacao) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede pode aprovar prestações');
    const body = z.object({ note: z.string().optional() }).parse(req.body || {});
    const prestacao = await prisma.prestacao.findUnique({ where: { id: req.params.id } });
    if (!prestacao) throw httpError(404, 'Prestação não encontrada');
    if (prestacao.status !== 'submitted') throw httpError(400, 'Prestação não está aguardando aprovação');
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.prestacao.update({
        where: { id: prestacao.id },
        data: { status: 'approved', reviewedBy: req.user.name || '', reviewedAt: new Date(), reviewNote: body.note || '' },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'prestacao.approve',
        entity: 'Prestacao',
        entityId: prestacao.id,
        sectorId: prestacao.sectorId,
        summary: 'Aprovação de prestação',
        before: { status: prestacao.status },
        after: { status: 'approved' },
      });
      return u;
    });
    res.json({ prestacao: serializePrestacao(updated) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede pode rejeitar prestações');
    const body = z.object({ note: z.string().min(1) }).parse(req.body || {});
    const prestacao = await prisma.prestacao.findUnique({ where: { id: req.params.id } });
    if (!prestacao) throw httpError(404, 'Prestação não encontrada');
    if (prestacao.status !== 'submitted') throw httpError(400, 'Prestação não está aguardando análise');
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.prestacao.update({
        where: { id: prestacao.id },
        data: { status: 'rejected', reviewedBy: req.user.name || '', reviewedAt: new Date(), reviewNote: body.note },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'prestacao.reject',
        entity: 'Prestacao',
        entityId: prestacao.id,
        sectorId: prestacao.sectorId,
        summary: body.note,
        before: { status: prestacao.status },
        after: { status: 'rejected' },
      });
      return u;
    });
    res.json({ prestacao: serializePrestacao(updated) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/reopen', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede pode reabrir prestações');
    const prestacao = await prisma.prestacao.findUnique({ where: { id: req.params.id } });
    if (!prestacao) throw httpError(404, 'Prestação não encontrada');
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.prestacao.update({
        where: { id: prestacao.id },
        data: { status: 'open', reviewedBy: null, reviewedAt: null, reviewNote: '' },
      });
      await logAudit(tx, {
        user: req.user,
        action: 'prestacao.reopen',
        entity: 'Prestacao',
        entityId: prestacao.id,
        sectorId: prestacao.sectorId,
        summary: 'Reabertura de prestação',
        before: { status: prestacao.status },
        after: { status: 'open' },
      });
      return u;
    });
    res.json({ prestacao: serializePrestacao(updated) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
