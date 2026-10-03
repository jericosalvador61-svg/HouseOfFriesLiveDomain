/* ============================================================
   REQ-059 — Landing "View Menu Items" modal
   Plain ES5 (var/function, no modules) matching the landing's
   inline script style. Informational showcase ONLY — no cart,
   no links to customer pages, no localStorage writes.
   ============================================================ */
(function(){
"use strict";

var modal = document.getElementById('menuModal');
var catBar = document.getElementById('mmCatBar');
var grid = document.getElementById('mmGrid');
var lastOpener = null;
var data = window.__hofMenu || null;
var renderedData = null;
var activeCat = null;

function priceFmt(p){ return '\u20B1' + Number(p).toFixed(0); }

function catName(id){
  if (!data || !data.cats) return '';
  for (var i=0;i<data.cats.length;i++){
    if (data.cats[i].category_id === id) return data.cats[i].category_name;
  }
  return '';
}

function itemImgSrc(it){
  if (it.image_blob) return it.image_blob; // already a data: URI from the API
  return it.image_url || null;
}

function cardHTML(it, idx){
  var u = itemImgSrc(it);
  var img = u
    ? '<img loading="lazy" src="'+u+'" alt="'+String(it.item_name||'').replace(/"/g,'&quot;')+'" onerror="this.outerHTML=\'<span class=\\\'fallback\\\'>Hof</span>\'">'
    : '<span class="fallback">Hof</span>';
  return '<article class="m-card" style="animation-delay:'+Math.min(idx*45,500)+'ms">'
    + '<div class="ph">' + img + '</div>'
    + '<div class="info"><h3>'+String(it.item_name||'')+'</h3>'
    + '<div class="row"><span class="p">'+priceFmt(it.price)+'</span><span class="cat">'+catName(it.category_id)+'</span></div></div></article>';
}

function renderCats(){
  catBar.innerHTML = '';
  var all = document.createElement('button');
  all.className = 'cat-btn' + (activeCat === null ? ' active' : '');
  all.textContent = 'All';
  all.addEventListener('click', function(){ setCat(null); });
  catBar.appendChild(all);
  data.cats.forEach(function(c){
    var b = document.createElement('button');
    b.className = 'cat-btn' + (activeCat === c.category_id ? ' active' : '');
    b.textContent = c.category_name;
    b.addEventListener('click', function(){ setCat(c.category_id); });
    catBar.appendChild(b);
  });
}

function setCat(cid){
  activeCat = cid;
  renderGrid();
}

function renderGrid(){
  if (!data){
    grid.innerHTML = '<div class="mm-loading">Loading menu…</div>';
    return;
  }
  var list = activeCat ? data.items.filter(function(i){ return i.category_id === activeCat; }) : data.items;
  grid.innerHTML = list.map(cardHTML).join('');
}

function renderAll(){
  if (!data) return;
  renderCats();
  renderGrid();
}

function setData(d){
  data = d;
  if (data){ renderedData = data; activeCat = null; }
  renderAll();
}

function isOpen(){ return !modal.hidden; }

function openModal(){
  if (!data) renderGrid();
  else if (data !== renderedData) renderAll();
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('open');
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  var closeBtn = modal.querySelector('.mm-close');
  if (closeBtn) closeBtn.focus();
}

function closeModal(){
  if (!isOpen()) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('open');
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  if (lastOpener && typeof lastOpener.focus === 'function') lastOpener.focus();
}

function onDataReady(e){
  if (e && e.detail && e.detail.cats && e.detail.items) setData(e.detail);
  else if (window.__hofMenu) setData(window.__hofMenu);
}

document.addEventListener('click', function(e){
  var opener = e.target && e.target.closest ? e.target.closest('[data-open-menu]') : null;
  if (!opener) return;
  e.preventDefault();
  lastOpener = opener;
  openModal();
});

document.addEventListener('click', function(e){
  var closeEl = e.target && e.target.closest ? e.target.closest('[data-mm-close]') : null;
  if (!closeEl) return;
  closeModal();
});

document.addEventListener('click', function(e){
  if (!isOpen()) return;
  if (e.target && e.target.closest && e.target.closest('.mm-dialog')) return;
  closeModal();
});

document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' || e.key === 'Esc') closeModal();
});

window.addEventListener('hof:menu-ready', onDataReady);

if (window.__hofMenu) setData(window.__hofMenu);

})();
