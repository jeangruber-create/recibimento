const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { canManage } = require('../lib/roles');
const { resolveWeekStart } = require('../lib/week');
const { logAudit } = require('../lib/audit');
const serialize = require('../lib/serialize');

const router = express.Router();
router.use(authRequired);

function requireManage(req) {
  if (!canManage(req.user)) throw httpError(403, 'Acesso restrito à gestão');
}
function resolveSector(req, bodyOrQuery) {
  const src = bodyOrQuery || {};
  if (req.user.role === 'sede') return src.sectorId ? Number(src.sectorId) : null;
  if (req.user.role === 'tesoureiro_setor') return req.user.sectorId;
  return null; // tesoureiro_congregacao/others: acerto é por setor
}
function assertSectorAccess(req, sectorId) {
  if (req.user.role === 'sede') return;
  if (req.user.role === 'tesoureiro_setor' && Number(req.user.sectorId) === Number(sectorId)) return;
  throw httpError(403, 'Sem acesso a este setor');
}

function defaultDisposition(p) {
  if (p.sentToSede) return 'enviada_sede';
  if (['paid', 'partially_paid'].includes(p.status) || Number(p.amountPaid || 0) > 0) return 'quitada';
  return 'a_quitar';
}
function computeRemaining(amount, amountPaid, amountProvisioned, disposition) {
  const a = Number(amount || 0), paid = Number(amountPaid || 0), prov = Number(amountProvisioned || 0);
  if (disposition === 'quitada') return Math.max(0, a - paid);
  return Math.max(0, a - Math.max(paid, prov));
}

async function syncPayablesForWeek(sectorId, weekStart) {
  // Pre-registra payables relevantes no acerto (idempotente por payableId+sectorId+weekStart)
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const payables = await prisma.payable.findMany({
    where: {
      sectorId,
      OR: [
        { dueDate: { gte: weekStart, lt: weekEnd } },
        { sentToSede: true },
        { isBasic: true },
        { status: { in: ['pending_approval', 'approved', 'scheduled', 'partially_paid', 'paid'] } },
      ],
    },
    orderBy: { dueDate: 'asc' },
  });
  const existing = await prisma.settlementItem.findMany({ where: { sectorId, weekStart, payableId: { not: null } } });
  const byPayable = new Map(existing.map(e => [e.payableId, e]));
  let created = 0;
  for (const p of payables) {
    if (byPayable.has(p.id)) continue;
    const disp = defaultDisposition(p);
    const amount = Number(p.amount || 0);
    const amountPaid = Number(p.amountPaid || 0);
    const remaining = computeRemaining(amount, amountPaid, 0, disp);
    await prisma.settlementItem.create({
      data: {
        sectorId,
        congregationId: p.congregationId,
        weekStart,
        payableId: p.id,
        label: `${p.category || 'Conta'}${p.payee ? ' - ' + p.payee : ''}`,
        category: p.category || null,
        isBasic: !!p.isBasic,
        disposition: disp,
        amount,
        amountPaid,
        amountProvisioned: 0,
        remaining,
        responsible: p.sentToSede ? 'sede' : 'setor',
        status: ['paid'].includes(p.status) ? (p.sentToSede ? 'paid_by_sede' : 'paid_by_setor') : 'registered',
        sedeValidationStatus: 'pending',
        note: p.description || null,
      },
    });
    created++;
  }
  return created;
}

function summarize(items) {
  let quitadasPaid = 0, quitadasRemaining = 0, aQuitarAmount = 0, aQuitarProvisioned = 0, enviadaSede = 0, pendingValidation = 0;
  for (const it of items) {
    const d = it.disposition;
    if (d === 'quitada') { quitadasPaid += Number(it.amountPaid || 0); quitadasRemaining += Number(it.remaining || 0); }
    else if (d === 'a_quitar') { aQuitarAmount += Number(it.amount || 0); aQuitarProvisioned += Number(it.amountProvisioned || 0); }
    else if (d === 'enviada_sede') { enviadaSede += Number(it.amount || 0); }
    if (it.sedeValidationStatus === 'pending' && (it.status === 'paid_by_setor' || d === 'quitada')) pendingValidation++;
  }
  return { quitadasPaid, quitadasRemaining, aQuitarAmount, aQuitarProvisioned, enviadaSede, pendingValidation, count: items.length };
}

