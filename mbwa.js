(function(){
  'use strict';

  function d(s){ return String(s||'').replace(/\D/g,''); }
  function pn(s){ var x=d(s); if(x.length===11)return x; if(x.length===10)return x; if(x.length===13&&x.indexOf('55')===0)return x.substr(2); if(x.length===12&&x.indexOf('55')===0)return x.substr(2); return x; }
  function data(){ return Array.isArray(window.membersData)?window.membersData:[]; }
  function toast(m,t){ if(typeof window.showToast==='function') return window.showToast(m,t||'info'); try{alert(m);}catch(e){} }

  function bar(){
    var sc=document.getElementById('screenMembers'); if(!sc)return;
    if(sc.querySelector('#mbwa-b'))return;
    var cards=sc.querySelectorAll('.card'); var tgt=null;
    for(var i=0;i<cards.length;i++){ if(cards[i].querySelector('#membersList')){tgt=cards[i];break;}}
    if(!tgt)return;
    var b=document.createElement('div'); b.id='mbwa-b';
    b.style.cssText='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:10px 12px;background:rgba(0,0,0,.02);border:1px solid var(--border);border-radius:12px;';
    b.innerHTML='<div style="font-weight:600">Envio em lote por WhatsApp</div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" id="mbwa-m">Marcar com celular</button><button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" id="mbwa-u">Desmarcar tudo</button><span id="mbwa-c" style="font-size:12px;color:var(--text-muted)">0 marcado(s)</span><button class="btn btn-primary" style="padding:6px 12px;font-size:12px" id="mbwa-s">Enviar em lote</button></div>';
    tgt.insertBefore(b,tgt.firstChild);
    document.getElementById('mbwa-m').onclick=marcar;
    document.getElementById('mbwa-u').onclick=desmarcar;
    document.getElementById('mbwa-s').onclick=enviar;
    cnt();
  }

  function marcar(){
    var ch=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
    var dt=data();
    for(var i=0;i<ch.length;i++){
      var id=ch[i].getAttribute('data-id');
      for(var j=0;j<dt.length;j++){
        if(String(dt[j].id)===String(id)){
          if(pn(dt[j].phone).length>=10) ch[i].checked=true; else ch[i].checked=false;
          break;
        }
      }
    }
    cnt();
    toast('Marcados apenas com celular','info');
  }

  function desmarcar(){
    var ch=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
    for(var i=0;i<ch.length;i++) ch[i].checked=false;
    cnt();
  }

  function cnt(){
    var n=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked').length;
    var el=document.getElementById('mbwa-c'); if(el) el.textContent=n+' marcado(s)';
  }

  function cbs(){
    var it=document.querySelectorAll('#membersList .list-item');
    if(!it.length)return;
    for(var i=0;i<it.length;i++){
      var item=it[i];
      if(item.querySelector('input[type=checkbox][data-mbwa="1"]'))continue;
      var id=null;
      var inf=item.querySelector('.list-item-info');
      if(inf&&inf.getAttribute('onclick')){
        var m=inf.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/);
        if(m) id=m[1].replace(/['"]/g,'');
      }
      if(!id){
        var b=item.querySelector('button[onclick*="openMemberDetail"]');
        if(b&&b.getAttribute('onclick')){
          var m2=b.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/);
          if(m2) id=m2[1].replace(/['"]/g,'');
        }
      }
      if(!id)continue;
      var cb=document.createElement('input');
      cb.type='checkbox'; cb.setAttribute('data-mbwa','1'); cb.setAttribute('data-id',id);
      cb.style.cssText='width:18px;height:18px;margin-right:12px;flex-shrink:0;';
      cb.onclick=function(e){e.stopPropagation();};
      cb.onchange=cnt;
      if(getComputedStyle(item).display!=='flex'){item.style.display='flex';item.style.alignItems='center';}
      item.insertBefore(cb,item.firstChild);
    }
    cnt();
  }

  function lista(){
    var ch=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
    var dt=data(); var out=[]; var seen={};
    for(var i=0;i<ch.length;i++){
      var id=ch[i].getAttribute('data-id');
      if(!id||seen[id])continue;
      for(var j=0;j<dt.length;j++){
        if(String(dt[j].id)===String(id)){
          if(pn(dt[j].phone).length>=10){ out.push(dt[j]); seen[id]=true; }
          break;
        }
      }
    }
    return out;
  }

  function enviar(){
    var lst=lista();
    if(lst.length===0){
      // tenta ler direto dos checkboxes mesmo se não batou com membersData
      var ch=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
      var dt=data();
      lst=[];
      for(var x=0;x<ch.length;x++){
        var id=ch[x].getAttribute('data-id');
        for(var y=0;y<dt.length;y++){
          if(String(dt[y].id)===String(id)){
            lst.push(dt[y]); break;
          }
        }
        if(lst.length===0 && dt.length===0){
          // fallback: só gera pelo id se não tem data carregada? não consegue gerar link sem telefone
        }
      }
    }
    if(lst.length===0){ toast('Marque pelo menos um membro com celular','warning'); return; }
    // filtra com celular
    var lstf=[];
    for(var f=0;f<lst.length;f++){ if(pn(lst[f].phone).length>=10) lstf.push(lst[f]); }
    if(lstf.length===0){ toast('Os marcados não possuem celular cadastrado','warning'); return; }
    lst=lstf;
    var html='<div style="display:flex;flex-direction:column;gap:12px"><div style="font-size:13px;color:var(--text-muted)">'+lst.length+' marcado(s)</div><div class="form-group" style="margin:0"><label class="form-label">Modelo</label><select class="form-select" id="mbwa-t"><option value="agr">Agradecimento</option><option value="fel">Felicitação/Bênçãos</option><option value="liv">Personalizada</option></select></div><div class="form-group" style="margin:0"><label class="form-label">Mensagem</label><textarea class="form-input" id="mbwa-m" rows="8" style="resize:vertical"></textarea><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Use {nome} ou {primeiro_nome}</div></div></div>';
    if(typeof window.showModal!=='function'){ toast('Modal indisponível','error'); return; }
    window.showModal('Enviar em lote por WhatsApp', html, function(){
      var ta=document.getElementById('mbwa-m'); var msg=ta?ta.value:'';
      if(!msg||!msg.trim()){ toast('Digite a mensagem','error'); return; }
      var lst2=lista();
      if(lst2.length===0){
        var ch2=document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
        var dt2=data(); lst2=[];
        for(var x2=0;x2<ch2.length;x2++){
          var id2=ch2[x2].getAttribute('data-id');
          for(var y2=0;y2<dt2.length;y2++){
            if(String(dt2[y2].id)===String(id2) && pn(dt2[y2].phone).length>=10){ lst2.push(dt2[y2]); break; }
          }
        }
      }
      if(lst2.length===0){ toast('Nenhum com celular marcado','warning'); return; }
      for(var k=0;k<lst2.length;k++){
        (function(m,idx){
          var pn2=String(m.name||'').trim().split(/\s+/)[0]||'irmão(ã)';
          var t=msg.replace(/\{primeiro_nome\}/gi,pn2).replace(/\{nome\}/gi,pn2);
          var ph=pn(m.phone);
          setTimeout(function(){ window.open('https://wa.me/55'+ph+'?text='+encodeURIComponent(t),'_blank'); }, idx*450);
        })(lst2[k],k);
      }
      toast('Abrindo '+lst2.length+' conversa(s)...','success');
    });
    setTimeout(function(){
      var sel=document.getElementById('mbwa-t'); var ta=document.getElementById('mbwa-m');
      if(!sel||!ta)return;
      function apl(){ if(ta.getAttribute('d')==='1')return; var v=sel.value;
        if(v==='fel') ta.value='A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões deseja as mais ricas bênçãos sobre sua vida e sua família!';
        else if(v==='liv') ta.value='A paz do Senhor, {primeiro_nome}!';
        else ta.value='A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões agradece de coração pela sua contribuição. "Cada um contribua segundo tiver proposto no coração" (2 Coríntios 9:7). Deus te abençoe abundantemente!';
      }
      sel.onchange=apl; ta.oninput=function(){this.setAttribute('d','1');}; apl();
    },80);
  }

  function run(){ bar(); cbs(); cnt(); }

  function patch(){
    if(window._mbwa2)return;
    if(typeof window.renderMembersList==='function'){
      var o=window.renderMembersList;
      window.renderMembersList=function(){ var r=o.apply(this,arguments); try{run();}catch(e){} setTimeout(run,40); setTimeout(run,160); setTimeout(run,500); return r; };
      window._mbwa2=true;
    }
  }

  var on=window.navigate;
  if(typeof on==='function'&&!window._mbwa2n){
    window.navigate=function(id){ var r=on.apply(this,arguments); if(id==='screenMembers'){ setTimeout(run,200); setTimeout(run,600); setTimeout(run,1000);} return r; };
    window._mbwa2n=true;
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){patch();run();});
  else {patch();run();}
  var t=0,iv=setInterval(function(){t++;patch();run();if(t>12)clearInterval(iv);},600);
})();
