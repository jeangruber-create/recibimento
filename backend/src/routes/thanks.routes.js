const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { logAudit } = require('../lib/audit');
const { buildForDateInTransaction } = require('../lib/thanks');
const { sendText, publicConfig, isConfigured } = require('../lib/whatsapp');

const router = express.Router();
router.use(authRequired);

function sedeOnly(req, res, next) {
  if (req.user.role !== 'sede') return next(httpError(403, 'Somente a sede pode revisar agradecimentos'));
  return next();
}
router.use(sedeOnly);

const STATUS_PRIORITY = { failed: 0, pending: 1, sent: 2, skipped: 3 };

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function resolveDate(value) {
  const key = String(value || localDateKey());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw httpError(422, 'Data inválida (use AAAA-MM-DD)');
  const start = new Date(`${key}T00:00:00`);
  if (Number.isNaN(start.getTime())) throw httpError(422, 'Data inválida');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { key, start, end };
}

function iso(v) {
  return v ? new Date(v).toISOString() : null;
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 10) return String(phone || '');
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}****-${d.slice(-4)}`;
}

function serializeItem(item) {
  return {
    id: item.id,
    receiptId: item.receiptId,
    receiptNumber: item.receipt?.number || null,
    receiptDate: iso(item.receipt?.date),
    receiptStatus: item.receipt?.status || null,
    reviewStatus: item.receipt?.reviewStatus || null,
    personName: item.personName,
    memberCode: item.memberCode || null,
    recipientUserId: item.recipientUserId ?? null,
    phone: item.phone,
    maskedPhone: maskPhone(item.phone),
    type: item.type,
    value: Number(item.value),
    message: item.message,
    status: item.status,
    attempts: item.attempts,
    queueDate: iso(item.queueDate),
    createdAt: iso(item.createdAt),
    sentAt: iso(item.sentAt),
    externalId: item.externalId || null,
    lastError: item.lastError || null,
  };
}

function countByStatus(items) {
  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0, total: items.length };
  items.forEach((i) => {
    if (counts[i.status] === undefined) counts[i.status] = 0;
    counts[i.status] += 1;
  });
  return counts;
}

router.get('/queue', async (req, res, next) => {
  try {
    const { key, start, end } = resolveDate(req.query.date);
    const rows = await prisma.thankYouQueue.findMany({
      where: { queueDate: { gte: start, lt: end } },
      include: {
        receipt: { select: { number: true, date: true, status: true, reviewStatus: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    const items = rows
      .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9))
      .map(serializeItem);
    res.json({ date: key, counts: countByStatus(items), items, whatsapp: publicConfig() });
  } catch (e) {
    next(e);
  }
});

router.post('/build', async (req, res, next) => {
  try {
    const data = z.object({ date: z.string().optional() }).parse(req.body || {});
    const { key, start, end } = resolveDate(data.date);
    const result = await buildForDateInTransaction(start, end, req.user);
    await logAudit(prisma, {
      user: req.user,
      action: 'thanks.build',
      entity: 'ThankYouQueue',
      entityId: null,
      summary: `Preparação da fila de agradecimentos de ${key}: ${result.created} novo(s)`,
      after: result,
    });
    res.json({ date: key, ...result });
  } catch (e) {
    next(e);
  }
});

const idsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  force: z.boolean().optional(),
});

router.post('/send', async (req, res, next) => {
  try {
    const data = idsSchema.parse(req.body);
    const results = [];
    const configured = isConfigured();

    for (const id of data.ids) {
      const item = await prisma.thankYouQueue.findUnique({
        where: { id },
        include: { receipt: true },
      });
      if (!item) {
        results.push({ id, status: 'skipped', error: 'Item não encontrado' });
        continue;
      }
      if (item.status === 'sent' && !data.force) {
        results.push({ id, status: 'skipped', error: 'Já enviado', item: serializeItem(item) });
        continue;
      }
      if (item.status === 'skipped' && !data.force) {
        results.push({ id, status: 'skipped', error: 'Item dispensado', item: serializeItem(item) });
        continue;
      }
      if (
        item.receipt &&
        (String(item.receipt.status) !== 'confirmado' || String(item.receipt.reviewStatus || 'reviewed') === 'voided')
      ) {
        const updated = await prisma.$transaction(async (tx) => {
          const u = await tx.thankYouQueue.update({
            where: { id },
            data: {
              status: 'skipped',
              lastError: 'Recibo cancelado ou não confirmado',
              reviewedById: req.user.sub,
              reviewedAt: new Date(),
            },
          });
          await logAudit(tx, {
            user: req.user,
            action: 'thanks.skip',
            entity: 'ThankYouQueue',
            entityId: id,
            sectorId: item.receipt.sectorId,
            congregationId: item.receipt.congregationId,
            summary: `Agradecimento dispensado: recibo inválido (${item.personName})`,
          });
          return u;
        });
        results.push({ id, status: 'skipped', error: 'Recibo cancelado ou não confirmado', item: serializeItem(updated) });
        continue;
      }
      if (!configured) {
        const updated = await prisma.$transaction(async (tx) => {
          const u = await tx.thankYouQueue.update({
            where: { id },
            data: {
              status: 'failed',
              attempts: { increment: 1 },
              lastError: 'API de WhatsApp não configurada no servidor',
              reviewedById: req.user.sub,
              reviewedAt: new Date(),
            },
          });
          await logAudit(tx, {
            user: req.user,
            action: 'thanks.fail',
            entity: 'ThankYouQueue',
            entityId: id,
            sectorId: item.receipt?.sectorId,
            congregationId: item.receipt?.congregationId,
            summary: `Falha no agradecimento: API não configurada (${item.personName})`,
          });
          return u;
        });
        results.push({ id, status: 'failed', error: 'API de WhatsApp não configurada no servidor', item: serializeItem(updated) });
        continue;
      }

      try {
        const sent = await sendText({ phone: item.phone, message: item.message });
        const updated = await prisma.$transaction(async (tx) => {
          const u = await tx.thankYouQueue.update({
            where: { id },
            data: {
              status: 'sent',
              sentAt: new Date(),
              externalId: sent.id,
              attempts: { increment: 1 },
              lastError: null,
              reviewedById: req.user.sub,
              reviewedAt: new Date(),
            },
          });
          await logAudit(tx, {
            user: req.user,
            action: 'thanks.send',
            entity: 'ThankYouQueue',
            entityId: id,
            sectorId: item.receipt?.sectorId,
            congregationId: item.receipt?.congregationId,
            summary: `Agradecimento enviado por WhatsApp: ${item.personName}`,
            after: { phone: maskPhone(item.phone), externalId: sent.id, provider: sent.provider },
          });
          return u;
        });
        results.push({ id, status: 'sent', item: serializeItem(updated) });
      } catch (e) {
        const updated = await prisma.$transaction(async (tx) => {
          const u = await tx.thankYouQueue.update({
            where: { id },
            data: {
              status: 'failed',
              attempts: { increment: 1 },
              lastError: String(e.message || e).slice(0, 1000),
              reviewedById: req.user.sub,
              reviewedAt: new Date(),
            },
          });
          await logAudit(tx, {
            user: req.user,
            action: 'thanks.fail',
            entity: 'ThankYouQueue',
            entityId: id,
            sectorId: item.receipt?.sectorId,
            congregationId: item.receipt?.congregationId,
            summary: `Falha no agradecimento: ${item.personName}`,
            after: { error: String(e.message || e).slice(0, 500) },
          });
          return u;
        });
        results.push({ id, status: 'failed', error: String(e.message || e), item: serializeItem(updated) });
      }
    }

    const summary = { sent: 0, failed: 0, skipped: 0 };
    results.forEach((r) => {
      if (summary[r.status] !== undefined) summary[r.status] += 1;
    });
    res.json({ results, summary, whatsapp: publicConfig() });
  } catch (e) {
    next(e);
  }
});

router.post('/skip', async (req, res, next) => {
  try {
    const data = z
      .object({
        ids: z.array(z.string().min(1)).min(1),
        reason: z.string().max(300).optional(),
      })
      .parse(req.body);
    const results = [];
    for (const id of data.ids) {
      const item = await prisma.thankYouQueue.findUnique({ where: { id }, include: { receipt: true } });
      if (!item) {
        results.push({ id, status: 'skipped', error: 'Item não encontrado' });
        continue;
      }
      if (item.status === 'sent') {
        results.push({ id, status: 'skipped', error: 'Já enviado', item: serializeItem(item) });
        continue;
      }
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.thankYouQueue.update({
          where: { id },
          data: {
            status: 'skipped',
            lastError: data.reason || null,
            reviewedById: req.user.sub,
            reviewedAt: new Date(),
          },
        });
        await logAudit(tx, {
          user: req.user,
          action: 'thanks.skip',
          entity: 'ThankYouQueue',
          entityId: id,
          sectorId: item.receipt?.sectorId,
          congregationId: item.receipt?.congregationId,
          summary: `Agradecimento dispensado pela sede: ${item.personName}`,
          after: { reason: data.reason || null },
        });
        return u;
      });
      results.push({ id, status: 'skipped', item: serializeItem(updated) });
    }
    res.json({ results });
  } catch (e) {
    next(e);
  }
});

router.get('/config', async (req, res, next) => {
  try {
    res.json(publicConfig());
  } catch (e) {
    next(e);
  }
});

module.exports = router;
