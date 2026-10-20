const express = require('express');
const prisma = require('../prisma');
const { sector: serializeSector } = require('../lib/serialize');

const router = express.Router();

// Estrutura pública (somente leitura) para o formulário de autocadastro do fiel.
// Expõe apenas setores e congregações — nunca usuários ou dados financeiros.
router.get('/sectors', async (req, res, next) => {
  try {
    const sectors = await prisma.sector.findMany({
      orderBy: { id: 'asc' },
      include: { congregations: { orderBy: { name: 'asc' } } },
    });
    res.json({ sectors: sectors.map(serializeSector) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
