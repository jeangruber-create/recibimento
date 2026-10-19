// Trilha de auditoria (append-only). Registra quem fez o quê, quando e sobre qual registro.
// Use sempre dentro da mesma transação da operação auditada, para não haver mudança sem rastro.

function actor(user) {
  return {
    actorId: user?.sub ?? null,
    actorName: user?.name ?? null,
    actorRole: user?.role ?? null,
  };
}

async function logAudit(db, { user, action, entity, entityId = null, sectorId = null, congregationId = null, summary = null, before = null, after = null }) {
  const a = actor(user);
  return db.auditLog.create({
    data: {
      actorId: a.actorId,
      actorName: a.actorName,
      actorRole: a.actorRole,
      action,
      entity,
      entityId: entityId === null || entityId === undefined ? null : String(entityId),
      sectorId,
      congregationId,
      summary,
      before: before ?? undefined,
      after: after ?? undefined,
    },
  });
}

module.exports = { logAudit };
