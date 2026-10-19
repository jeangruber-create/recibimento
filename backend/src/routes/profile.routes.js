const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { publicUser } = require('../lib/serialize');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(authRequired);

function digits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

function isValidCpf(value) {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let chk = (sum * 10) % 11;
  if (chk === 10) chk = 0;
  if (chk !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  chk = (sum * 10) % 11;
  if (chk === 10) chk = 0;
  return chk === Number(d[10]);
}

const profileSchema = z.object({
  name: z.string().trim().min(2).optional(),
  cpf: z.string().optional().nullable(),
  cep: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

router.get('/', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) throw httpError(404, 'Usuário não encontrado');
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const input = profileSchema.parse(req.body);
    const current = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!current) throw httpError(404, 'Usuário não encontrado');

    const data = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name.includes(' ')) throw httpError(422, 'Informe o nome completo (nome e sobrenome)');
      data.name = name;
    }
    if (input.cpf !== undefined) {
      const cpf = digits(input.cpf);
      if (cpf) {
        if (!isValidCpf(cpf)) throw httpError(422, 'CPF inválido');
        const dup = await prisma.user.findUnique({ where: { cpf } });
        if (dup && dup.id !== req.user.sub) throw httpError(409, 'CPF já cadastrado');
        data.cpf = cpf;
      } else {
        data.cpf = null;
      }
    }
    if (input.cep !== undefined) {
      const cep = digits(input.cep);
      if (cep && cep.length !== 8) throw httpError(422, 'CEP inválido (8 dígitos)');
      data.cep = cep || null;
    }
    if (input.phone !== undefined) {
      const phone = digits(input.phone);
      if (phone && (phone.length < 10 || phone.length > 11)) {
        throw httpError(422, 'Telefone inválido (DDD + número)');
      }
      data.phone = phone || null;
    }

    const willName = data.name !== undefined ? data.name : current.name;
    const willCpf = data.cpf !== undefined ? data.cpf : current.cpf;
    const willCep = data.cep !== undefined ? data.cep : current.cep;
    const willPhone = data.phone !== undefined ? data.phone : current.phone;
    const complete = !!(willName && willCpf && willCep && willPhone);
    if (complete && !current.profileCompletedAt) data.profileCompletedAt = new Date();

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: req.user.sub }, data });
      await logAudit(tx, {
        user: req.user,
        action: 'profile.update',
        entity: 'User',
        entityId: current.id,
        sectorId: current.sectorId,
        congregationId: current.congregationId,
        summary: 'Atualização de cadastro do membro',
        before: { name: current.name, cpf: current.cpf, cep: current.cep, phone: current.phone, profileCompletedAt: toIso(current.profileCompletedAt) },
        after: { name: updated.name, cpf: updated.cpf, cep: updated.cep, phone: updated.phone, profileCompletedAt: toIso(updated.profileCompletedAt) },
      });
      return updated;
    });
    res.json({ user: publicUser(user), profileComplete: complete });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
