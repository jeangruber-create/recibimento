(function(){
  'use strict';

  function toast(m,t){
    try{ if(typeof window.showToast==='function'){ window.showToast(m,t||'warning'); return; } }catch(e){}
    try{ alert(m); }catch(e){}
  }

  function digits(s){ return String(s||'').replace(/\D/g,''); }

  function normPhone(s){
    var x = digits(s);
    if(x.length===13 && x.indexOf('55')===0) x = x.substr(2);
    if(x.length===12 && x.indexOf('55')===0) x = x.substr(2);
    return (x.length===10 || x.length===11) ? x : '';
  }

  function phoneFromSub(sub){
    if(!sub) return '';
    var parts = String(sub.textContent||'').split(/[•·]/);
    for(var i=0;i<parts.length;i++){
      var ph = normPhone(parts[i]);
      if(ph) return ph;
    }
    return '';
  }

  function nameFromItem(item){
    var t = item.querySelector('.list-item-title');
    if(!t) return '';
    var clone = t.cloneNode(true);
    var code = clone.querySelector('span');
    if(code) code.parentNode.removeChild(code);
    return (clone.textContent||'').replace(/\s+/g,' ').trim();
  }

  function itemData(item){
    var info = item.querySelector('.list-item-info');
    var id = '';
    if(info){
      var m = (info.getAttribute('onclick')||'').match(/openMemberDetail\(\s*([^)]+)\)/);
      if(m) id = m[1].replace(/['"\s]/g,'');
    }
    if(!id){
      var b = item.querySelector('button[onclick*="openMemberDetail"]');
      if(b){
        var m2 = (b.getAttribute('onclick')||'').match(/openMemberDetail\(\s*([^)]+)\)/);
        if(m2) id = m2[1].replace(/['"\s]/g,'');
      }
    }
    return { id: id, name: nameFromItem(item), phone: phoneFromSub(item.querySelector('.list-item-sub')) };
  }

  function selected(){
    var boxes = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
    var out = [];
    for(var i=0;i<boxes.length;i++){
      if(!boxes[i].checked) continue;
      out.push({
        id: boxes[i].getAttribute('data-id')||'',
        name: boxes[i].getAttribute('data-name')||'',
        phone: normPhone(boxes[i].getAttribute('data-phone')||'')
      });
    }
    return out;
  }

  function upd(){
    var n = selected().length;
    var el = document.getElementById('mbw-c');
    if(el) el.textContent = n + ' marcado(s)';
  }

  function cbs(){
    var items = document.querySelectorAll('#membersList .list-item');
    for(var i=0;i<items.length;i++){
      var item = items[i];
      if(item.querySelector('input[type=checkbox][data-mbwa="1"]')) continue;
      var d = itemData(item);
      if(!d.id) continue;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-mbwa','1');
      cb.setAttribute('data-id', d.id);
      cb.setAttribute('data-name', d.name);
      cb.setAttribute('data-phone', d.phone);
      cb.style.cssText = 'width:18px;height:18px;margin-right:12px;flex-shrink:0;';
      cb.addEventListener('click', function(e){ e.stopPropagation(); });
      cb.addEventListener('change', upd);
      if(getComputedStyle(item).display !== 'flex'){
        item.style.display = 'flex';
        item.style.alignItems = 'center';
      }
      item.insertBefore(cb, item.firstChild);
    }
    upd();
  }

  function bar(){
    var sc = document.getElementById('screenMembers');
    if(!sc) return;
    if(sc.querySelector('#mbwa-b')) return;
    var cards = sc.querySelectorAll('.card');
    var tgt = null;
    for(var i=0;i<cards.length;i++){
      if(cards[i].querySelector('#membersList')){ tgt = cards[i]; break; }
    }
    if(!tgt) return;
    var b = document.createElement('div');
    b.id = 'mbwa-b';
    b.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:10px 12px;background:rgba(0,0,0,.02);border:1px solid var(--border);border-radius:12px;';
    b.innerHTML = '<div style="font-weight:600">Envio em lote por WhatsApp</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" id="mbw-m">Marcar com celular</button>' +
      '<button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" id="mbw-u">Desmarcar tudo</button>' +
      '<span id="mbw-c" style="font-size:12px;color:var(--text-muted)">0 marcado(s)</span>' +
      '<button class="btn btn-primary" style="padding:6px 12px;font-size:12px" id="mbw-e">Enviar em lote</button></div>';
    tgt.insertBefore(b, tgt.firstChild);

    document.getElementById('mbw-m').onclick = function(){
      var boxes = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
      var n = 0;
      for(var i=0;i<boxes.length;i++){
        var ok = !!normPhone(boxes[i].getAttribute('data-phone'));
        boxes[i].checked = ok;
        if(ok) n++;
      }
      upd();
      toast(n + ' membro(s) com celular marcado(s)');
    };
    document.getElementById('mbw-u').onclick = function(){
      var boxes = document.querySelectorAll('#membersList input[type=checkbox][data-mbwa="1"]');
      for(var i=0;i<boxes.length;i++) boxes[i].checked = false;
      upd();
    };
    document.getElementById('mbw-e').onclick = send;
    upd();
  }

  var TEMPLATES = {
    a: 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões agradece de coração pela sua contribuição. "Cada um contribua segundo tiver proposto no coração" (2 Coríntios 9:7). Deus te abençoe abundantemente!',
    f: 'A paz do Senhor, {primeiro_nome}! A Assembleia de Deus Missões deseja as mais ricas bênçãos sobre sua vida e sua família!',
    l: 'A paz do Senhor, {primeiro_nome}!'
  };

  function send(){
    var sel = selected();
    if(sel.length === 0){ toast('Marque pelo menos um membro com celular'); return; }
    var lst = [];
    for(var i=0;i<sel.length;i++){ if(sel[i].phone) lst.push(sel[i]); }
    if(lst.length === 0){ toast('Os marcados não possuem celular cadastrado'); return; }
    if(typeof window.showModal !== 'function'){ toast('Modal indisponível'); return; }

    var html = '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div style="font-size:13px;color:var(--text-muted)">' + lst.length + ' destinatário(s)</div>' +
      '<div class="form-group" style="margin:0"><label class="form-label">Modelo</label>' +
      '<select class="form-select" id="mbw-t"><option value="a">Agradecimento</option><option value="f">Felicitação / Bênçãos</option><option value="l">Personalizada</option></select></div>' +
      '<div class="form-group" style="margin:0"><label class="form-label">Mensagem</label>' +
      '<textarea class="form-input" id="mbw-tx" rows="8" style="resize:vertical"></textarea>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Use {nome} ou {primeiro_nome} para personalizar</div></div></div>';

    window.showModal('Enviar em lote por WhatsApp', '', function(){
      var ta = document.getElementById('mbw-tx');
      var msg = ta ? String(ta.value||'') : '';
      if(!msg.trim()){ toast('Digite a mensagem'); return; }
      var now = selected();
      var list = [];
      for(var i=0;i<now.length;i++){ if(now[i].phone) list.push(now[i]); }
      if(list.length === 0){ toast('Nenhum destinatário com celular'); return; }
      for(var k=0;k<list.length;k++){
        (function(m, idx){
          var first = String(m.name||'').trim().split(/\s+/)[0] || 'irmão(ã)';
          var text = msg.replace(/\{primeiro_nome\}/gi, first).replace(/\{nome\}/gi, String(m.name||first));
          var url = 'https://wa.me/55' + m.phone + '?text=' + encodeURIComponent(text);
          setTimeout(function(){ window.open(url, '_blank'); }, idx * 500);
        })(list[k], k);
      }
      toast('Abrindo ' + list.length + ' conversa(s)...', 'success');
    });

    var mtSync = document.getElementById('modalText');
    if(mtSync) mtSync.innerHTML = html;

    setTimeout(function(){
      var mt = document.getElementById('modalText');
      if(mt) mt.innerHTML = html;
      var sel = document.getElementById('mbw-t');
      var ta = document.getElementById('mbw-tx');
      if(!sel || !ta) return;
      var touched = false;
      ta.addEventListener('input', function(){ touched = true; });
      function apply(){
        if(touched) return;
        ta.value = TEMPLATES[sel.value] || TEMPLATES.a;
      }
      sel.addEventListener('change', function(){ touched = false; apply(); });
      apply();
    }, 60);
  }

  function run(){
    try{
      if(!document.getElementById('screenMembers')) return;
      bar();
      cbs();
    }catch(e){}
  }

  function patch(){
    if(!window._mbw && typeof window.renderMembersList === 'function'){
      var orig = window.renderMembersList;
      window.renderMembersList = function(){
        var r = orig.apply(this, arguments);
        try{ run(); }catch(e){}
        setTimeout(run, 60);
        setTimeout(run, 250);
        return r;
      };
      window._mbw = true;
    }
    if(!window._mbwn && typeof window.navigate === 'function'){
      var onav = window.navigate;
      window.navigate = function(id){
        var r = onav.apply(this, arguments);
        if(id === 'screenMembers'){
          setTimeout(run, 150);
          setTimeout(run, 500);
          setTimeout(run, 1200);
        }
        return r;
      };
      window._mbwn = true;
    }
  }

  function boot(){ patch(); run(); }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  setInterval(function(){ try{ patch(); run(); }catch(e){} }, 600);
})();
