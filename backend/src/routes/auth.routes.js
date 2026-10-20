const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../prisma');
const { signToken, authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { publicUser } = require('../lib/serialize');
const config = require('../config');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
});

// Autocadastro público do fiel: nome, CPF, CEP, número da residência e celular.
const registerSchema = z.object({
  name: z.string().trim().min(5),
  cpf: z.string().min(11),
  cep: z.string().min(8),
  addressNumber: z.string().trim().min(1).max(20),
  phone: z.string().min(10),
  email: z.string().email(),
  password: z.string().min(6),
  sectorId: z.number().int().positive().optional().nullable(),
  congregationId: z.number().int().positive().optional().nullable(),
});

// Gera código numérico de 6 dígitos para verificação do celular / reset de senha.
function sixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCode(code) {
  return require('crypto').createHash('sha256').update(String(code)).digest('hex');
}

function cookieOpts() {
  const prod = config.env === 'production';
  // CROSS_SITE=1: front servido em outro domínio (ProFreeHost) e API no Render —
  // SameSite=None; Secure para o cookie ser enviado em requisições entre origens.
  const cross = !!config.crossSite;
  return {
    httpOnly: true,
    secure: prod || cross,
    sameSite: cross ? 'none' : (prod ? 'strict' : 'lax'),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { congregation: true } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw httpError(401, 'Credenciais inválidas');
    }
    const token = signToken(user);
    res.cookie('adm_token', token, cookieOpts());
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const digits = (v) => String(v ?? '').replace(/\D/g, '');
    const cpf = digits(input.cpf);
    const cep = digits(input.cep);
    const phone = digits(input.phone);
    const name = input.name.trim();

    if (!name.includes(' ')) throw httpError(422, 'Informe o nome completo (nome e sobrenome)');
    if (cpf.length !== 11) throw httpError(422, 'CPF inválido');
    if (cep.length !== 8) throw httpError(422, 'CEP inválido (8 dígitos)');
    if (phone.length < 10 || phone.length > 11) throw httpError(422, 'Celular inválido (DDD + número)');

    const email = input.email.toLowerCase();
    const [dupEmail, dupCpf] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { cpf } }),
    ]);
    if (dupEmail) throw httpError(409, 'Já existe cadastro com este e-mail');
    if (dupCpf) throw httpError(409, 'Já existe cadastro com este CPF');

    let sectorId = input.sectorId ?? null;
    let congregationId = input.congregationId ?? null;
    if (congregationId) {
      const cong = await prisma.congregation.findUnique({ where: { id: congregationId } });
      if (!cong) throw httpError(400, 'Congregação não encontrada');
      sectorId = cong.sectorId;
    } else if (sectorId) {
      const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
      if (!sector) throw httpError(400, 'Setor não encontrado');
    }

    let memberCode = null;
    for (let i = 0; i < 20 && !memberCode; i++) {
      const code = 'ADM' + String(Math.floor(100000 + Math.random() * 899999));
      const exists = await prisma.user.findUnique({ where: { memberCode: code } });
      if (!exists) memberCode = code;
    }
    if (!memberCode) throw httpError(500, 'Não foi possível gerar código de membro');

    const code = sixDigitCode();
    const user = await prisma.user.create({
      data: {
        email,
        name,
        role: 'membro',
        cpf,
        cep,
        addressNumber: input.addressNumber.trim(),
        phone,
        sectorId,
        congregationId,
        memberCode,
        passwordHash: await bcrypt.hash(input.password, 10),
        profileCompletedAt: new Date(),
        verifiedVia: 'phone',
        resetCodeHash: hashCode(code),
        resetCodeExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const token = signToken(user);
    res.cookie('adm_token', token, cookieOpts());
    res.status(201).json({ token, user: publicUser(user), verificationCode: code });
  } catch (e) {
    next(e);
  }
});

// Confirma o celular informado no autocadastro com o código de 6 dígitos.
router.post('/verify-phone', authRequired, async (req, res, next) => {
  try {
    const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
    if (code.length !== 6) throw httpError(422, 'Informe o código de 6 dígitos');
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) throw httpError(404, 'Usuário não encontrado');
    if (user.emailVerifiedAt) return res.json({ user: publicUser(user), verified: true });
    if (!user.resetCodeHash || !user.resetCodeExpiresAt || user.resetCodeExpiresAt < new Date()) {
      throw httpError(422, 'Código expirado. Gere um novo.');
    }
    if (hashCode(code) !== user.resetCodeHash) throw httpError(422, 'Código incorreto');
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), resetCodeHash: null, resetCodeExpiresAt: null },
    });
    res.json({ user: publicUser(updated), verified: true });
  } catch (e) {
    next(e);
  }
});

router.get('/me', authRequired, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, include: { congregation: true } });
    if (!user) throw httpError(404, 'Usuário não encontrado');
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/bootstrap', async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) throw httpError(409, 'Já existem usuários cadastrados');
    const data = bootstrapSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        role: 'sede',
        passwordHash: await bcrypt.hash(data.password, 10),
      },
    });
    const token = signToken(user);
    res.cookie('adm_token', token, cookieOpts());
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('adm_token', cookieOpts());
  res.json({ ok: true });
});

module.exports = router;
