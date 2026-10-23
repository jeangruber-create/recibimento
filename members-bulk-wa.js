(function(){
  'use strict';

  function onlyDigits(s){ return String(s||'').replace(/\D/g,''); }
  function fmtPhone(s){ var d = onlyDigits(s); if(d.length === 11) return d; if(d.length === 10) return d; if(d.length === 12 && d.indexOf('55')===0) return d.substr(2); if(d.length === 13 && d.indexOf('55')===0) return d.substr(2); return d; }
  function getData(){ return (Array.isArray(window.membersData)) ? window.membersData : []; }

  function toast(msg,type){
    if(typeof window.showToast === 'function') return window.showToast(msg,type||'info');
    try{ alert(msg); }catch(e){}
  }

  function injectBar(){
    var screen = document.getElementById('screenMembers');
    if(!screen) return;
    if(document.getElementById('mbwa-bar')) return;
    var cards = screen.querySelectorAll('.card');
    var target = null;
    for(var i=0;i<cards.length;i++){
      if(cards[i].querySelector('#membersList')){ target = cards[i]; break; }
    }
    if(!target) return;
    var bar = document.createElement('div');
    bar.id = 'mbwa-bar';
    bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:10px 12px;background:rgba(0,0,0,0.02);border:1px solid var(--border);border-radius:12px;';
    bar.innerHTML = ''
      + '<div style="font-weight:600;font-size:14px;">Envio em lote por WhatsApp</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '  <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" id="mbwa-mark">Marcar com celular</button>'
      + '  <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" id="mbwa-unmark">Desmarcar tudo</button>'
      + '  <span id="mbwa-cnt" style="font-size:12px;color:var(--text-muted);">0 marcado(s)</span>'
      + '  <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" id="mbwa-send">Enviar em lote</button>'
      + '</div>';
    target.insertBefore(bar, target.firstChild);
    document.getElementById('mbwa-mark').onclick = markAll;
    document.getElementById('mbwa-unmark').onclick = unmarkAll;
    document.getElementById('mbwa-send').onclick = openSend;
    updateCnt();
  }

  function markAll(){
    var checks = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
    var data = getData();
    for(var i=0;i<checks.length;i++){
      var id = checks[i].getAttribute('data-id');
      for(var j=0;j<data.length;j++){
        if(String(data[j].id)===String(id)){
          if(fmtPhone(data[j].phone).length>=10){ checks[i].checked = true; } else { checks[i].checked = false; }
          break;
        }
      }
    }
    updateCnt();
    toast(checks.length ? 'Marcados os que possuem celular' : 'Nenhum item na lista', 'info');
  }

  function unmarkAll(){
    var checks = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
    for(var i=0;i<checks.length;i++) checks[i].checked = false;
    updateCnt();
  }

  function updateCnt(){
    var checks = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
    var el = document.getElementById('mbwa-cnt');
    if(el) el.textContent = checks.length + ' marcado(s)';
  }

  function addCbs(){
    var items = document.querySelectorAll('#membersList .list-item');
    if(!items.length) return;
    for(var i=0;i<items.length;i++){
      var item = items[i];
      if(item.querySelector('input[type=checkbox][data-mbwa="1"]')) continue;
      var id = null;
      var info = item.querySelector('.list-item-info');
      if(info && info.getAttribute('onclick')){
        var m = info.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/);
        if(m) id = m[1].replace(/['"]/g,'');
      }
      if(!id){
        var b = item.querySelector('button[onclick*="openMemberDetail"]');
        if(b && b.getAttribute('onclick')){
          var m2 = b.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/);
          if(m2) id = m2[1].replace(/['"]/g,'');
        }
      }
      if(!id) continue;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-mbwa','1');
      cb.setAttribute('data-id', id);
      cb.style.cssText = 'width:18px;height:18px;margin-right:12px;flex-shrink:0;';
      cb.onclick = function(e){ e.stopPropagation(); };
      cb.onchange = updateCnt;
      if(getComputedStyle(item).display !== 'flex'){ item.style.display='flex'; item.style.alignItems='center'; }
      item.insertBefore(cb, item.firstChild);
    }
    updateCnt();
  }

  function getCheckedList(){
    var checks = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
    var data = getData();
    var list = [];
    var seen = {};
    for(var i=0;i<checks.length;i++){
      var id = checks[i].getAttribute('data-id');
      if(!id || seen[id]) continue;
      for(var j=0;j<data.length;j++){
        if(String(data[j].id)===String(id)){
          if(fmtPhone(data[j].phone).length>=10){
            list.push(data[j]);
            seen[id] = true;
          }
          break;
        }
      }
    }
    return list;
  }

  function openSend(){
    var list = getCheckedList();
    if(list.length===0){
      toast('Selecione pelo menos um membro com celular marcado', 'warning');
      return;
    }
    var html = ''
      + '<div style="display:flex;flex-direction:column;gap:12px;">'
      + '  <div style="font-size:13px;color:var(--text-muted);">' + list.length + ' contato(s) com celular selecionado(s)</div>'
      + '  <div class="form-group" style="margin:0;"><label class="form-label">Modelo de mensagem</label>'
      + '    <select class="form-select" id="mbwa-tpl"><option value="agradecimento">Agradecimento pela contribuição</option><option value="felicitacao">Felicitação / Bênçãos</option><option value="livre">Mensagem livre</option></select>'
      + '  </div>'
      + '  <div class="form-group" style="margin:0;"><label class="form-label">Mensagem</label>'
      + '    <textarea class="form-input" id="mbwa-txt" rows="8" style="resize:vertical;"></textarea>'
      + '    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Variáveis: {nome}, {primeiro_nome}</div>'
      + '  </div>'
      + '</div>';

    if(typeof window.showModal === 'function'){
      window.showModal('Enviar em lote por WhatsApp', html, function(){
        var txtEl = document.getElementById('mbwa-txt');
        var msg = txtEl ? txtEl.value : '';
        if(!msg || !msg.trim()){ toast('Digite a mensagem', 'error'); return; }
        var sel2 = getCheckedList();
        if(sel2.length===0){ toast('Nenhum com celular selecionado', 'warning'); return; }
        for(var k=0;k<sel2.length;k++){
          (function(m,idx){
            var pn = String(m.name||'').trim().split(/\s+/)[0] || 'irmão(ã)';
            var t = msg.replace(/\{primeiro_nome\}/gi,pn).replace(/\{nome\}/gi,pn);
            var phone = fmtPhone(m.phone);
            setTimeout(function(){ window.open('https://wa.me/55'+phone+'?text='+encodeURIComponent(t), '_blank'); }, idx*450);
          })(sel2[k], k);
        }
        toast('Abrindo ' + sel2.length + ' conversa(s) no WhatsApp...', 'success');
      });
      setTimeout(function(){
        var tpl = document.getElementById('mbwa-tpl');
        var txt = document.getElementById('mbwa-txt');
        if(!tpl || !txt) return;
        function apply(){
          if(txt.getAttribute('data-ed')==='1') return;
          var v = tpl.value;
          if(v==='felicitacao') txt.value = 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões deseja as mais ricas bênçãos sobre sua vida e sua família!';
          else if(v==='livre') txt.value = 'A paz do Senhor, {primeiro_nome}!';
          else txt.value = 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões agradece de coração pela sua contribuição. "Cada um contribua segundo tiver proposto no coração" (2 Coríntios 9:7). Deus te abençoe abundantemente!';
        }
        tpl.onchange = apply;
        txt.oninput = function(){ this.setAttribute('data-ed','1'); };
        apply();
      }, 80);
    }else{
      toast('Modal indisponível', 'error');
    }
  }

  function run(){
    injectBar();
    addCbs();
    updateCnt();
  }

  function patch(){
    if(window._mbwaPatched) return;
    if(typeof window.renderMembersList === 'function'){
      var orig = window.renderMembersList;
      window.renderMembersList = function(){
        var r = orig.apply(this, arguments);
        try{ run(); }catch(e){}
        setTimeout(run,50); setTimeout(run,150); setTimeout(run,400);
        return r;
      };
      window._mbwaPatched = true;
    }
  }

  var origNav = window.navigate;
  if(typeof origNav === 'function' && !window._mbwaNav){
    window.navigate = function(id){
      var r = origNav.apply(this, arguments);
      if(id==='screenMembers'){ setTimeout(run,200); setTimeout(run,500); setTimeout(run,900); }
      return r;
    };
    window._mbwaNav = true;
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){ patch(); run(); });
  else { patch(); run(); }
  var c=0; var iv=setInterval(function(){ c++; patch(); run(); if(c>15) clearInterval(iv); }, 600);
  console.log('[MBWA] pronto');
})();
