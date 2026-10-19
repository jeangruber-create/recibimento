const express = require('express');
const prisma = require('../prisma');
const { authRequired } = require('../middleware/auth');
const { httpError } = require('../middleware/error');
const { alert: serializeAlert } = require('../lib/serialize');

const router = express.Router();
router.use(authRequired);

function alertWhere(user) {
  if (user.role === 'sede') return {};
  if (user.role === 'tesoureiro_setor') return { sectorId: user.sectorId };
  return { sectorId: -1 };
}

router.get('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede' && req.user.role !== 'tesoureiro_setor') {
      throw httpError(403, 'Sem acesso aos alertas');
    }
    const where = alertWhere(req.user);
    if (req.query.all !== '1') where.read = false;
    const alerts = await prisma.alert.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ alerts: alerts.map(serializeAlert) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert) throw httpError(404, 'Alerta não encontrado');
    if (req.user.role === 'tesoureiro_setor' && alert.sectorId !== req.user.sectorId) {
      throw httpError(403, 'Sem acesso a este alerta');
    }
    const updated = await prisma.alert.update({ where: { id: alert.id }, data: { read: true } });
    res.json({ alert: serializeAlert(updated) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'sede') throw httpError(403, 'Apenas a sede pode excluir alertas');
    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert) throw httpError(404, 'Alerta não encontrado');
    await prisma.alert.delete({ where: { id: alert.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
