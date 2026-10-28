const fs = require("fs");
const path = require("path");
const mbw = fs.readFileSync(path.resolve(__dirname, "..", "mbw.js"), "utf8");
const code = "const fs=require('fs');const path=require('path');module.exports=function(app){app.get('/mbw.js',function(req,res){try{var p=path.resolve(__dirname,'../mbw.js');if(fs.existsSync(p)){res.set('Content-Type','application/javascript; charset=utf-8').set('Cache-Control','no-cache,no-store,must-revalidate').send(fs.readFileSync(p,'utf8'));return;}res.set('Content-Type','application/javascript; charset=utf-8').set('Cache-Control','no-cache,no-store,must-revalidate').send(" + JSON.stringify(mbw) + ");return;}catch(e){res.status(500).end('err');}});};\n";
fs.writeFileSync(path.resolve(__dirname, "src", "routes", "mbw-override.js"), code, "utf8");
console.log("ok");