router.get('/items', async (req, res, next) => {
  try {
    requireManage(req);
    const weekStart = resolveWeekStart(req.query.week);
    const sectorId = resolveSector(req, req.query);
    if (!sectorId) {
      if (req.user.role === 'sede') return res.json({ week: weekStart.toISOString(), sectorId: null, items: [], summary: summarize([]), note: 'Informe sectorId (sede)' });
      throw httpError(403, 'Acerto disponível para setor/admin (sede). Tesoureiro de congregação: consulte seu setor.');
    }
    assertSectorAccess(req, sectorId);
    let items = await prisma.settlementItem.findMany({ where: { sectorId, weekStart }, orderBy: [{ disposition: 'asc' }, { category: 'asc' }, { createdAt: 'asc' }] });
    if (items.length === 0) {
      await syncPayablesForWeek(sectorId, weekStart);
      items = await prisma.settlementItem.findMany({ where: { sectorId, weekStart }, orderBy: [{ disposition: 'asc' }, { category: 'asc' }, { createdAt: 'asc' }] });
    }
    const fundings = await prisma.sedeFunding.findMany({ where: { sectorId, weekStart } }).catch(() => []);
    res.json({ week: weekStart.toISOString(), sectorId, items: items.map(serialize.settlementItem), fundings: fundings.map(serialize.sedeFunding), summary: summarize(items) });
  } catch (e) { next(e); }
});

router.post('/items/sync', async (req, res, next) => {
  try {
    requireManage(req);
    const weekStart = resolveWeekStart(req.query.week || (req.body && req.body.week));
    const sectorId = resolveSector(req, { ...(req.query || {}), ...(req.body || {}) });
    if (!sectorId) throw httpError(400, 'sectorId é obrigatório');
    assertSectorAccess(req, sectorId);
    const created = await syncPayablesForWeek(sectorId, weekStart);
    const items = await prisma.settlementItem.findMany({ where: { sectorId, weekStart }, orderBy: [{ disposition: 'asc' }, { createdAt: 'asc' }] });
    await logAudit(prisma, { user: req.user, action: 'acerto.sync', entity: 'SettlementItem', entityId: null, sectorId, summary: `Sync acerto semana ${weekStart.toISOString().slice(0,10)} (+${created})` });
    res.json({ created, items: items.map(serialize.settlementItem), summary: summarize(items) });
  } catch (e) { next(e); }
});

const updateSchema = z.object({
  disposition: z.enum(['quitada', 'a_quitar', 'enviada_sede']).optional(),
  amount: z.number().nonnegative().optional(),
  amountPaid: z.number().nonnegative().optional(),
  amountProvisioned: z.number().nonnegative().optional(),
  responsible: z.enum(['setor', 'sede']).optional(),
  note: z.string().optional().nullable(),
  label: z.string().optional(),
  category: z.string().optional().nullable(),
  isBasic: z.boolean().optional(),
});

router.put('/items/:id', async (req, res, next) => {
  try {
    requireManage(req);
    const it = await prisma.settlementItem.findUnique({ where: { id: req.params.id } });
    if (!it) throw httpError(404, 'Item do acerto não encontrado');
    assertSectorAccess(req, it.sectorId);
    const d = updateSchema.parse(req.body || {});
    const disposition = d.disposition || it.disposition;
    const amount = d.amount != null ? d.amount : Number(it.amount);
    const amountPaid = d.amountPaid != null ? d.amountPaid : Number(it.amountPaid);
    const amountProvisioned = d.amountProvisioned != null ? d.amountProvisioned : Number(it.amountProvisioned);
    const remaining = computeRemaining(amount, amountPaid, amountProvisioned, disposition);
    const responsible = d.responsible || (disposition === 'enviada_sede' ? 'sede' : it.responsible);
    const updated = await prisma.settlementItem.update({
      where: { id: it.id },
      data: {
        disposition, amount, amountPaid, amountProvisioned, remaining, responsible,
        note: d.note !== undefined ? d.note : it.note,
        label: d.label || it.label,
        category: d.category !== undefined ? d.category : it.category,
        isBasic: d.isBasic !== undefined ? d.isBasic : it.isBasic,
      },
    });
    // Se quitada e veio de payable, reflete amountPaid informativo? (não altera o payable aqui para evitar efeitos colaterais; Fatia 2 lida com execução real)
    await logAudit(prisma, { user: req.user, action: 'acerto.item.update', entity: 'SettlementItem', entityId: it.id, sectorId: it.sectorId, summary: `Acerto item ${disposition}`, after: { disposition, amount, amountPaid, amountProvisioned, remaining } });
    res.json({ item: serialize.settlementItem(updated) });
  } catch (e) { next(e); }
});

