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

const mbwOverride = require('./routes/mbw-override');
mbwOverride(app);

app.set('trust proxy', config.trustProxy ? 1 : false);

// Forçar não-cachear HTML para evitar vazamento de código antigo
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

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

// Serve arquivo externo para seleção em lote WhatsApp (sempre disponível)
app.get('/mbwa.js', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.resolve(process.cwd(), 'mbwa.js'),
      path.resolve(__dirname, '../../mbwa.js'),
    ];
    if (config.frontFile) {
      candidates.push(path.join(path.dirname(config.frontFile), 'mbwa.js'));
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        res.set('Content-Type', 'application/javascript; charset=utf-8')
           .set('Cache-Control', 'no-cache, no-store, must-revalidate')
           .send(fs.readFileSync(p, 'utf8'));
        return;
      }
    }
    return res.status(404).json({ error: 'Rota não encontrada' });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao servir mbwa.js' });
  }
});

app.get('/mbw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8')
     .set('Cache-Control', 'no-cache, no-store, must-revalidate')
     .send("(function(){\n  'use strict';\n\n  function toast(m,t){\n    try{ if(typeof window.showToast==='function'){ window.showToast(m,t||'warning'); return; } }catch(e){}\n    try{ alert(m); }catch(e){}\n  }\n\n  function digits(s){ return String(s||'').replace(/\\D/g,''); }\n\n  function normPhone(s){\n    var x = digits(s);\n    if(x.length===13 && x.indexOf('55')===0) x = x.substr(2);\n    if(x.length===12 && x.indexOf('55')===0) x = x.substr(2);\n    return (x.length===10 || x.length===11) ? x : '';\n  }\n\n  function phoneFromSub(sub){\n    if(!sub) return '';\n    var parts = String(sub.textContent||'').split(/[•·]/);\n    for(var i=0;i<parts.length;i++){\n      var ph = normPhone(parts[i]);\n      if(ph) return ph;\n    }\n    return '';\n  }\n\n  function nameFromItem(item){\n    var t = item.querySelector('.list-item-title');\n    if(!t) return '';\n    var clone = t.cloneNode(true);\n    var code = clone.querySelector('span');\n    if(code) code.parentNode.removeChild(code);\n    return (clone.textContent||'').replace(/\\s+/g,' ').trim();\n  }\n\n  function itemData(item){\n    var info = item.querySelector('.list-item-info');\n    var id = '';\n    if(info){\n      var m = (info.getAttribute('onclick')||'').match(/openMemberDetail\\(\\s*([^)]+)\\)/);\n      if(m) id = m[1].replace(/['\"\\s]/g,'');\n    }\n    if(!id){\n      var b = item.querySelector('button[onclick*=\"openMemberDetail\"]');\n      if(b){\n        var m2 = (b.getAttribute('onclick')||'').match(/openMemberDetail\\(\\s*([^)]+)\\)/);\n        if(m2) id = m2[1].replace(/['\"\\s]/g,'');\n      }\n    }\n    return { id: id, name: nameFromItem(item), phone: phoneFromSub(item.querySelector('.list-item-sub')) };\n  }\n\n  function selected(){\n    var boxes = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa=\"1\"]');\n    var out = [];\n    for(var i=0;i<boxes.length;i++){\n      if(!boxes[i].checked) continue;\n      out.push({\n        id: boxes[i].getAttribute('data-id')||'',\n        name: boxes[i].getAttribute('data-name')||'',\n        phone: normPhone(boxes[i].getAttribute('data-phone')||'')\n      });\n    }\n    return out;\n  }\n\n  function upd(){\n    var n = selected().length;\n    var el = document.getElementById('mbw-c');\n    if(el) el.textContent = n + ' marcado(s)';\n  }\n\n  function cbs(){\n    var items = document.querySelectorAll('#membersList .list-item');\n    for(var i=0;i<items.length;i++){\n      var item = items[i];\n      if(item.querySelector('input[type=checkbox][data-mbwa=\"1\"]')) continue;\n      var d = itemData(item);\n      if(!d.id) continue;\n      var cb = document.createElement('input');\n      cb.type = 'checkbox';\n      cb.setAttribute('data-mbwa','1');\n      cb.setAttribute('data-id', d.id);\n      cb.setAttribute('data-name', d.name);\n      cb.setAttribute('data-phone', d.phone);\n      cb.style.cssText = 'width:18px;height:18px;margin-right:12px;flex-shrink:0;';\n      cb.addEventListener('click', function(e){ e.stopPropagation(); });\n      cb.addEventListener('change', upd);\n      if(getComputedStyle(item).display !== 'flex'){\n        item.style.display = 'flex';\n        item.style.alignItems = 'center';\n      }\n      item.insertBefore(cb, item.firstChild);\n    }\n    upd();\n  }\n\n  function bar(){\n    var sc = document.getElementById('screenMembers');\n    if(!sc) return;\n    if(sc.querySelector('#mbwa-b')) return;\n    var cards = sc.querySelectorAll('.card');\n    var tgt = null;\n    for(var i=0;i<cards.length;i++){\n      if(cards[i].querySelector('#membersList')){ tgt = cards[i]; break; }\n    }\n    if(!tgt) return;\n    var b = document.createElement('div');\n    b.id = 'mbwa-b';\n    b.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:10px 12px;background:rgba(0,0,0,.02);border:1px solid var(--border);border-radius:12px;';\n    b.innerHTML = '<div style=\"font-weight:600\">Envio em lote por WhatsApp</div>' +\n      '<div style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center\">' +\n      '<button class=\"btn btn-ghost\" style=\"padding:6px 10px;font-size:12px\" id=\"mbw-m\">Marcar com celular</button>' +\n      '<button class=\"btn btn-ghost\" style=\"padding:6px 10px;font-size:12px\" id=\"mbw-u\">Desmarcar tudo</button>' +\n      '<span id=\"mbw-c\" style=\"font-size:12px;color:var(--text-muted)\">0 marcado(s)</span>' +\n      '<button class=\"btn btn-primary\" style=\"padding:6px 12px;font-size:12px\" id=\"mbw-e\">Enviar em lote</button></div>';\n    tgt.insertBefore(b, tgt.firstChild);\n\n    document.getElementById('mbw-m').onclick = function(){\n      var boxes = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa=\"1\"]');\n      var n = 0;\n      for(var i=0;i<boxes.length;i++){\n        var ok = !!normPhone(boxes[i].getAttribute('data-phone'));\n        boxes[i].checked = ok;\n        if(ok) n++;\n      }\n      upd();\n      toast(n + ' membro(s) com celular marcado(s)');\n    };\n    document.getElementById('mbw-u').onclick = function(){\n      var boxes = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa=\"1\"]');\n      for(var i=0;i<boxes.length;i++) boxes[i].checked = false;\n      upd();\n    };\n    document.getElementById('mbw-e').onclick = send;\n    upd();\n  }\n\n  var TEMPLATES = {\n    a: 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões agradece de coração pela sua contribuição. \"Cada um contribua segundo tiver proposto no coração\" (2 Coríntios 9:7). Deus te abençoe abundantemente!',\n    f: 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões deseja as mais ricas bênçãos sobre sua vida e sua família!',\n    l: 'A paz do Senhor, {primeiro_nome}!'\n  };\n\n  function send(){\n    var sel = selected();\n    if(sel.length === 0){ toast('Marque pelo menos um membro com celular'); return; }\n    var lst = [];\n    for(var i=0;i<sel.length;i++){ if(sel[i].phone) lst.push(sel[i]); }\n    if(lst.length === 0){ toast('Os marcados não possuem celular cadastrado'); return; }\n    if(typeof window.showModal !== 'function'){ toast('Modal indisponível'); return; }\n\n    var html = '<div style=\"display:flex;flex-direction:column;gap:12px\">' +\n      '<div style=\"font-size:13px;color:var(--text-muted)\">' + lst.length + ' destinatário(s)</div>' +\n      '<div class=\"form-group\" style=\"margin:0\"><label class=\"form-label\">Modelo</label>' +\n      '<select class=\"form-select\" id=\"mbw-t\"><option value=\"a\">Agradecimento</option><option value=\"f\">Felicitação / Bênçãos</option><option value=\"l\">Personalizada</option></select></div>' +\n      '<div class=\"form-group\" style=\"margin:0\"><label class=\"form-label\">Mensagem</label>' +\n      '<textarea class=\"form-input\" id=\"mbw-tx\" rows=\"8\" style=\"resize:vertical\"></textarea>' +\n      '<div style=\"font-size:11px;color:var(--text-muted);margin-top:4px\">Use {nome} ou {primeiro_nome} para personalizar</div></div></div>';\n\n    window.showModal('Enviar em lote por WhatsApp', '', function(){\n      var ta = document.getElementById('mbw-tx');\n      var msg = ta ? String(ta.value||'') : '';\n      if(!msg.trim()){ toast('Digite a mensagem'); return; }\n      var now = selected();\n      var list = [];\n      for(var i=0;i<now.length;i++){ if(now[i].phone) list.push(now[i]); }\n      if(list.length === 0){ toast('Nenhum destinatário com celular'); return; }\n      for(var k=0;k<list.length;k++){\n        (function(m, idx){\n          var first = String(m.name||'').trim().split(/\\s+/)[0] || 'irmão(ã)';\n          var text = msg.replace(/\\{primeiro_nome\\}/gi, first).replace(/\\{nome\\}/gi, String(m.name||first));\n          var url = 'https://wa.me/55' + m.phone + '?text=' + encodeURIComponent(text);\n          setTimeout(function(){ window.open(url, '_blank'); }, idx * 500);\n        })(list[k], k);\n      }\n      toast('Abrindo ' + list.length + ' conversa(s)...', 'success');\n    });\n\n    var mtSync = document.getElementById('modalText');\n    if(mtSync) mtSync.innerHTML = html;\n\n    setTimeout(function(){\n      var mt = document.getElementById('modalText');\n      if(mt) mt.innerHTML = html;\n      var sel = document.getElementById('mbw-t');\n      var ta = document.getElementById('mbw-tx');\n      if(!sel || !ta) return;\n      var touched = false;\n      ta.addEventListener('input', function(){ touched = true; });\n      function apply(){\n        if(touched) return;\n        ta.value = TEMPLATES[sel.value] || TEMPLATES.a;\n      }\n      sel.addEventListener('change', function(){ touched = false; apply(); });\n      apply();\n    }, 60);\n  }\n\n  function run(){\n    try{\n      if(!document.getElementById('screenMembers')) return;\n      bar();\n      cbs();\n    }catch(e){}\n  }\n\n  function patch(){\n    if(!window._mbw && typeof window.renderMembersList === 'function'){\n      var orig = window.renderMembersList;\n      window.renderMembersList = function(){\n        var r = orig.apply(this, arguments);\n        try{ run(); }catch(e){}\n        setTimeout(run, 60);\n        setTimeout(run, 250);\n        return r;\n      };\n      window._mbw = true;\n    }\n    if(!window._mbwn && typeof window.navigate === 'function'){\n      var onav = window.navigate;\n      window.navigate = function(id){\n        var r = onav.apply(this, arguments);\n        if(id === 'screenMembers'){\n          setTimeout(run, 150);\n          setTimeout(run, 500);\n          setTimeout(run, 1200);\n        }\n        return r;\n      };\n      window._mbwn = true;\n    }\n  }\n\n  function boot(){ patch(); run(); }\n\n  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);\n  else boot();\n\n  setInterval(function(){ try{ patch(); run(); }catch(e){} }, 600);\n})();\n");
});

