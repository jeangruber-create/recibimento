const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEFAULT_USERS = [
  { email: 'admin@adm.org.br', password: '123456', name: 'Administrador Sede', role: 'sede', sectorId: null, congregationId: null, memberCode: null },
  { email: 'setor@adm.org.br', password: '123456', name: 'José Tes. Setor', role: 'tesoureiro_setor', sectorId: 8, congregationId: null, memberCode: null },
  { email: 'cong@adm.org.br', password: '123456', name: 'Ana Tes. Congregação', role: 'tesoureiro_congregacao', sectorId: 8, congregationId: 45, memberCode: null },
  { email: 'coletor@adm.org.br', password: '123456', name: 'Maria Coletora', role: 'coletor', sectorId: 8, congregationId: 45, memberCode: null },
  { email: 'coletor2@adm.org.br', password: '123456', name: 'Pedro Coletor', role: 'coletor', sectorId: 3, congregationId: 14, memberCode: null },
  { email: 'membro@adm.org.br', password: '123456', name: 'João da Silva', role: 'membro', sectorId: 8, congregationId: 45, memberCode: 'ADM100001' },
];

async function seedSectors() {
  await prisma.congregation.deleteMany({ where: { id: { gt: 120 } } });
  for (let i = 1; i <= 20; i++) {
    const name = `Setor ${String(i).padStart(2, '0')}`;
    await prisma.sector.upsert({ where: { id: i }, update: { name }, create: { id: i, name } });
    for (let j = 0; j < 6; j++) {
      const id = (i - 1) * 6 + j + 1;
      const code = String(id).padStart(3, '0');
      const address = `Rua ${String.fromCharCode(65 + j)} ${100 + i * 10}, Bairro ${i}`;
      await prisma.congregation.upsert({
        where: { id },
        update: { code, name: `Congregação ${code}`, address, sectorId: i },
        create: { id, code, name: `Congregação ${code}`, address, sectorId: i },
      });
    }
  }
}

async function seedUsers() {
  for (const u of DEFAULT_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        sectorId: u.sectorId,
        congregationId: u.congregationId,
        memberCode: u.memberCode,
        passwordHash,
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        sectorId: u.sectorId,
        congregationId: u.congregationId,
        memberCode: u.memberCode,
        passwordHash,
      },
    });
  }
}

// O seed insere ids explícitos (1..20 / 1..120). Isso deixa as sequências
// (auto-incremento) dessincronizadas, impedindo novos INSERTs sem id.
// Aqui alinhamos cada sequência ao maior id existente.
async function resetSequences() {
  for (const t of ['User', 'Sector', 'Congregation', 'AuditLog']) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${t}"), 0), 1))`
    );
  }
}

async function main() {
  await seedSectors();
  await seedUsers();
  await resetSequences();
  console.log('Seed concluído: 20 setores, 120 congregações, 6 usuários.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