router.post('/items/:id/send-to-sede', async (req, res, next) => {
  try {
    requireManage(req);
    const it = await prisma.settlementItem.findUnique({ where: { id: req.params.id }, include: { payable: true } });
    if (!it) throw httpError(404, 'Item do acerto não encontrado');
    assertSectorAccess(req, it.sectorId);
    const { note } = z.object({ note: z.string().optional().nullable() }).parse(req.body || {});
    const remaining = computeRemaining(Number(it.amount), Number(it.amountPaid), Number(it.amountProvisioned), 'enviada_sede');
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.settlementItem.update({
        where: { id: it.id },
        data: { disposition: 'enviada_sede', responsible: 'sede', remaining, note: note || it.note, isBasic: it.isBasic },
      });
      if (it.payableId) {
        await tx.payable.update({ where: { id: it.payableId }, data: { sentToSede: true, sentToSedeAt: new Date(), sentToSedeById: req.user.sub, sentToSedeByName: req.user.name || null, sentToSedeNote: note || null } });
      }
      await logAudit(tx, { user: req.user, action: 'acerto.item.send_to_sede', entity: 'SettlementItem', entityId: it.id, sectorId: it.sectorId, summary: 'Conta enviada para pagamento na sede (acerto)', after: { disposition: 'enviada_sede' } });
      return updated;
    });
    res.json({ item: serialize.settlementItem(result) });
  } catch (e) { next(e); }
});

router.post('/items/:id/sede-funding', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede pode registrar provisão/repasse');
    const it = await prisma.settlementItem.findUnique({ where: { id: req.params.id } });
    if (!it) throw httpError(404, 'Item do acerto não encontrado');
    const { amount, note } = z.object({ amount: z.number().positive(), note: z.string().optional().nullable() }).parse(req.body || {});
    const result = await prisma.$transaction(async (tx) => {
      const funding = await tx.sedeFunding.create({
        data: { sectorId: it.sectorId, weekStart: it.weekStart, settlementItemId: it.id, payableId: it.payableId, amount, status: 'provisioned', note: note || null, createdById: req.user.sub, createdByName: req.user.name || null },
      });
      const newProv = Number(it.amountProvisioned || 0) + amount;
      const remaining = computeRemaining(Number(it.amount), Number(it.amountPaid), newProv, it.disposition);
      const updated = await tx.settlementItem.update({ where: { id: it.id }, data: { amountProvisioned: newProv, remaining, responsible: it.responsible } });
      await logAudit(tx, { user: req.user, action: 'acerto.sede_funding', entity: 'SedeFunding', entityId: funding.id, sectorId: it.sectorId, summary: `Provisão sede R$ ${amount} (repasse futuro ao setor)`, after: { amount, status: 'provisioned' } });
      return { funding, item: updated };
    });
    res.json({ funding: serialize.sedeFunding(result.funding), item: serialize.settlementItem(result.item) });
  } catch (e) { next(e); }
});

router.put('/items/:id/validate', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede (perfil admin) pode validar');
    const it = await prisma.settlementItem.findUnique({ where: { id: req.params.id } });
    if (!it) throw httpError(404, 'Item do acerto não encontrado');
    const { status, note } = z.object({ status: z.enum(['approved','rejected','flagged','pending']), note: z.string().optional().nullable() }).parse(req.body || {});
    const updated = await prisma.settlementItem.update({
      where: { id: it.id },
      data: { sedeValidationStatus: status, sedeValidatedById: req.user.sub, sedeValidatedByName: req.user.name || null, sedeValidatedAt: new Date(), sedeValidationNote: note || null },
    });
    await logAudit(prisma, { user: req.user, action: 'acerto.item.validate', entity: 'SettlementItem', entityId: it.id, sectorId: it.sectorId, summary: `Validação sede: ${status}`, after: { sedeValidationStatus: status } });
    res.json({ item: serialize.settlementItem(updated) });
  } catch (e) { next(e); }
});

router.get('/fundings', async (req, res, next) => {
  try {
    requireManage(req);
    const sectorId = resolveSector(req, req.query);
    const where = {};
    if (req.user.role === 'sede') { if (sectorId) where.sectorId = sectorId; }
    else { if (!sectorId) throw httpError(403, 'Sem acesso'); where.sectorId = sectorId; assertSectorAccess(req, sectorId); }
    if (req.query.week) where.weekStart = resolveWeekStart(req.query.week);
    const fundings = await prisma.sedeFunding.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ fundings: fundings.map(serialize.sedeFunding) });
  } catch (e) { next(e); }
});

