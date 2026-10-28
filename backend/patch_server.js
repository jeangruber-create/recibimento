const fs=require("fs");
const mbw=fs.readFileSync("mbw.js","utf8");
const s=fs.readFileSync("backend/src/server.js","utf8");
const start=s.indexOf("app.get('/mbw.js'");
const end=s.indexOf("app.get('/mbwa.js'");
if(start<0||end<0){console.log("nf");process.exit(1);}
const ls=s.lastIndexOf("\n",start);
const repl="app.get('/mbw.js', (req, res) => {\n  res.set('Content-Type', 'application/javascript; charset=utf-8')\n     .set('Cache-Control', 'no-cache, no-store, must-revalidate')\n     .send("+JSON.stringify(mbw)+");\n});\n\n";
fs.writeFileSync("backend/src/server.js", s.slice(0,ls+1)+repl+s.slice(end));
console.log("ok");