app.get('/mbwa.js', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.resolve(process.cwd(), 'mbwa.js'),
      path.resolve(__dirname, '../../mbwa.js'),
    ];
    if (config.frontFile) {
      candidates.push(path.join(path.dirname(config.frontFile), 'mbwa.js'));
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        res.set('Content-Type', 'application/javascript; charset=utf-8')
           .set('Cache-Control', 'no-cache, no-store, must-revalidate')
           .send(fs.readFileSync(p, 'utf8'));
        return;
      }
    }
    return res.status(404).json({ error: 'Rota não encontrada' });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao servir mbwa.js' });
  }
});

app.get('/mbw.js', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.resolve(process.cwd(), 'mbw.js'),
      path.resolve(__dirname, '../../mbw.js'),
    ];
    if (config.frontFile) {
      candidates.push(path.join(path.dirname(config.frontFile), 'mbw.js'));
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        res.set('Content-Type', 'application/javascript; charset=utf-8')
           .set('Cache-Control', 'no-cache, no-store, must-revalidate')
           .send(fs.readFileSync(p, 'utf8'));
        return;
      }
    }
    return res.status(404).json({ error: 'Rota não encontrada' });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao servir mbw.js' });
  }
});

app.get('/app.js', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.resolve(process.cwd(), 'app.js'),
      path.resolve(__dirname, '../../app.js'),
    ];
    if (config.frontFile) {
      candidates.push(path.join(path.dirname(config.frontFile), 'app.js'));
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        res.set('Content-Type', 'application/javascript; charset=utf-8')
           .set('Cache-Control', 'no-cache, no-store, must-revalidate')
           .send(fs.readFileSync(p, 'utf8'));
        return;
      }
    }
    return res.status(404).json({ error: 'Rota nao encontrada' });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao servir app.js' });
  }
});

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
    '/mbwa.js': ['mbwa.js', 'application/javascript; charset=utf-8'],
    '/mbw.js': ['mbw.js', 'application/javascript; charset=utf-8'],
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
// trigger 2026-10-27T23:14:45.5473074-03:00
