// Regras da fila diária de agradecimentos:
// - apenas dízimos confirmados;
// - apenas membros cadastrados (personUserId / memberCode);
// - apenas celular válido (DDD + 9 dígitos);
// - no máximo um item por recibo.

const prisma = require('../prisma');
const config = require('../config');
const { logAudit } = require('./audit');

function digits(value) {
  let d = String(value == null ? '' : value).replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('55')) d = d.slice(2);
  return d;
}

function isValidMobile(phone) {
  const d = digits(phone);
  // Celular brasileiro: DDD (2) + número começando com 9 (9 dígitos).
  return /^\d{11}$/.test(d) && d[2] === '9';
}

function isDizimo(type) {
  const t = String(type || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return t.startsWith('dizimo');
}

function moneyBR(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

function buildMessage({ name, type, value }) {
  const firstName = String(name || '').trim().split(/\s+/)[0] || 'irmão(ã)';
  return String(config.whatsapp.thanksMessage)
    .replaceAll('{nome}', firstName)
    .replaceAll('{tipo}', String(type || 'dízimo'))
    .replaceAll('{valor}', `R$ ${moneyBR(value)}`);
}

async function resolveRecipient(db, receipt) {
  if (receipt.personUserId) {
    const user = await db.user.findFirst({
      where: { id: receipt.personUserId, role: 'membro' },
    });
    if (user && isValidMobile(user.phone)) return user;
  }
  if (receipt.personMemberCode) {
    const code = String(receipt.personMemberCode).trim();
    if (code) {
      const user = await db.user.findFirst({ where: { memberCode: code, role: 'membro' } });
      if (user && isValidMobile(user.phone)) return user;
    }
  }
  return null;
}

// Chamado dentro da transação que cria/confirma o recibo.
async function ensureThankYou(db, receipt, user) {
  if (!receipt) return null;
  if (String(receipt.status) !== 'confirmado') return null;
  if (String(receipt.reviewStatus || 'reviewed') === 'voided') return null;
  if (!isDizimo(receipt.type)) return null;

  const existing = await db.thankYouQueue.findUnique({ where: { receiptId: receipt.id } });
  if (existing) return existing;

  const recipient = await resolveRecipient(db, receipt);
  if (!recipient) return null;

  const phone = digits(recipient.phone);
  const item = await db.thankYouQueue.create({
    data: {
      receiptId: receipt.id,
      recipientUserId: recipient.id,
      memberCode: recipient.memberCode || null,
      personName: receipt.personName || recipient.name,
      phone,
      type: receipt.type,
      value: receipt.value,
      message: buildMessage({ name: receipt.personName || recipient.name, type: receipt.type, value: receipt.value }),
      status: 'pending',
      queueDate: receipt.confirmedAt || receipt.date || new Date(),
    },
  });

  await logAudit(db, {
    user,
    action: 'thanks.queue',
    entity: 'ThankYouQueue',
    entityId: item.id,
    sectorId: receipt.sectorId,
    congregationId: receipt.congregationId,
    summary: `Agradecimento na fila: ${item.personName}`,
    after: { receiptId: receipt.id, phone: `${phone.slice(0, 2)}*****${phone.slice(-4)}`, status: 'pending' },
  });

  return item;
}

// Reconstrói a fila de um dia (útil no dia da implantação e após ajustes de cadastro).
async function buildForDate(db, start, end, user) {
  const receipts = await db.receipt.findMany({
    where: {
      status: 'confirmado',
      reviewStatus: { not: 'voided' },
      OR: [
        { date: { gte: start, lt: end } },
        { confirmedAt: { gte: start, lt: end } },
      ],
    },
    orderBy: { date: 'asc' },
    take: 1000,
  });

  const alreadyQueued = await db.thankYouQueue.findMany({
    where: { receiptId: { in: receipts.map((r) => r.id) } },
    select: { receiptId: true },
  });
  const queuedIds = new Set(alreadyQueued.map((i) => i.receiptId));
  let created = 0;
  for (const receipt of receipts) {
    const item = await ensureThankYou(db, receipt, user);
    if (item && !queuedIds.has(receipt.id)) {
      created += 1;
      queuedIds.add(receipt.id);
    }
  }
  return { scanned: receipts.length, created };
}

async function buildForDateInTransaction(start, end, user) {
  return prisma.$transaction((tx) => buildForDate(tx, start, end, user));
}

module.exports = {
  digits,
  isValidMobile,
  isDizimo,
  buildMessage,
  resolveRecipient,
  ensureThankYou,
  buildForDateInTransaction,
};
