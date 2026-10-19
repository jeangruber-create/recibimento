function toNumber(v) {
  if (v === null || v === undefined) return v;
  return typeof v === 'number' ? v : Number(v);
}

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
    memberCode: u.memberCode ?? null,
    profileCompletedAt: u.profileCompletedAt ? iso(u.profileCompletedAt) : null,
    profileComplete: !!(u.name && u.cpf && u.cep && u.phone),
    sectorId: u.sectorId ?? null,
    congregationId: u.congregationId ?? null,
  };
}

function receipt(r) {
  return {
    id: r.id,
    number: r.number,
    person: {
      name: r.personName,
      memberCode: r.personMemberCode ?? null,
      congregationId: r.congregationId,
    },
    type: r.type,
    value: toNumber(r.value),
    payment: r.payment,
    sectorId: r.sectorId,
    congregationId: r.congregationId,
    createdById: r.createdById ?? null,
    date: iso(r.date),
    status: r.status,
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
    sectorId: e.sectorId,
    congregationId: e.congregationId,
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
    })),
  };
}

function closure(c) {
  return {
    id: c.id,
    weekStart: iso(c.weekStart),
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
  return {
    id: p.id,
    sectorId: p.sectorId,
    weekStart: iso(p.weekStart),
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

module.exports = { toNumber, iso, publicUser, receipt, expense, sector, closure, prestacao, alert };
