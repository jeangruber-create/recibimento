const env = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const corsOrigin = process.env.CORS_ORIGIN || '*';
// Front em outro domínio (ex.: index.html no ProFreeHost e API no Render):
// exige cookie SameSite=None; Secure para a sessão ser enviada entre origens.
const crossSite = process.env.CROSS_SITE === '1';
const path = require('path');
const fs = require('fs');

if (env === 'production') {
  if (!process.env.JWT_SECRET || jwtSecret === 'dev-insecure-secret-change-me') {
    throw new Error('JWT_SECRET forte e obrigatório em produção (não use o padrão de desenvolvimento).');
  }
  if (corsOrigin === '*') {
    console.warn('[segurança] CORS_ORIGIN="*" em produção — restrinja aos domínios confiáveis.');
  }
  if (crossSite && corsOrigin === '*') {
    console.warn('[segurança] CROSS_SITE=1 com CORS_ORIGIN="*" — informe a origem exata do front (https://seu-dominio).');
  }
}

// Front-end servido pelo próprio backend (implantação em servidor web único).
// Desligue com FRONT_FILE="" ou aponte para outro arquivo.
function resolveFrontFile() {
  if (process.env.FRONT_FILE !== undefined) return process.env.FRONT_FILE;
  const fallback = path.resolve(__dirname, '..', '..', 'index.html');
  return fs.existsSync(fallback) ? fallback : '';
}

module.exports = {
  env,
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin,
  crossSite,
  trustProxy: process.env.TRUST_PROXY === '1',
  frontFile: resolveFrontFile(),
};
