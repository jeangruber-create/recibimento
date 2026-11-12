const ROLE_HIERARCHY = { sede: 5, tesoureiro_setor: 4, tesoureiro_congregacao: 3, coletor: 2, membro: 1 };

// Perfis com acesso de gestão operacional (financeiro/acertos). `sede` (admin) sempre incluso
// e tratado como superusuário: privilégios para alterar, receber, reabrir, incluir etc. em todos os módulos.
const MANAGE_ROLES = ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao'];

const ROLE_CREATABLE = {
  sede: ['sede', 'tesoureiro_setor', 'tesoureiro_congregacao', 'coletor', 'membro'],
  tesoureiro_setor: ['tesoureiro_congregacao', 'coletor', 'membro'],
  tesoureiro_congregacao: ['coletor', 'membro'],
  coletor: [],
  membro: [],
};

const ROLE_NEEDS_SECTOR = ['tesoureiro_setor', 'tesoureiro_congregacao', 'coletor', 'membro'];
const ROLE_NEEDS_CONGREGATION = ['tesoureiro_congregacao', 'coletor', 'membro'];

function roleOf(userOrRole) {
  return typeof userOrRole === 'string' ? userOrRole : userOrRole && userOrRole.role;
}

function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_HIERARCHY, role);
}

function isSede(userOrRole) {
  return roleOf(userOrRole) === 'sede';
}

const isAdmin = isSede;

function canManage(userOrRole) {
  const role = roleOf(userOrRole);
  if (role === 'sede') return true; // superusuário
  return MANAGE_ROLES.includes(role);
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
  MANAGE_ROLES,
  ROLE_CREATABLE,
  ROLE_NEEDS_SECTOR,
  ROLE_NEEDS_CONGREGATION,
  isRole,
  isSede,
  isAdmin,
  canManage,
  canCreateRole,
  needsSector,
  needsCongregation,
};