// Fatia 3: conciliação do repasse/provisão sede->setor (repasse futuro -> quitação)
router.put('/fundings/:id/status', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede (admin) pode conciliar provisão/repasse');
    const funding = await prisma.sedeFunding.findUnique({ where: { id: req.params.id } });
    if (!funding) throw httpError(404, 'Provisão/repasse não encontrado');
    const { status, note } = z.object({ status: z.enum(['provisioned', 'released', 'settled', 'canceled']), note: z.string().optional().nullable() }).parse(req.body || {});
    const now = new Date();
    const data = { status, note: note !== undefined ? note : funding.note };
    if (status === 'released') data.releasedAt = now;
    if (status === 'settled') data.settledAt = now;
    const updated = await prisma.$transaction(async (tx) => {
      const f = await tx.sedeFunding.update({ where: { id: funding.id }, data });
      // Se repasse foi liberado/quitado e há item vinculado, reflete recurso provisionado/disponível
      if (funding.settlementItemId && (status === 'released' || status === 'settled')) {
        const it = await tx.settlementItem.findUnique({ where: { id: funding.settlementItemId } });
        if (it && it.disposition === 'a_quitar') {
          const newProv = Number(it.amountProvisioned || 0); // já somado na criação; apenas mantém consistência
          const remaining = computeRemaining(Number(it.amount), Number(it.amountPaid), newProv, it.disposition);
          await tx.settlementItem.update({ where: { id: it.id }, data: { remaining, responsible: it.responsible } });
        }
      }
      await logAudit(tx, { user: req.user, action: 'acerto.funding.status', entity: 'SedeFunding', entityId: funding.id, sectorId: funding.sectorId, summary: `Conciliação repasse sede->setor: ${status}`, before: { status: funding.status }, after: { status } });
      return f;
    });
    res.json({ funding: serialize.sedeFunding(updated) });
  } catch (e) { next(e); }
});

// Fatia 3: sede paga direto ao credor (marca item quitado pela sede, validado)
router.post('/items/:id/settle-by-sede', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede (admin) pode registrar pagamento direto ao credor');
    const it = await prisma.settlementItem.findUnique({ where: { id: req.params.id } });
    if (!it) throw httpError(404, 'Item do acerto não encontrado');
    const { amountPaid, note } = z.object({ amountPaid: z.number().nonnegative().optional(), note: z.string().optional().nullable() }).parse(req.body || {});
    const paid = amountPaid != null ? Number(amountPaid) : Number(it.amount || 0);
    const amt = Number(it.amount || 0);
    const fullyPaid = paid >= amt - 0.005;
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.settlementItem.update({
        where: { id: it.id },
        data: {
          disposition: fullyPaid ? 'quitada' : 'a_quitar',
          amountPaid: paid,
          remaining: fullyPaid ? 0 : Math.max(0, amt - paid),
          responsible: 'sede',
          status: 'paid_by_sede',
          sedeValidationStatus: 'approved',
          sedeValidatedById: req.user.sub,
          sedeValidatedByName: req.user.name || null,
          sedeValidatedAt: new Date(),
          sedeValidationNote: note || 'Pago diretamente pela sede ao credor',
          executedById: req.user.sub,
          executedByName: req.user.name || null,
          executedAt: new Date(),
          note: note !== undefined ? note : it.note,
        },
      });
      await logAudit(tx, { user: req.user, action: 'acerto.item.settle_by_sede', entity: 'SettlementItem', entityId: it.id, sectorId: it.sectorId, summary: 'Sede pagou direto ao credor (acerto conciliado)', before: { status: it.status, disposition: it.disposition }, after: { status: 'paid_by_sede', disposition: updated.disposition, amountPaid: paid } });
      return updated;
    });
    res.json({ item: serialize.settlementItem(result) });
  } catch (e) { next(e); }
});

// Fatia 3: marcar repasse da sede como liberado ao setor para o item (fluxo "repassa ao setor" -> setor quita)
router.post('/items/:id/release-to-sector', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede (admin) pode liberar repasse ao setor');
    const it = await prisma.settlementItem.findUnique({ where: { id: req.params.id } });
    if (!it) throw httpError(404, 'Item do acerto não encontrado');
    const { fundingId, note } = z.object({ fundingId: z.string().optional(), note: z.string().optional().nullable() }).parse(req.body || {});
    const result = await prisma.$transaction(async (tx) => {
      let funding = null;
      if (fundingId) {
        funding = await tx.sedeFunding.update({ where: { id: fundingId }, data: { status: 'released', releasedAt: new Date(), note: note || undefined } });
      } else {
        // libera a provisão vinculada mais recente, se houver
        const f = await tx.sedeFunding.findFirst({ where: { settlementItemId: it.id, status: 'provisioned' }, orderBy: { createdAt: 'desc' } });
        if (f) funding = await tx.sedeFunding.update({ where: { id: f.id }, data: { status: 'released', releasedAt: new Date(), note: note || f.note } });
      }
      const updated = await tx.settlementItem.update({ where: { id: it.id }, data: { responsible: 'setor', note: note !== undefined ? note : it.note } });
      await logAudit(tx, { user: req.user, action: 'acerto.item.release_to_sector', entity: 'SettlementItem', entityId: it.id, sectorId: it.sectorId, summary: 'Repasse da sede liberado ao setor (setor quita o credor)', after: { fundingId: funding ? funding.id : null, status: 'released' } });
      return { item: updated, funding };
    });
    res.json({ item: serialize.settlementItem(result.item), funding: result.funding ? serialize.sedeFunding(result.funding) : null });
  } catch (e) { next(e); }
});

module.exports = router;
