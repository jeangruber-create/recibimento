(function(){
  'use strict';
  function d(s){return String(s||'').replace(/\D/g,'');}
  function p(s){var x=d(s);if(x.length===11)return x;if(x.length===10)return x;if(x.length===13&&x.indexOf('55')===0)return x.substr(2);if(x.length===12&&x.indexOf('55')===0)return x.substr(2);return x;}
  function getData(){return Array.isArray(window.membersData)?window.membersData:[];}
  function toast(m,t){if(typeof window.showToast==='function')return window.showToast(m,t||'info');try{alert(m);}catch(e){}}
  function bar(){
    var sc=document.getElementById('screenMembers');if(!sc)return;
    if(sc.querySelector('#mbwa-b'))return;
    var cards=sc.querySelectorAll('.card');var tgt=null;
    for(var i=0;i<cards.length;i++){if(cards[i].querySelector('#membersList')){tgt=cards[i];break;}}
    if(!tgt)return;
    var b=document.createElement('div');b.id='mbwa-b';
    b.style.cssText='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:10px 12px;background:rgba(0,0,0,.02);border:1px solid var(--border);border-radius:12px;';
    b.innerHTML='<div style="font-weight:600">Envio em lote por WhatsApp</div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" id="mbw-m">Marcar com celular</button><button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" id="mbw-u">Desmarcar tudo</button><span id="mbw-c" style="font-size:12px;color:var(--text-muted)">0 marcado(s)</span><button class="btn btn-primary" style="padding:6px 12px;font-size:12px" id="mbw-e">Enviar em lote</button></div>';
    tgt.insertBefore(b,tgt.firstChild);
    document.getElementById('mbw-m').onclick=mark;
    document.getElementById('mbw-u').onclick=unmark;
    document.getElementById('mbw-e').onclick=send;
    cnt();
  }
  function mark(){
    var ch=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
    var dt=getData();
    for(var i=0;i<ch.length;i++){
      var id=ch[i].getAttribute('data-id');
      for(var j=0;j<dt.length;j++){
        if(String(dt[j].id)===String(id)){ if(p(dt[j].phone).length>=10) ch[i].checked=true; else ch[i].checked=false; break; }
      }
    }
    cnt(); toast('Marcados apenas com celular','info');
  }
  function unmark(){var ch=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]'); for(var i=0;i<ch.length;i++)ch[i].checked=false; cnt();}
  function cnt(){var n=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked').length; var el=document.getElementById('mbw-c'); if(el)el.textContent=n+' marcado(s)';}
  function cbs(){
    var it=document.querySelectorAll('#membersList .list-item');
    for(var i=0;i<it.length;i++){
      var item=it[i];
      if(item.querySelector('input[type=checkbox][data-mbwa="1"]'))continue;
      var id=null;
      var inf=item.querySelector('.list-item-info');
      if(inf&&inf.getAttribute('onclick')){var m=inf.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/); if(m)id=m[1].replace(/['"]/g,'');}
      if(!id){var b=item.querySelector('button[onclick*="openMemberDetail"]'); if(b&&b.getAttribute('onclick')){var m2=b.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/); if(m2)id=m2[1].replace(/['"]/g,'');}}
      if(!id)continue;
      var cb=document.createElement('input'); cb.type='checkbox'; cb.setAttribute('data-mbwa','1'); cb.setAttribute('data-id',id);
      cb.style.cssText='width:18px;height:18px;margin-right:12px;flex-shrink:0;'; cb.onclick=function(e){e.stopPropagation();}; cb.onchange=cnt;
      if(getComputedStyle(item).display!=='flex'){item.style.display='flex';item.style.alignItems='center';}
      item.insertBefore(cb,item.firstChild);
    }
    cnt();
  }
  function send(){
    var ch=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
    if(ch.length===0){ toast('Marque pelo menos um membro com celular','warning'); return; }
    var dt=getData();
    var lst=[]; var seen={};
    for(var x=0;x<ch.length;x++){
      var id=ch[x].getAttribute('data-id');
      if(!id||seen[id])continue;
      for(var y=0;y<dt.length;y++){
        if(String(dt[y].id)===String(id) && p(dt[y].phone).length>=10){ lst.push(dt[y]); seen[id]=true; break; }
      }
    }
    if(lst.length===0){ toast('Os marcados não possuem celular ou não constam na lista','warning'); return; }
    var html='<div style="display:flex;flex-direction:column;gap:12px"><div style="font-size:13px;color:var(--text-muted)">'+lst.length+' marcado(s)</div><div class="form-group" style="margin:0"><label class="form-label">Modelo</label><select class="form-select" id="mbw-t"><option value="a">Agradecimento</option><option value="f">Felicitação/Bênçãos</option><option value="l">Personalizada</option></select></div><div class="form-group" style="margin:0"><label class="form-label">Mensagem</label><textarea class="form-input" id="mbw-tx" rows="8" style="resize:vertical"></textarea><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Use {nome} ou {primeiro_nome}</div></div></div>';
    if(typeof window.showModal!=='function'){ toast('Modal indisponível','error'); return; }
    window.showModal('Enviar em lote por WhatsApp', html, function(){
      var ta=document.getElementById('mbw-tx'); var msg=ta?ta.value:'';
      if(!msg||!msg.trim()){ toast('Digite a mensagem','error'); return; }
      var ch2=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
      var dt2=getData(); var lst2=[]; var seen2={};
      for(var x2=0;x2<ch2.length;x2++){
        var id2=ch2[x2].getAttribute('data-id');
        if(!id2||seen2[id2])continue;
        for(var y2=0;y2<dt2.length;y2++){
          if(String(dt2[y2].id)===String(id2) && p(dt2[y2].phone).length>=10){ lst2.push(dt2[y2]); seen2[id2]=true; break; }
        }
      }
      if(lst2.length===0){ toast('Nenhum com celular marcado','warning'); return; }
      for(var k=0;k<lst2.length;k++){
        (function(m,idx){
          var pn2=String(m.name||'').trim().split(/\s+/)[0]||'irmão(ã)';
          var t=msg.replace(/\{primeiro_nome\}/gi,pn2).replace(/\{nome\}/gi,pn2);
          var ph=p(m.phone);
          setTimeout(function(){window.open('https://wa.me/55'+ph+'?text='+encodeURIComponent(t),'_blank');},idx*450);
        })(lst2[k],k);
      }
      toast('Abrindo '+lst2.length+' conversa(s)...','success');
    });
    setTimeout(function(){
      var s2=document.getElementById('mbw-t'); var ta2=document.getElementById('mbw-tx');
      if(!s2||!ta2)return;
      function ap(){ if(ta2.getAttribute('d')==='1')return; var v=s2.value;
        if(v==='f') ta2.value='A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões deseja as mais ricas bênçãos sobre sua vida e sua família!';
        else if(v==='l') ta2.value='A paz do Senhor, {primeiro_nome}!';
        else ta2.value='A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões agradece de coração pela sua contribuição. "Cada um contribua segundo tiver proposto no coração" (2 Coríntios 9:7). Deus te abençoe abundantemente!';
      }
      s2.onchange=ap; ta2.oninput=function(){this.setAttribute('d','1');}; ap();
    },80);
  }
  function run(){try{bar();cbs();cnt();}catch(e){}}
  function pat(){
    if(window._mbw)return;
    if(typeof window.renderMembersList==='function'){
      var o=window.renderMembersList;
      window.renderMembersList=function(){var r=o.apply(this,arguments);try{run();}catch(e){}setTimeout(run,40);setTimeout(run,200);setTimeout(run,600);return r;};
      window._mbw=true;
    }
  }
  var on=window.navigate;
  if(typeof on==='function'&&!window._mbwn){
    window.navigate=function(id){var r=on.apply(this,arguments);if(id==='screenMembers'){setTimeout(run,200);setTimeout(run,600);setTimeout(run,1000);}return r;};
    window._mbwn=true;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){pat();run();}); else {pat();run();}
  var t=0,iv=setInterval(function(){t++;pat();run();if(t>15)clearInterval(iv);},500);
})();
