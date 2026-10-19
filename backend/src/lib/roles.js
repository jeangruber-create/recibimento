const ROLE_HIERARCHY = { sede: 5, tesoureiro_setor: 4, tesoureiro_congregacao: 3, coletor: 2, membro: 1 };

const ROLE_CREATABLE = {
  sede: ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao', 'coletor', 'membro'],
  tesoureiro_setor: ['tesoureiro_congregacao', 'coletor', 'membro'],
  tesoureiro_congregacao: ['coletor', 'membro'],
  coletor: [],
  membro: [],
};

const ROLE_NEEDS_SECTOR = ['tesoureiro_setor', 'tesoureiro_congregacao', 'coletor', 'membro'];
const ROLE_NEEDS_CONGREGATION = ['tesoureiro_congregacao', 'coletor', 'membro'];

function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_HIERARCHY, role);
}

function canCreateRole(actorRole, role) {
  return (ROLE_CREATABLE[actorRole] || []).includes(role);
}

function needsSector(role) {
  return ROLE_NEEDS_SECTOR.includes(role);
}

function needsCongregation(role) {
  return ROLE_NEEDS_CONGREGATION.includes(role);
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_CREATABLE,
  ROLE_NEEDS_SECTOR,
  ROLE_NEEDS_CONGREGATION,
  isRole,
  canCreateRole,
  needsSector,
  needsCongregation,
};
