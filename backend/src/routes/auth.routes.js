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
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
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

router.get('/me', authRequired, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
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
