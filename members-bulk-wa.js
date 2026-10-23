(function(){
  'use strict';

  var sel = new Set();

  function onlyDigits(s){ return String(s||'').replace(/\D/g,''); }
  function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function getList(){ return (typeof window.membersData !== 'undefined' && Array.isArray(window.membersData)) ? window.membersData : []; }

  function updateCount(){
    var el = document.getElementById('mbwa-count');
    if(el) el.textContent = sel.size + ' selecionado(s)';
  }

  function injectUI(){
    var screen = document.getElementById('screenMembers');
    if(!screen) return;
    if(screen.querySelector('#mbwa-bar')) return;

    var cards = screen.querySelectorAll('.card');
    var targetCard = null;
    for(var i=0;i<cards.length;i++){
      if(cards[i].querySelector('#membersList')){ targetCard = cards[i]; break; }
    }
    if(!targetCard) return;

    var bar = document.createElement('div');
    bar.id = 'mbwa-bar';
    bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;';
    bar.innerHTML = ''
      + '<div style="font-size:13px;font-weight:600;">Selecionar para envio em lote por WhatsApp</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '  <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" id="mbwa-selall">Selecionar com celular</button>'
      + '  <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" id="mbwa-clear">Limpar seleção</button>'
      + '  <span id="mbwa-count" style="font-size:12px;color:var(--text-muted);">0 selecionado(s)</span>'
      + '  <button class="btn btn-primary" style="padding:6px 10px;font-size:12px;" id="mbwa-open">Enviar em lote</button>'
      + '</div>';

    targetCard.insertBefore(bar, targetCard.firstChild);

    document.getElementById('mbwa-selall').onclick = function(){
      sel.clear();
      var list = getList();
      for(var j=0;j<list.length;j++){
        if(onlyDigits(list[j].phone).length >= 10) sel.add(String(list[j].id));
      }
      updateCount();
      markChecks();
      if(typeof window.showToast === 'function') window.showToast(sel.size + ' selecionado(s) com celular', 'success');
    };
    document.getElementById('mbwa-clear').onclick = function(){
      sel.clear();
      updateCount();
      markChecks();
    };
    document.getElementById('mbwa-open').onclick = openModal;
    updateCount();
    markChecks();
  }

  function markChecks(){
    var checks = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
    for(var i=0;i<checks.length;i++){
      var id = checks[i].getAttribute('data-id');
      if(sel.has(String(id))) checks[i].checked = true; else checks[i].checked = false;
    }
  }

  function addCheckboxes(){
    var listEl = document.getElementById('membersList');
    if(!listEl) return;
    var items = listEl.querySelectorAll('.list-item');
    if(!items.length) return;
    for(var i=0;i<items.length;i++){
      var item = items[i];
      if(item.querySelector('input[type=checkbox][data-mbwa="1"]')) continue;
      var id = null;
      var info = item.querySelector('.list-item-info');
      if(info && info.getAttribute('onclick')){
        var m = info.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/);
        if(m) id = m[1];
      }
      if(!id){
        var btn = item.querySelector('button[onclick*="openMemberDetail"]');
        if(btn && btn.getAttribute('onclick')){
          var m2 = btn.getAttribute('onclick').match(/openMemberDetail\(([^)]+)\)/);
          if(m2) id = m2[1];
        }
      }
      if(!id) continue;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-mbwa','1');
      cb.setAttribute('data-id', String(id).replace(/'/g,''));
      cb.style.cssText = 'width:18px;height:18px;margin-right:10px;flex-shrink:0;';
      cb.onclick = function(e){ e.stopPropagation(); };
      cb.onchange = function(){
        var cid = this.getAttribute('data-id');
        var list = getList();
        var mem = null;
        for(var x=0;x<list.length;x++){ if(String(list[x].id)===String(cid)){ mem=list[x]; break; } }
        if(mem && onlyDigits(mem.phone).length < 10){
          this.checked = false;
          if(typeof window.showToast === 'function') window.showToast('Membro sem celular cadastrado','warning');
          return;
        }
        if(this.checked) sel.add(String(cid)); else sel.delete(String(cid));
        updateCount();
      };
      if(getComputedStyle(item).display !== 'flex'){
        item.style.display = 'flex';
        item.style.alignItems = 'center';
      }
      item.insertBefore(cb, item.firstChild);
    }
    updateCount();
    markChecks();
  }

  function openModal(){
    var data = getList();
    var checks0 = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
    for(var c0=0;c0<checks0.length;c0++){
      var cid0 = checks0[c0].getAttribute('data-id');
      if(cid0) sel.add(String(cid0));
    }
    updateCount();
    markChecks();

    var list = [];
    for(var i=0;i<data.length;i++){
      if(sel.has(String(data[i].id)) && onlyDigits(data[i].phone).length >= 10) list.push(data[i]);
    }
    if(list.length === 0){
      if(typeof window.showToast === 'function') window.showToast('Selecione pelo menos um membro com celular','warning');
      return;
    }
    var html = ''
      + '<div style="display:flex;flex-direction:column;gap:10px;">'
      + '  <div style="font-size:13px;color:var(--text-muted);">' + list.length + ' contato(s) selecionado(s)</div>'
      + '  <div class="form-group" style="margin:0;"><label class="form-label">Modelo</label>'
      + '    <select class="form-select" id="mbwa-model"><option value="agradecimento">Agradecimento pela contribuição</option><option value="felicitacao">Felicitação / Bênçãos</option><option value="personalizada">Personalizada (editável)</option></select>'
      + '  </div>'
      + '  <div class="form-group" style="margin:0;"><label class="form-label">Mensagem</label>'
      + '    <textarea class="form-input" id="mbwa-msg" rows="7" style="resize:vertical;"></textarea>'
      + '    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Use {nome} ou {primeiro_nome}</div>'
      + '  </div>'
      + '</div>';

    if(typeof window.showModal === 'function'){
      window.showModal('Enviar em lote por WhatsApp', html, function(){
        var checks2 = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]:checked');
        for(var cc=0;cc<checks2.length;cc++){
          var c2 = checks2[cc].getAttribute('data-id');
          if(c2) sel.add(String(c2));
        }
        var msgEl = document.getElementById('mbwa-msg');
        var msg = msgEl ? msgEl.value : '';
        if(!msg || !msg.trim()){ if(typeof window.showToast === 'function') window.showToast('Digite a mensagem','error'); return; }
        var selList = [];
        for(var j=0;j<data.length;j++){ if(sel.has(String(data[j].id)) && onlyDigits(data[j].phone).length >= 10) selList.push(data[j]); }
        if(selList.length === 0){ if(typeof window.showToast === 'function') window.showToast('Nenhum membro com celular selecionado','warning'); return; }
        for(var k=0;k<selList.length;k++){
          (function(m,idx){
            var pn = String(m.name||'').split(/\s+/)[0] || 'irmão(ã)';
            var txt = msg.replace(/\{primeiro_nome\}/gi,pn).replace(/\{nome\}/gi,pn);
            setTimeout(function(){ window.open('https://wa.me/55' + onlyDigits(m.phone) + '?text=' + encodeURIComponent(txt), '_blank'); }, idx*400);
          })(selList[k], k);
        }
        if(typeof window.showToast === 'function') window.showToast('Abrindo WhatsApp...', 'success');
      });
      setTimeout(function(){
        var modelEl = document.getElementById('mbwa-model');
        var msgEl = document.getElementById('mbwa-msg');
        if(!modelEl || !msgEl) return;
        function setTpl(){
          if(msgEl.getAttribute('data-edited')==='1') return;
          var v = modelEl.value;
          if(v==='felicitacao') msgEl.value = 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões deseja as mais ricas bênçãos sobre sua vida e sua família!';
          else if(v==='personalizada') msgEl.value = 'A paz do Senhor, {primeiro_nome}!';
          else msgEl.value = 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões agradece de coração pela sua contribuição. "Cada um contribua segundo tiver proposto no coração" (2 Coríntios 9:7). Deus te abençoe abundantemente!';
        }
        modelEl.onchange = setTpl;
        msgEl.oninput = function(){ this.setAttribute('data-edited','1'); };
        setTpl();
      }, 100);
    }
  }

  function run(){
    injectUI();
    addCheckboxes();
  }

  function patchRender(){
    if(window._mbwaRenderPatched) return;
    if(typeof window.renderMembersList === 'function'){
      var orig = window.renderMembersList;
      window.renderMembersList = function(){
        var res = orig.apply(this, arguments);
        try{ run(); }catch(e){}
        try{ setTimeout(run, 30); setTimeout(run, 150); setTimeout(run, 400); }catch(e){}
        return res;
      };
      window._mbwaRenderPatched = true;
      console.log('[MBWA] renderMembersList patchado');
      return true;
    }
    return false;
  }

  var origNavigate = window.navigate;
  if(typeof origNavigate === 'function' && !window._mbwaNavPatched){
    window.navigate = function(id){
      var r = origNavigate.apply(this, arguments);
      if(id === 'screenMembers'){ 
        setTimeout(run, 200); 
        setTimeout(run, 400); 
        setTimeout(run, 800);
      }
      return r;
    };
    window._mbwaNavPatched = true;
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ patchRender(); run(); setTimeout(run, 800); });
  }else{
    patchRender(); run(); setTimeout(run, 800);
  }
  var t=0; var iv = setInterval(function(){ t++; patchRender(); run(); if(t>20) clearInterval(iv); }, 500);
  console.log('[MBWA] carregado');
})();
