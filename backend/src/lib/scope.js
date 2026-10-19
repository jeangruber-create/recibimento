const { httpError } = require('../middleware/error');

function receiptWhere(user, base = {}) {
  const where = { ...base };
  if (user.role === 'sede') return where;
  if (user.role === 'tesoureiro_setor') return { ...where, sectorId: user.sectorId };
  if (user.role === 'tesoureiro_congregacao') {
    return { ...where, congregationId: user.congregationId };
  }
  if (user.role === 'coletor') return { ...where, createdById: user.sub };
  if (user.role === 'membro') return { ...where, personMemberCode: user.memberCode };
  return { ...where, sectorId: -1 };
}

async function resolveReceiptScope(prisma, user, input) {
  if (user.role === 'sede') {
    if (!input.sectorId || !input.congregationId) throw httpError(400, 'Informe setor e congregação');
    const cong = await prisma.congregation.findUnique({ where: { id: Number(input.congregationId) } });
    if (!cong || cong.sectorId !== Number(input.sectorId)) throw httpError(400, 'Congregação não pertence ao setor informado');
    return { sectorId: Number(input.sectorId), congregationId: Number(input.congregationId) };
  }

  if (user.role === 'tesoureiro_setor') {
    if (!input.congregationId) throw httpError(400, 'Informe a congregação');
    const cong = await prisma.congregation.findUnique({ where: { id: Number(input.congregationId) } });
    if (!cong || cong.sectorId !== user.sectorId) throw httpError(403, 'Congregação fora do seu setor');
    return { sectorId: user.sectorId, congregationId: Number(input.congregationId) };
  }

  if (user.role === 'tesoureiro_congregacao' || user.role === 'coletor') {
    if (!user.sectorId || !user.congregationId) throw httpError(403, 'Usuário sem congregação vinculada');
    return { sectorId: user.sectorId, congregationId: user.congregationId };
  }

  throw httpError(403, 'Perfil sem permissão para registrar recebimentos');
}

function canWriteReceipt(user, receipt) {
  if (user.role === 'sede') return true;
  if (user.role === 'tesoureiro_setor') return receipt.sectorId === user.sectorId;
  if (user.role === 'tesoureiro_congregacao') return receipt.congregationId === user.congregationId;
  if (user.role === 'coletor') return receipt.createdById === user.sub;
  return false;
}

module.exports = { receiptWhere, resolveReceiptScope, canWriteReceipt };
