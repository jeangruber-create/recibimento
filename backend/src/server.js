require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { notFound, errorHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/users.routes');
const sectorRoutes = require('./routes/sectors.routes');
const receiptRoutes = require('./routes/receipts.routes');
const expenseRoutes = require('./routes/expenses.routes');
const closureRoutes = require('./routes/closures.routes');
const prestacaoRoutes = require('./routes/prestacoes.routes');
const alertRoutes = require('./routes/alerts.routes');
const profileRoutes = require('./routes/profile.routes');
const publicRoutes = require('./routes/public.routes');
const memberRoutes = require('./routes/members.routes');

const app = express();

app.set('trust proxy', config.trustProxy ? 1 : false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'wasm-unsafe-eval'",
          'https://cdn.sheetjs.com',
          'https://cdnjs.cloudflare.com',
          'https://unpkg.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
if (config.env !== 'test') app.use(morgan('dev'));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: 'Muitas tentativas de login. Tente novamente mais tarde.' },
});

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/auth/login', loginLimiter);
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sectors', sectorRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/closures', closureRoutes);
app.use('/api/prestacoes', prestacaoRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/members', memberRoutes);

// ---- Front-end (implantação única: a API também serve a interface) ----
// Injeta o API_BASE da mesma origem, para o front apontar para a própria hospedagem.
if (config.frontFile) {
  const fs = require('fs');
  const sendIndex = (req, res) => {
    try {
      const html = fs.readFileSync(config.frontFile, 'utf8');
      const injected = html.includes('<head>')
        ? html.replace('<head>', '<head><script>window.ADM_API_BASE="";</script>')
        : html;
      res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache').send(injected);
    } catch (e) {
      res.status(500).send('Front-end indisponível');
    }
  };
  app.get('/', sendIndex);
  app.get('/index.html', sendIndex);

  // ---- PWA: manifest, service worker e ícones (ficam ao lado do index.html) ----
  const path = require('path');
  const frontDir = path.dirname(config.frontFile);
  const staticFiles = {
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
    '/sw.js': ['sw.js', 'application/javascript; charset=utf-8'],
    '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
    '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'],
    '/vendor/qrcode.min.js': ['vendor/qrcode.min.js', 'application/javascript; charset=utf-8'],
    '/members-bulk-wa.js': ['members-bulk-wa.js', 'application/javascript; charset=utf-8'],
  };
  Object.entries(staticFiles).forEach(([route, [file, type]]) => {
    app.get(route, (req, res) => {
      const full = path.join(frontDir, file);
      if (!fs.existsSync(full)) return res.status(404).send('Not found');
      const cache = route === '/sw.js' ? 'no-cache' : 'public, max-age=86400';
      res.set('Content-Type', type).set('Cache-Control', cache).send(fs.readFileSync(full));
    });
  });
}

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`API ADM Recebimentos ouvindo em http://localhost:${config.port}`);
});

module.exports = app;
