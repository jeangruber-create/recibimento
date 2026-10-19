function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function notFound(req, res) {
  res.status(404).json({ error: 'Rota não encontrada' });
}

function errorHandler(err, req, res, next) {
  if (process.env.NODE_ENV !== 'test') console.error(err.message);
  if (err.name === 'ZodError') {
    return res.status(422).json({ error: 'Dados inválidos', issues: err.issues });
  }
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Registro duplicado' });
  }
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Erro interno' });
}

module.exports = { httpError, notFound, errorHandler };
