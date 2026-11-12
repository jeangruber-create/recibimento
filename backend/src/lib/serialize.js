function toNumber(v) {
  if (v === null || v === undefined) return v;
  return typeof v === 'number' ? v : Number(v);
}

const { isoWeekInfo } = require('./week');

function iso(d) {
  return d instanceof Date ? d.toISOString() : d;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    phone: u.phone ?? null,
    cpf: u.cpf ?? null,
    cep: u.cep ?? null,
    addressNumber: u.addressNumber ?? null,
    memberCode: u.memberCode ?? null,
    profileCompletedAt: u.profileCompletedAt ? iso(u.profileCompletedAt) : null,
    profileComplete: !!(u.name && u.cpf && u.cep && u.addressNumber && u.phone),
    emailVerifiedAt: u.emailVerifiedAt ? iso(u.emailVerifiedAt) : null,
    verified: !!u.emailVerifiedAt,
    sectorId: u.sectorId ?? null,
    congregationId: u.congregationId ?? null,
    // Chave PIX da congregação (para o membro dizimar/ofertar de casa). Presente
    // apenas quando a relação `congregation` foi carregada na consulta.
    pixKey: (u.congregation && u.congregation.pixKey) || null,
    pixKeyType: (u.congregation && u.congregation.pixKeyType) || null,
    congregationCode: (u.congregation && u.congregation.code) || null,
    congregationName: (u.congregation && u.congregation.name) || null,
  };
}

function receipt(r) {
  return {
    id: r.id,
    number: r.number,
    person: {
      name: r.personName,
      memberCode: r.personMemberCode ?? null,
      userId: r.personUserId ?? null,
      congregationId: r.congregationId,
    },
    type: r.type,
    value: toNumber(r.value),
    payment: r.payment,
    sectorId: r.sectorId,
    congregationId: r.congregationId,
    createdById: r.createdById ?? null,
    personUserId: r.personUserId ?? null,
    date: iso(r.date),
    status: r.status,
    reviewStatus: r.reviewStatus ?? 'reviewed',
    reviewedById: r.reviewedById ?? null,
    reviewedByName: r.reviewedByName ?? null,
    reviewedAt: r.reviewedAt ? iso(r.reviewedAt) : null,
    reviewNote: r.reviewNote ?? null,
    source: r.source ?? null,
    confirmedAt: r.confirmedAt ? iso(r.confirmedAt) : null,
    confirmedByEmail: r.confirmedByEmail ?? null,
  };
}

function expense(e, withData = false) {
  let comprovante = null;
  if (e.proofData) {
    comprovante = { name: e.proofName, type: e.proofType, size: e.proofSize };
    if (withData) comprovante.data = e.proofData;
  }
  return {
    id: e.id,
    date: iso(e.date),
    category: e.category,
    description: e.description ?? '',
    value: toNumber(e.value),
    payment: e.payment,
    status: e.status ?? 'approved',
    reviewStatus: e.reviewStatus ?? 'approved',
    reviewedById: e.reviewedById ?? null,
    reviewedByName: e.reviewedByName ?? null,
    reviewedAt: e.reviewedAt ? iso(e.reviewedAt) : null,
    reviewNote: e.reviewNote ?? null,
    sectorId: e.sectorId,
    congregationId: e.congregationId,
    payableId: e.payableId ?? null,
    createdBy: e.createdByName ?? '',
    createdAt: iso(e.createdAt),
    comprovante,
  };
}

function sector(s) {
  return {
    id: s.id,
    name: s.name,
    congregations: (s.congregations || []).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      address: c.address ?? '',
      pixKey: c.pixKey ?? '',
      pixKeyType: c.pixKeyType ?? '',
    })),
  };
}

function closure(c) {
  const wk = c.weekStart ? isoWeekInfo(c.weekStart) : null;
  return {
    id: c.id,
    weekStart: iso(c.weekStart),
    weekNumber: wk ? wk.week : null,
    weekYear: wk ? wk.year : null,
    weekLabel: wk ? wk.label : null,
    scope: c.scope,
    sectorId: c.sectorId,
    congregationId: c.congregationId ?? null,
    income: toNumber(c.income),
    expense: toNumber(c.expense),
    balance: toNumber(c.balance),
    ratio: c.ratio,
    exceeded: c.exceeded,
    justification: c.justification ?? '',
    status: c.status,
    closedBy: c.closedBy,
    closedAt: iso(c.closedAt),
    validatedBy: c.validatedBy ?? null,
    validatedAt: c.validatedAt ? iso(c.validatedAt) : null,
  };
}

function prestacao(p) {
  const wk = p.weekStart ? isoWeekInfo(p.weekStart) : null;
  return {
    id: p.id,
    sectorId: p.sectorId,
    weekStart: iso(p.weekStart),
    weekNumber: wk ? wk.week : null,
    weekYear: wk ? wk.year : null,
    weekLabel: wk ? wk.label : null,
    status: p.status,
    declaredCash: toNumber(p.declaredCash),
    declaredPix: toNumber(p.declaredPix),
    incomeBy: p.incomeBy ?? null,
    expenseBy: p.expenseBy ?? null,
    note: p.note ?? '',
    repasseProof: p.repasseProof ?? null,
    pixProofs: p.pixProofs ?? [],
    submittedAt: p.submittedAt ? iso(p.submittedAt) : null,
    reviewedBy: p.reviewedBy ?? null,
    reviewedAt: p.reviewedAt ? iso(p.reviewedAt) : null,
    reviewNote: p.reviewNote ?? '',
    receivedAt: p.receivedAt ? iso(p.receivedAt) : null,
    receivedById: p.receivedById ?? null,
    receivedNote: p.receivedNote ?? '',
  };
}

function alert(a) {
  return {
    id: a.id,
    type: a.type,
    weekStart: iso(a.weekStart),
    scope: a.scope,
    sectorId: a.sectorId,
    congregationId: a.congregationId ?? null,
    income: toNumber(a.income),
    expense: toNumber(a.expense),
    ratio: a.ratio,
    limit: a.limitPct,
    justification: a.justification ?? '',
    read: a.read,
    createdBy: a.createdBy ?? '',
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  };
}

function payable(p, withData = false) {
  if (!p) return null;
  let comprovante = null;
  if (p.proofData) {
    comprovante = { name: p.proofName, type: p.proofType, size: p.proofSize };
    if (withData) comprovante.data = p.proofData;
  }
  const amount = Number(p.amount || 0);
  const amountPaid = Number(p.amountPaid || 0);
  return {
    id: p.id,
    category: p.category,
    description: p.description ?? '',
    payee: p.payee ?? '',
    nature: p.nature ?? null,
    amount: toNumber(p.amount),
    amountPaid: toNumber(p.amountPaid),
    amountOpen: amount - amountPaid,
    payment: p.payment,
    dueDate: iso(p.dueDate),
    competenceDate: p.competenceDate ? iso(p.competenceDate) : null,
    isBasic: !!p.isBasic,
    basicType: p.basicType ?? null,
    sentToSede: !!p.sentToSede,
    sentToSedeAt: p.sentToSedeAt ? iso(p.sentToSedeAt) : null,
    sentToSedeById: p.sentToSedeById ?? null,
    sentToSedeByName: p.sentToSedeByName ?? '',
    sentToSedeNote: p.sentToSedeNote ?? '',
    status: p.status,
    note: p.note ?? '',
    sectorId: p.sectorId,
    congregationId: p.congregationId,
    createdById: p.createdById ?? null,
    createdByName: p.createdByName ?? '',
    approvedById: p.approvedById ?? null,
    approvedByName: p.approvedByName ?? '',
    approvedAt: p.approvedAt ? iso(p.approvedAt) : null,
    paidAt: p.paidAt ? iso(p.paidAt) : null,
    canceledAt: p.canceledAt ? iso(p.canceledAt) : null,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    comprovante,
  };
}



function settlementItem(it, withData = false) {
  if (!it) return null;
  let comprovante = null;
  if (it.proofData) {
    comprovante = { name: it.proofName, type: it.proofType, size: it.proofSize };
    if (withData) comprovante.data = it.proofData;
  }
  const amount = toNumber(it.amount);
  const amountPaid = toNumber(it.amountPaid);
  const amountProvisioned = toNumber(it.amountProvisioned);
  const remaining = it.remaining != null ? toNumber(it.remaining) : Math.max(0, amount - amountPaid);
  return {
    id: it.id,
    sectorId: it.sectorId,
    congregationId: it.congregationId ?? null,
    weekStart: iso(it.weekStart),
    prestacaoId: it.prestacaoId ?? null,
    payableId: it.payableId ?? null,
    expenseId: it.expenseId ?? null,
    label: it.label ?? '',
    category: it.category ?? '',
    isBasic: !!it.isBasic,
    disposition: it.disposition ?? 'a_quitar', // quitada|a_quitar|enviada_sede
    amount, amountPaid, amountProvisioned, remaining,
    responsible: it.responsible ?? 'setor', // setor|sede
    status: it.status ?? 'registered',
    sedeValidationStatus: it.sedeValidationStatus ?? 'pending',
    sedeValidatedById: it.sedeValidatedById ?? null,
    sedeValidatedByName: it.sedeValidatedByName ?? '',
    sedeValidatedAt: it.sedeValidatedAt ? iso(it.sedeValidatedAt) : null,
    sedeValidationNote: it.sedeValidationNote ?? '',
    executedById: it.executedById ?? null,
    executedByName: it.executedByName ?? '',
    executedAt: it.executedAt ? iso(it.executedAt) : null,
    note: it.note ?? '',
    createdById: it.createdById ?? null,
    createdByName: it.createdByName ?? '',
    createdAt: iso(it.createdAt),
    updatedAt: iso(it.updatedAt),
    comprovante,
  };
}

function sedeFunding(f) {
  if (!f) return null;
  return {
    id: f.id,
    sectorId: f.sectorId,
    weekStart: f.weekStart ? iso(f.weekStart) : null,
    settlementItemId: f.settlementItemId ?? null,
    payableId: f.payableId ?? null,
    amount: toNumber(f.amount),
    status: f.status ?? 'provisioned', // provisioned|released|settled|canceled
    note: f.note ?? '',
    createdById: f.createdById ?? null,
    createdByName: f.createdByName ?? '',
    releasedAt: f.releasedAt ? iso(f.releasedAt) : null,
    settledAt: f.settledAt ? iso(f.settledAt) : null,
    createdAt: iso(f.createdAt),
    updatedAt: iso(f.updatedAt),
  };
}

module.exports = { toNumber, iso, publicUser, receipt, expense, sector, closure, prestacao, alert, payable, settlementItem, sedeFunding };

