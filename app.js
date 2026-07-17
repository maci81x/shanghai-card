// PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// PWA Install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (sessionStorage.getItem('install-dismissed')) return;
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.innerHTML = `
    <div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
      background:#FFD60A;color:#1E1E1E;padding:12px 20px;border-radius:12px;
      display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.4);
      z-index:9999;max-width:90%;font-family:sans-serif;">
      <span style="font-size:24px;">📲</span>
      <div>
        <div style="font-weight:bold;font-size:14px;">Installa Shanghai Card</div>
        <div style="font-size:12px;">Aggiungila alla schermata Home!</div>
      </div>
      <button onclick="installPWA()" style="background:#1E1E1E;color:#FFD60A;border:none;
        padding:8px 16px;border-radius:8px;font-weight:bold;cursor:pointer;">Installa</button>
      <button onclick="dismissInstall()" style="background:none;border:none;color:#1E1E1E;
        font-size:18px;cursor:pointer;padding:4px;">✕</button>
    </div>
  `;
  document.body.appendChild(banner);
}

window.installPWA = async function() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('install-banner')?.remove();
  }
};

window.dismissInstall = function() {
  document.getElementById('install-banner')?.remove();
  sessionStorage.setItem('install-dismissed', '1');
};

// iOS install hint (Safari non supporta beforeinstallprompt)
(function(){
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isInStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (isIOS && !isInStandalone && !sessionStorage.getItem('install-dismissed')) {
    setTimeout(() => {
      if (document.getElementById('install-banner')) return;
      const banner = document.createElement('div');
      banner.id = 'install-banner';
      banner.innerHTML = `
        <div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
          background:#FFD60A;color:#1E1E1E;padding:12px 20px;border-radius:12px;
          display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.4);
          z-index:9999;max-width:90%;font-family:sans-serif;">
          <span style="font-size:24px;">📲</span>
          <div>
            <div style="font-weight:bold;font-size:13px;">Installa Shanghai Card</div>
            <div style="font-size:11px;">Tocca <strong>Condividi ⬆️</strong> poi <strong>"Aggiungi a Home"</strong></div>
          </div>
          <button onclick="dismissInstall()" style="background:none;border:none;color:#1E1E1E;
            font-size:18px;cursor:pointer;padding:4px;">✕</button>
        </div>
      `;
      document.body.appendChild(banner);
    }, 3000);
  }
})();

const SB_URL = 'https://kbcrtwqtzuipcsfiyupu.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiY3J0d3F0enVpcGNzZml5dXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTc3NzEsImV4cCI6MjA5OTA5Mzc3MX0.BYpoUqhiqREsA7MosC2jnLCkvXbcwjTeBdT7LhRS1UA';
let db, currentUser = null, staffTarget = null, allAdminUsers = [], staffOps = [];
let _gadgetsAdminCache = {}, _promosAdminCache = {}, _eventsAdminCache = {}, _unseenEventsQueue = [];
let _incompleteUsersMap = {};
let _adminUsersRole = 'all', _adminUsersSearch = '', _adminUsersSort = {key: 'card_id', dir: 'asc'};

// ── EVENT DELEGATION (bottoni generati da innerHTML) ──────────────────
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'create-event')  adminCreateEvent();
  if (action === 'delete-event')  adminDeleteEvent(btn.dataset.eventId, btn.dataset.eventTitle);
  if (action === 'create-gadget') createGadget();
  if (action === 'create-promo')  createPromo();
  if (action === 'clear-session') clearSession();
});

// ── NAV ───────────────────────────────────────────────────────────────
function showNav(role) {
  const nav = document.getElementById('app-nav');
  // Mostra nav solo per ruolo 'user' (soci); staff/admin hanno propri tab
  if (role !== 'user') { nav.classList.remove('visible'); return; }
  nav.classList.add('visible');
  applyNavPos(localStorage.getItem('sh_navpos') || 'bottom');
}
function hideNav() {
  const nav = document.getElementById('app-nav');
  nav.classList.remove('visible');
  document.body.classList.remove('nav-bottom','nav-sidebar');
}
function applyNavPos(pos) {
  const nav = document.getElementById('app-nav');
  if (pos === 'sidebar') {
    nav.classList.add('sidebar'); document.body.classList.add('nav-sidebar'); document.body.classList.remove('nav-bottom');
  } else {
    nav.classList.remove('sidebar'); document.body.classList.add('nav-bottom'); document.body.classList.remove('nav-sidebar');
  }
  document.getElementById('nav-pos-btn').querySelector('.ni').textContent = pos === 'sidebar' ? '⇆' : '⇅';
}
function toggleNavPos() {
  const cur = localStorage.getItem('sh_navpos') || 'bottom';
  const next = cur === 'bottom' ? 'sidebar' : 'bottom';
  localStorage.setItem('sh_navpos', next);
  applyNavPos(next);
}
function navGo(section) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-nav="${section}"]`)?.classList.add('active');
  // Attiva il tab corrispondente nell'area utente
  if (section === 'home') {
    document.getElementById('u-home-sec').style.display = '';
    document.getElementById('u-mov-sec').style.display = 'none';
    document.getElementById('u-cat-sec').style.display = '';
    document.getElementById('u-prof-sec').style.display = 'none';
  } else if (section === 'movimenti') {
    document.getElementById('u-home-sec').style.display = 'none';
    document.getElementById('u-mov-sec').style.display = '';
    document.getElementById('u-cat-sec').style.display = 'none';
    document.getElementById('u-prof-sec').style.display = 'none';
    renderMovimentiFiltered();
  } else if (section === 'eventi') {
    document.getElementById('u-home-sec').style.display = 'none';
    document.getElementById('u-mov-sec').style.display = 'none';
    document.getElementById('u-cat-sec').style.display = '';
    document.getElementById('u-prof-sec').style.display = 'none';
    // Attiva tab eventi nel catalogo
    const evTab = document.querySelector('#utabs [data-p="ut-eventi"]');
    if (evTab) switchTab(evTab, 'utabs');
  } else if (section === 'profilo') {
    document.getElementById('u-home-sec').style.display = 'none';
    document.getElementById('u-mov-sec').style.display = 'none';
    document.getElementById('u-cat-sec').style.display = 'none';
    document.getElementById('u-prof-sec').style.display = '';
    renderProfile();
  }
}

// ── TEMA ──────────────────────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.classList.toggle('light', t === 'light');
  document.querySelectorAll('#theme-btn').forEach(b => b.textContent = t === 'light' ? '☀️' : '🌙');
}
function toggleTheme() {
  const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('sh_theme', next);
  applyTheme(next);
}

// ── INIT ──────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('sh_theme') || 'dark');
  db = window.supabase.createClient(SB_URL, SB_KEY);
  staffOps = JSON.parse(localStorage.getItem('s_ops') || '[]');
  document.getElementById('modal-ok').addEventListener('click', () => { const cb = window._mcb; modalCancel(); cb && cb(); });
  document.getElementById('l-pin').addEventListener('keydown', e => { if(e.key==='Enter') doLogin('user'); });
  document.getElementById('s-lookup').addEventListener('keydown', e => { if(e.key==='Enter') staffLookup(); });
  document.getElementById('a-lookup')?.addEventListener('keydown', e => { if(e.key==='Enter') adminLookup(); });
  document.getElementById('ac-lookup')?.addEventListener('keydown', e => { if(e.key==='Enter') adminCassaLookup(); });

  // Rilevamento landing evento pubblica
  const eventSlug = new URLSearchParams(window.location.search).get('event');
  if (eventSlug) { loadPublicEvent(eventSlug); return; }

  // Monta image uploader nei form statici admin (gadget/promo/edit modals/edit event/edit user non hanno uploader)
  mountImageUploader('fg-img-mount',  'fg-img',  'gadgets');
  mountImageUploader('fp-img-mount',  'fp-img',  'promos');
  mountImageUploader('fpe-img-mount', 'fpe-img', 'promos');
  mountImageUploader('gae-img-mount', 'gae-img', 'gadgets');
  mountImageUploader('eve-img-mount', 'eve-img', 'events');

  const saved = sessionStorage.getItem('sh_u');
  const role  = sessionStorage.getItem('sh_r');
  if (saved && role) { currentUser = JSON.parse(saved); route(role); }
});

// ── UTILITIES ────────────────────────────────────────────────────────
const eur = c => '€ ' + Number(c||0).toFixed(2).replace('.',',');
const fdt = iso => { if(!iso) return '—'; const d=new Date(iso); return d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'2-digit'})+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}); };
const txic = t => ({recharge:'🔄',purchase:'🛍️',event_fee:'🎫',refund:'↩️'}[t]||'•');

let _tt;
function toast(msg, type='err') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + type;
  clearTimeout(_tt); _tt = setTimeout(() => el.className='', 3200);
}
function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function modalConfirm(msg, cb) {
  const parts = msg.split('\n\n');
  document.getElementById('modal-title').textContent = parts[0];
  const det = document.getElementById('modal-detail');
  if (parts.length > 1) {
    det.innerHTML = parts.slice(1).join('\n\n').split('\n').map(_esc).join('<br>');
    det.style.display = '';
  } else {
    det.style.display = 'none';
  }
  document.getElementById('modal').classList.add('open');
  window._mcb = cb;
}
function modalCancel() {
  document.getElementById('modal').classList.remove('open');
  window._mcb = null;
  document.getElementById('modal-ok').textContent = 'Conferma';
  document.querySelector('#modal .btn-q').style.display = '';
}
function modalInfo(msg, cb, btnLabel) {
  const parts = msg.split('\n\n');
  document.getElementById('modal-title').textContent = parts[0];
  const det = document.getElementById('modal-detail');
  if (parts.length > 1) {
    det.innerHTML = parts.slice(1).join('\n\n').split('\n').map(_esc).join('<br>');
    det.style.display = '';
  } else { det.style.display = 'none'; }
  document.getElementById('modal').classList.add('open');
  document.getElementById('modal-ok').textContent = btnLabel || 'Chiudi';
  document.querySelector('#modal .btn-q').style.display = 'none';
  window._mcb = cb || null;
}
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function switchTab(btn, groupId) {
  const wrap = document.getElementById(groupId).closest('.tab-wrap');
  wrap.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  wrap.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.p).classList.add('active');
}
function switchStab(btn, groupId) {
  const wrap = document.getElementById(groupId).closest('.sub-wrap');
  wrap.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
  wrap.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.p).classList.add('active');
}
function toggleEl(id) { const el=document.getElementById(id); el.style.display=el.style.display==='none'?'block':'none'; }
function filterUsers(btn) {
  document.getElementById('a-filter').querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _adminUsersRole = btn.dataset.role;
  renderAUsers(_adminUsersRole);
}

// ── LOGIN ────────────────────────────────────────────────────────────
async function doLogin(role) {
  const card = document.getElementById('l-card').value.trim().toUpperCase();
  const pin  = document.getElementById('l-pin').value.trim();
  if (!card || !pin) return toast('Inserisci tessera e PIN');
  const rpc = {user:'login_user', staff:'login_staff', admin:'login_admin'}[role];
  const { data, error } = await db.rpc(rpc, {p_card_id: card, p_pin: pin});
  if (error) return toast(error.message);
  if (!data.ok) return toast(data.error);
  currentUser = data.user || {
    id: data.id, card_id: data.card_id, display_name: data.display_name,
    balance: data.balance, is_staff: data.is_staff, role: data.role
  };
  sessionStorage.setItem('sh_u', JSON.stringify(currentUser));
  sessionStorage.setItem('sh_r', role);
  route(role);
}
function route(role) {
  if (role==='user')  { gotoUser(); setTimeout(checkUnseenEvents, 600); }
  else if (role==='staff') gotoStaff();
  else gotoAdmin();
}
function logout() {
  currentUser = null; staffTarget = null;
  staffOps = []; localStorage.removeItem('s_ops');
  sessionStorage.removeItem('sh_u'); sessionStorage.removeItem('sh_r');
  document.getElementById('l-pin').value = '';
  hideNav();
  showScreen('screen-login');
}

// ── MOVIMENTI FILTRI ─────────────────────────────────────────────────
let _movTipo = 'all', _movDays = 0, _allTx = [];
let _pendingEvents = [], _myEventIds = new Set(), _myEventRegs = {}, _eventsCache = [], _promoCache = [];
let _staffTxAll = [], _staffTxTipo = 'all', _staffTxDays = 0;
let _adminTxAll = [], _adminTxTipo = 'all', _adminTxDays = 0, _adminTxSearch = '';
let _gqtyId, _gqtyName, _gqtyPrice, _gqtyN = 1;
let _compRegId = null, _compMode = 'user', _compEventId = '', _compCtx = '', _compCache = [];
let _compEventPrice = 0, _compSelfStatus = '', _compEventTitle = '';
function setMovFiltro(btn, group) {
  btn.closest('div').querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (group === 'tipo') _movTipo = btn.dataset.mf;
  else _movDays = parseInt(btn.dataset.mf);
  renderMovimentiFiltered();
}
function renderMovimentiFiltered() {
  const now = Date.now();
  const list = _allTx.filter(t => {
    const tipoOk = _movTipo === 'all' || t.type === _movTipo;
    const dateOk = _movDays === 0 || (now - new Date(t.created_at).getTime()) < _movDays * 86400000;
    return tipoOk && dateOk;
  });
  const el = document.getElementById('u-mov-list');
  if (!list.length) { el.innerHTML='<div class="empty">Nessun movimento</div>'; return; }
  el.innerHTML = list.map(t=>`
    <div class="tx-row">
      <span class="tx-ic">${_txIconHtml(t)}</span>
      <div class="tx-inf">
        <div class="tx-dsc">${_esc(t.description||t.type)}</div>
        ${_txMetaHtml(t, 'Operatore')}
      </div>
      <div class="tx-amt ${t.amount>=0?'pos':'neg-c'}">${t.amount>=0?'+':''}${eur(t.amount)}</div>
    </div>`).join('');
}

// ── PROFILO ───────────────────────────────────────────────────────────
function renderProfile() {
  const u = currentUser;
  document.getElementById('u-profile-content').innerHTML = `
    <div class="card" style="margin-bottom:12px;text-align:center;padding:24px">
      <div style="font-size:44px;margin-bottom:8px">👤</div>
      <div style="font-size:18px;font-weight:700">${u.display_name}</div>
      <div style="font-family:monospace;font-size:15px;color:var(--gold);margin-top:4px">${u.card_id}</div>
      <div style="font-size:12px;color:var(--mut);margin-top:4px"><span class="role-badge ru">${u.role}</span></div>
    </div>
    <div class="card">
      <div class="sec-lbl">Dati profilo</div>
      ${u.email ? `<div class="fg" style="margin-bottom:6px"><label>Email</label><div style="font-size:14px;padding:8px 0">${u.email}</div></div>` : ''}
      ${u.telefono ? `<div class="fg" style="margin-bottom:6px"><label>Telefono</label><div style="font-size:14px;padding:8px 0">${u.telefono}</div></div>` : ''}
      ${u.nome ? `<div class="fg" style="margin-bottom:6px"><label>Nome</label><div style="font-size:14px;padding:8px 0">${u.nome} ${u.cognome||''}</div></div>` : ''}
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--brd)">
        <div class="sec-lbl" style="margin-bottom:10px">Cambia PIN</div>
        <div class="fg"><label>PIN attuale</label><input id="p-old-pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••"></div>
        <div class="form-row">
          <div class="fg"><label>Nuovo PIN</label><input id="p-new-pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••"></div>
          <div class="fg"><label>Conferma</label><input id="p-new-pin2" type="password" inputmode="numeric" maxlength="6" placeholder="••••"></div>
        </div>
        <button class="btn btn-p w100" onclick="userChangePin()">Aggiorna PIN</button>
      </div>
    </div>`;
}
async function userChangePin() {
  const oldp = document.getElementById('p-old-pin').value;
  const newp = document.getElementById('p-new-pin').value;
  const newp2 = document.getElementById('p-new-pin2').value;
  if (!oldp) return toast('Inserisci il PIN attuale');
  if (newp !== newp2) return toast('I nuovi PIN non coincidono');
  if (newp.length < 4 || !/^\d+$/.test(newp)) return toast('PIN deve essere 4-6 cifre numeriche');
  // Verifica PIN attuale facendo un login silenzioso
  const {data: chk} = await db.rpc('login_user', {p_card_id: currentUser.card_id, p_pin: oldp});
  if (!chk?.ok) return toast('PIN attuale non corretto');
  // Usa admin_reset_pin passando il proprio card_id (operazione auto-servizio)
  const {data, error} = await db.rpc('admin_reset_pin', {p_card_id: currentUser.card_id, p_new_pin: newp});
  if (error || !data.ok) return toast((error&&error.message)||data.error);
  toast('PIN aggiornato con successo!', 'ok');
  ['p-old-pin','p-new-pin','p-new-pin2'].forEach(id => document.getElementById(id).value='');
}

// ── USER AREA ─────────────────────────────────────────────────────────
async function gotoUser() {
  document.getElementById('u-name').textContent = currentUser.display_name;
  document.getElementById('u-card').textContent = currentUser.card_id;
  showScreen('screen-user');
  const toggle = document.getElementById('u-staff-toggle');
  if (toggle) toggle.style.display = currentUser.is_staff ? '' : 'none';
  showNav('user');
  navGo('home');
  renderQR(currentUser.card_id);
  await refreshUser();
  await loadCatalog();
}
function renderQR(cardId) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(cardId);
    qr.make();
    document.getElementById('u-qr').innerHTML = qr.createImgTag(4, 8);
    const img = document.querySelector('#u-qr img');
    if (img) { img.style.borderRadius='8px'; img.style.background='#fff'; img.style.padding='6px'; }
  } catch(e) { document.getElementById('u-qr').innerHTML = ''; }
}
async function refreshUser() {
  const {data, error} = await db.rpc('get_user_state', {p_user_id: currentUser.id});
  if (error || !data.ok) return toast((error&&error.message)||data.error);
  renderBal(data.balance);
  _allTx         = data.transactions   || [];
  _pendingEvents = data.pending_events || [];
  _myEventIds    = new Set(data.my_event_ids || []);
  _myEventRegs   = {};
  (data.my_event_regs || []).forEach(r => { _myEventRegs[r.event_id] = r; });
  renderTx(_allTx.slice(0, 5));
  renderPendingEvents(_pendingEvents);
  if (_eventsCache.length) renderEvents(_eventsCache);
}
function renderBal(c) {
  document.getElementById('u-balance').textContent = eur(c);
  const b = document.getElementById('u-badge');
  if (c >= 10) { b.textContent='● Ottimo'; b.className='badge bg'; }
  else if (c >= 5) { b.textContent='● Basso'; b.className='badge by'; }
  else { b.textContent='● Critico'; b.className='badge br'; }
}
function renderTx(txs) {
  const el = document.getElementById('u-txlist');
  if (!txs.length) { el.innerHTML='<div class="empty">Nessuna transazione</div>'; return; }
  el.innerHTML = txs.map(t=>`
    <div class="tx-row">
      <span class="tx-ic">${_txIconHtml(t)}</span>
      <div class="tx-inf">
        <div class="tx-dsc">${_esc(t.description||t.type)}</div>
        ${_txMetaHtml(t, 'Operatore')}
      </div>
      <div class="tx-amt ${t.amount>=0?'pos':'neg-c'}">${t.amount>=0?'+':''}${eur(t.amount)}</div>
    </div>`).join('');
}
async function loadCatalog() {
  const {data} = await db.rpc('get_catalog');
  if (!data) return;
  _eventsCache = data.events || [];
  _promoCache  = data.promos || [];
  renderEvents(_eventsCache);
  renderGadgets(data.gadgets||[]);
  renderPromos(data.promos||[]);
  renderSumUp(data.sumup_links||[]);
}
function _calcPromo(amount) {
  const now = new Date();
  const active = _promoCache.find(p => {
    const from = p.valid_from ? new Date(p.valid_from) : null;
    const to   = p.valid_to   ? new Date(p.valid_to)   : null;
    return (!from || now >= from) && (!to || now <= to);
  });
  if (!active) return null;
  let discount = 0;
  if (active.discount_type === 'percent') discount = +(amount * active.discount_value / 100).toFixed(2);
  else if (active.discount_type === 'fixed') discount = Math.min(+active.discount_value, amount);
  const charged = +(amount - discount).toFixed(2);
  return {code: active.code, discount, charged, original: amount};
}
function renderEvents(evs) {
  _eventsCache = evs;
  const el = document.getElementById('ut-eventi');
  if (!evs.length) { el.innerHTML='<div class="empty">Nessun evento attivo</div>'; return; }
  el.innerHTML = evs.map(e => {
    const isFree = !e.price || e.price == 0;
    const pend = _pendingEvents.find(p => p.event_id === e.id);
    const isRegistered = _myEventIds.has(e.id);
    const t = _esc(e.title);
    const tj = e.title.replace(/'/g,"\\'");
    const img = e.image_url ? `<img src="${e.image_url}" class="event-img" alt="${t}">` : '';
    if (pend) {
      return `<div class="cat-card ev-card-pending">
        ${img}
        <div class="ev-status ev-pending">⏳ Da saldare · <strong>${eur(pend.amount)}</strong></div>
        <div class="cat-title">${t}</div>
        <div class="cat-sub">${e.event_date?fdt(e.event_date):'—'}${e.location?' · '+_esc(e.location):''}</div>
        <div class="ev-pay-grid">
          <button class="btn btn-p" onclick="userPayEventCredit('${pend.registration_id}','${tj}',${pend.amount})">💳 Credito</button>
          ${pend.sumup_link
            ?`<a href="${pend.sumup_link}" target="_blank" rel="noopener" class="btn btn-g">📱 SumUp</a>`
            :`<button class="btn btn-g" onclick="toast('Paga con SumUp in cassa: lo staff registrerà il pagamento.','ok')">📱 SumUp</button>`}
          <button class="btn btn-q" onclick="toast('Recati in cassa con il tuo QR per saldare','ok')">🏠 In cassa</button>
        </div></div>`;
    }
    if (isRegistered) {
      const reg = _myEventRegs[e.id] || {};
      const pSz = reg.party_size || 1;
      const regId = reg.registration_id || '';
      const companions = reg.companions || [];
      const compDisp = companions.length
        ? `<div style="font-size:12px;color:var(--mut);margin-top:4px">👥 ${companions.map(c=>_esc(c.nome)+' '+_esc(c.cognome)).join(', ')}</div>`
        : '';
      return `<div class="cat-card ev-card-paid">
        ${img}
        <div class="ev-status ev-paid">✓ Iscritto${pSz>1?' · 👥 '+pSz+' persone':''}</div>
        <div class="cat-title">${t}</div>
        <div class="cat-sub">${e.event_date?fdt(e.event_date):'—'}${e.location?' · '+_esc(e.location):''}</div>
        ${compDisp}
        ${regId?`<button class="btn-sm" style="margin-top:8px" onclick="openCompanionsModal('${regId}')">👥 Gestisci gruppo</button>`:''}
      </div>`;
    }
    return `<div class="cat-card">
      ${img}
      <div class="cat-title">${t}</div>
      <div class="cat-sub">${e.event_date?fdt(e.event_date):'—'}${e.location?' · '+_esc(e.location):''}</div>
      ${e.max_participants?`<div class="cat-sub">Max ${e.max_participants} posti</div>`:''}
      <div class="cat-foot">
        <div class="cat-price">${isFree?'Gratuito':eur(e.price)}</div>
        <button class="btn-sm p" onclick="registerEvent('${e.id}','${tj}',${e.price||0})">${isFree?'🎁 Iscriviti gratis':'Iscriviti'}</button>
      </div></div>`;
  }).join('');
}
function renderGadgets(gads) {
  const el = document.getElementById('ut-gadget');
  if (!gads.length) { el.innerHTML='<div class="empty">Nessun gadget disponibile</div>'; return; }
  el.innerHTML = `<div style="font-size:13px;color:var(--mut);margin-bottom:10px;padding:10px;background:var(--bg);border-radius:8px">
    🏪 Prenota qui, ritira e paga in cassa da <strong>Antonella</strong>
  </div>` +
  gads.map(g=>`
    <div class="cat-card">
      ${g.image_url?`<img src="${g.image_url}" style="width:100%;border-radius:12px;margin-bottom:12px;max-height:200px;object-fit:cover" alt="${_esc(g.name)}">` : ''}
      <div class="cat-title">${_esc(g.name)}</div>
      <div class="cat-sub">${_esc(g.description||'')}</div>
      <div class="cat-foot">
        <div class="cat-price">${eur(g.price)}</div>
        <div class="cat-stock">Stock: ${g.stock}</div>
        <button class="btn-sm p" onclick="openReserveGadget('${g.id}','${_esc(g.name.replace(/'/g,"\\'"))}',${g.price})">📌 Prenota</button>
      </div>
    </div>`).join('');
  loadUserGadgetReservations();
}
function openReserveGadget(id, name, price) {
  _gqtyId = id; _gqtyName = name; _gqtyPrice = price; _gqtyN = 1;
  document.getElementById('gqty-name').textContent = name;
  document.getElementById('gqty-unit').textContent = eur(price) + ' cad.';
  document.getElementById('gqty-n').textContent = 1;
  document.getElementById('gqty-total').textContent = 'Totale: ' + eur(price);
  document.getElementById('gqty-bg').style.display = 'flex';
}
function gqtyAdj(delta) {
  _gqtyN = Math.min(10, Math.max(1, _gqtyN + delta));
  document.getElementById('gqty-n').textContent = _gqtyN;
  document.getElementById('gqty-total').textContent = 'Totale: ' + eur(_gqtyPrice * _gqtyN);
}
function closeGqty() { document.getElementById('gqty-bg').style.display = 'none'; }
async function confirmGqty() {
  closeGqty();
  const {data, error} = await db.rpc('user_reserve_gadget', {p_user_id: currentUser.id, p_gadget_id: _gqtyId, p_quantity: _gqtyN});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  toast(`📌 Prenotazione inviata! Ritira e paga in cassa da Antonella.`, 'ok');
  loadUserGadgetReservations();
}
// ── ACCOMPAGNATORI ───────────────────────────────────────────────────
function _renderCompModal(mode) {
  // Self row (user mode + evento con prezzo)
  const selfEl = document.getElementById('comp-self-row');
  if (mode === 'user' && _compEventPrice > 0) {
    const paid = _compSelfStatus && _compSelfStatus !== 'da_saldare';
    selfEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--brd)">
      ${!paid ? `<input type="checkbox" id="chk-self" onchange="_updateCompTotal()" style="width:16px;height:16px;flex-shrink:0">` : '<span style="width:16px;flex-shrink:0"></span>'}
      <div style="flex:1;font-size:14px">Tu</div>
      <span style="font-size:12px;color:${paid?'var(--grn)':'var(--gold)'}">${paid?'✅ Pagato':'⏳ Da saldare'}</span>
    </div>`;
    selfEl.style.display = '';
  } else {
    selfEl.innerHTML = ''; selfEl.style.display = 'none';
  }
  // Lista companions
  const listEl = document.getElementById('comp-list');
  if (!_compCache.length) {
    listEl.innerHTML = '<div style="color:var(--mut);font-size:13px;padding:8px 0">Nessun accompagnatore aggiunto</div>';
  } else if (mode === 'user') {
    listEl.innerHTML = _compCache.map(c => {
      const paid = c.payment_status && c.payment_status !== 'da_saldare';
      return `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--brd)">
        ${(!paid && _compEventPrice > 0) ? `<input type="checkbox" id="chk-c-${c.id}" onchange="_updateCompTotal()" style="width:16px;height:16px;flex-shrink:0">` : '<span style="width:16px;flex-shrink:0"></span>'}
        <div style="flex:1;font-size:14px">${_esc(c.nome)} ${_esc(c.cognome)}</div>
        <span style="font-size:12px;color:${paid?'var(--grn)':'var(--gold)'}">${paid?'✅':'⏳'}</span>
        <button class="btn-sm" style="color:var(--neg);font-size:11px;padding:2px 6px" onclick="removeCompanion('${c.id}')">×</button>
      </div>`;
    }).join('');
  } else {
    listEl.innerHTML = _compCache.map(c => {
      const paid = c.payment_status && c.payment_status !== 'da_saldare';
      return `<div style="padding:9px 0;border-bottom:1px solid var(--brd)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;font-size:14px">${_esc(c.nome)} ${_esc(c.cognome)}</div>
          <span style="font-size:11px;color:${paid?'var(--grn)':'var(--gold)'}">${paid?'✅ Pagato':'⏳ Da saldare'}</span>
          <button class="btn-sm" style="color:var(--neg);font-size:11px;padding:2px 6px" onclick="removeCompanion('${c.id}')">×</button>
        </div>
        ${!paid ? `<div style="display:flex;gap:4px;margin-top:5px">
          <button class="btn-sm p" style="font-size:11px" onclick="staffCompPay('${c.id}','credito')">💳</button>
          <button class="btn-sm" style="font-size:11px" onclick="staffCompPay('${c.id}','contanti')">💵</button>
          <button class="btn-sm" style="font-size:11px" onclick="staffCompPay('${c.id}','sumup')">📱</button>
        </div>` : ''}
      </div>`;
    }).join('');
  }
  // Footer pagamento (user mode)
  const footerEl = document.getElementById('comp-pay-footer');
  if (mode === 'user' && _compEventPrice > 0) {
    footerEl.style.display = '';
    _updateCompTotal();
  } else {
    footerEl.style.display = 'none';
  }
}
function _updateCompTotal() {
  let count = 0;
  if (document.getElementById('chk-self')?.checked) count++;
  _compCache.filter(c => !c.payment_status || c.payment_status === 'da_saldare')
    .forEach(c => { if (document.getElementById('chk-c-' + c.id)?.checked) count++; });
  const footerEl = document.getElementById('comp-pay-footer');
  if (!footerEl) return;
  footerEl.innerHTML = count > 0
    ? `<div style="font-size:13px;margin-bottom:8px">💰 ${count} ${count===1?'persona':'persone'} × ${eur(_compEventPrice)} = <strong>${eur(count * _compEventPrice)}</strong></div>
       <button class="btn btn-p w100" onclick="userPaySelected()">💳 Paga col credito</button>
       <div style="font-size:11px;color:var(--mut);text-align:center;margin-top:6px">oppure paga in cassa o SumUp</div>`
    : `<div style="font-size:12px;color:var(--mut);text-align:center;padding:4px 0">Seleziona chi vuoi pagare</div>
       <div style="font-size:11px;color:var(--mut);text-align:center;margin-top:4px">oppure paga in cassa o SumUp</div>`;
}
function openCompanionsModal(regId) {
  _compMode = 'user'; _compRegId = regId;
  const reg = Object.values(_myEventRegs).find(r => r.registration_id === regId) || {};
  _compCache = (reg.companions || []).map(c => ({...c}));
  _compEventPrice = reg.event_price || 0;
  _compSelfStatus = reg.payment_status || 'da_saldare';
  _compEventTitle = reg.event_title || '';
  document.getElementById('comp-reg-id').value = regId;
  document.getElementById('comp-mode').value = 'user';
  document.getElementById('comp-event-id').value = '';
  document.getElementById('comp-ctx').value = '';
  document.getElementById('comp-subtitle').textContent = _compEventTitle ? `📅 ${_compEventTitle}` : 'Persone che vengono con te';
  document.getElementById('comp-add-section').style.display = '';
  document.getElementById('comp-nome').value = '';
  document.getElementById('comp-cognome').value = '';
  _renderCompModal('user');
  document.getElementById('comp-bg').style.display = 'flex';
}
function staffManageCompanions(regId, eventId, context) {
  _compMode = 'staff'; _compRegId = regId; _compEventId = eventId; _compCtx = context;
  _compCache = ((window._guestCompMap || {})[regId] || []).map(c => ({...c}));
  document.getElementById('comp-reg-id').value = regId;
  document.getElementById('comp-mode').value = 'staff';
  document.getElementById('comp-event-id').value = eventId;
  document.getElementById('comp-ctx').value = context;
  document.getElementById('comp-subtitle').textContent = 'Gestisci accompagnatori del socio';
  document.getElementById('comp-add-section').style.display = '';
  document.getElementById('comp-nome').value = '';
  document.getElementById('comp-cognome').value = '';
  _renderCompModal('staff');
  document.getElementById('comp-bg').style.display = 'flex';
}
function closeCompanionsModal() { document.getElementById('comp-bg').style.display = 'none'; }
async function addCompanion() {
  const nome    = document.getElementById('comp-nome').value.trim();
  const cognome = document.getElementById('comp-cognome').value.trim();
  if (!nome || !cognome) return toast('Inserisci nome e cognome');
  const mode  = _compMode;
  const regId = _compRegId;
  if (mode === 'staff') {
    const {data, error} = await db.rpc('staff_add_companions', {p_operator_id: currentUser.id, p_registration_id: regId, p_companions: [{nome, cognome}]});
    if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
    _compCache = Array.isArray(data.companions) ? data.companions : [];
    _renderCompModal('staff');
    document.getElementById('comp-nome').value = '';
    document.getElementById('comp-cognome').value = '';
    toast('Accompagnatore aggiunto!', 'ok');
    if (_compEventId) {
      if (_compCtx === 'admin') await _reloadAdminEventGuests(_compEventId);
      else await _reloadStaffEventGuests(_compEventId);
    }
  } else {
    const {data, error} = await db.rpc('user_add_companions', {p_user_id: currentUser.id, p_registration_id: regId, p_companions: [{nome, cognome}]});
    if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
    _compCache = Array.isArray(data.companions) ? data.companions : [];
    _renderCompModal('user');
    document.getElementById('comp-nome').value = '';
    document.getElementById('comp-cognome').value = '';
    toast('Accompagnatore aggiunto!', 'ok');
    await refreshUser();
    if (_eventsCache.length) renderEvents(_eventsCache);
  }
}
async function removeCompanion(compId) {
  const mode  = _compMode;
  const regId = _compRegId;
  if (mode === 'staff') {
    const {data, error} = await db.rpc('staff_remove_companion', {p_operator_id: currentUser.id, p_companion_id: compId});
    if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
    _compCache = Array.isArray(data.companions) ? data.companions : [];
    _renderCompModal('staff');
    toast('Rimosso', 'ok');
    if (_compEventId) {
      if (_compCtx === 'admin') await _reloadAdminEventGuests(_compEventId);
      else await _reloadStaffEventGuests(_compEventId);
    }
  } else {
    const {data, error} = await db.rpc('user_remove_companion', {p_user_id: currentUser.id, p_companion_id: compId});
    if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
    _compCache = Array.isArray(data.companions) ? data.companions : [];
    _renderCompModal('user');
    toast('Rimosso', 'ok');
    await refreshUser();
    if (_eventsCache.length) renderEvents(_eventsCache);
  }
}
async function userPaySelected() {
  const self_selected = document.getElementById('chk-self')?.checked || false;
  const companion_ids = _compCache
    .filter(c => (!c.payment_status || c.payment_status === 'da_saldare') && document.getElementById('chk-c-' + c.id)?.checked)
    .map(c => c.id);
  if (!self_selected && !companion_ids.length) return toast('Seleziona almeno una persona');
  const {data, error} = await db.rpc('user_pay_event_people', {
    p_user_id: currentUser.id,
    p_registration_id: _compRegId,
    p_targets: {self: self_selected, companion_ids}
  });
  if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore pagamento');
  toast('✅ Pagamento effettuato!', 'ok');
  await refreshUser();
  if (_eventsCache.length) renderEvents(_eventsCache);
  const reg = Object.values(_myEventRegs).find(r => r.registration_id === _compRegId) || {};
  _compCache = (reg.companions || []).map(c => ({...c}));
  _compSelfStatus = reg.payment_status || 'da_saldare';
  _renderCompModal('user');
}
async function staffCompPay(compId, method) {
  const {data, error} = await db.rpc('staff_pay_event_people', {
    p_operator_id: currentUser.id,
    p_registration_id: _compRegId,
    p_targets: {self: false, companion_ids: [compId]},
    p_method: method
  });
  if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
  toast('✅ Pagato!', 'ok');
  if (Array.isArray(data.companions)) _compCache = data.companions;
  else _compCache = _compCache.map(c => c.id===compId ? {...c, payment_status:'saldato_'+method} : c);
  _renderCompModal('staff');
  if (_compEventId) {
    if (_compCtx === 'admin') await _reloadAdminEventGuests(_compEventId);
    else await _reloadStaffEventGuests(_compEventId);
  }
}
async function payCompanionFromList(compId, method, name, regId, eventId, context) {
  const label = {credito:'credito',contanti:'contanti',sumup:'SumUp'}[method]||method;
  modalConfirm(`Salda quota di ${name} — ${label}?`, async () => {
    const {data, error} = await db.rpc('staff_pay_event_people', {
      p_operator_id: currentUser.id,
      p_registration_id: regId,
      p_targets: {self: false, companion_ids: [compId]},
      p_method: method
    });
    if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
    toast('✅ Pagato!', 'ok');
    if (context === 'admin') await _reloadAdminEventGuests(eventId);
    else await _reloadStaffEventGuests(eventId);
  });
}
async function checkinCompanion(compId, eventId, context, btn) {
  const {data, error} = await db.rpc('staff_checkin_companion', {p_operator_id: currentUser.id, p_companion_id: compId});
  if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
  const sp = document.createElement('span');
  sp.textContent = '✅'; sp.style.cssText = 'color:var(--grn);font-weight:700';
  btn.replaceWith(sp);
  if (context === 'admin') loadEvDash(eventId);
  else loadStaffEvDash(eventId);
}
async function loadUserGadgetReservations() {
  const {data, error} = await db.rpc('user_list_gadget_reservations', {p_user_id: currentUser.id});
  const el = document.getElementById('ut-gad-reservations');
  if (!el) return;
  const list = Array.isArray(data) ? data : [];
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-lbl" style="margin-top:14px">Le mie prenotazioni</div>` +
    list.map(r => `
      <div class="card" style="margin-bottom:8px;padding:12px;display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="font-weight:600">${_esc(r.gadget_name)}</div>
          <div style="font-size:12px;color:var(--mut)">Qtà ${r.quantity} · ${eur(r.total_price)} · ${fdt(r.created_at).split(' ')[0]}</div>
        </div>
        <span style="font-size:11px;padding:3px 8px;border-radius:12px;background:${r.status==='prenotato'?'rgba(255,214,10,.15)':'rgba(34,197,94,.15)'};color:${r.status==='prenotato'?'var(--gold)':'var(--grn)'}">
          ${r.status==='prenotato'?'⏳ Prenotato':'✅ Consegnato'}
        </span>
        ${r.status==='prenotato'?`<button class="btn-sm" style="color:var(--neg)" onclick="cancelGadgetReservation('${r.reservation_id}')">Annulla</button>`:''}
      </div>`).join('');
}
async function cancelGadgetReservation(reservationId) {
  modalConfirm('Annullare questa prenotazione?', async () => {
    const {data, error} = await db.rpc('user_cancel_gadget_reservation', {p_user_id: currentUser.id, p_reservation_id: reservationId});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast('Prenotazione annullata', 'ok');
    loadUserGadgetReservations();
  });
}
function renderPromos(prs) {
  const el = document.getElementById('ut-promo');
  if (!prs.length) { el.innerHTML='<div class="empty">Nessuna promo attiva</div>'; return; }
  el.innerHTML = prs.map(p=>`
    <div class="promo-row">
      ${p.image_url?`<img src="${p.image_url}" style="width:100%;border-radius:12px;margin-bottom:12px;max-height:200px;object-fit:cover" alt="${_esc(p.code)}">`:''}
      <div class="promo-code">${p.code}</div>
      <div class="promo-desc">${p.description||''}</div>
      <div class="promo-detail">${p.discount_type==='percent'?p.discount_value+'%':eur(p.discount_value)} di sconto${p.valid_until?' · fino al '+fdt(p.valid_until).split(' ')[0]:''}</div>
    </div>`).join('');
}
function renderSumUp(links) {
  document.getElementById('u-sumup').innerHTML = links.map(l=>`<a href="${l.url}" target="_blank" rel="noopener" class="sumup-btn">${l.label}</a>`).join('');
}
async function buyGadget(id, name, price) {
  const promo = _calcPromo(price);
  const promoLine = promo
    ? `\n\n⚡ Promo [${promo.code}] attiva: -${eur(promo.discount)}\n${eur(price)} → ${eur(promo.charged)} (sconto ${eur(promo.discount)})`
    : '';
  modalConfirm(`Acquistare "${name}" per ${eur(price)}?${promoLine}`, async () => {
    const {data, error} = await db.rpc('user_buy_gadget', {p_user_id:currentUser.id, p_gadget_id:id});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    if (data.promo_code) {
      toast(`Acquisto ok! Prezzo: ${eur(data.original_price)} — Sconto ${data.promo_code}: -${eur(data.discount)} — Pagato: ${eur(data.charged)}. Saldo: ${eur(data.new_balance)}`, 'ok');
    } else {
      toast(`Acquisto ok! Nuovo saldo: ${eur(data.new_balance)}`, 'ok');
    }
    await refreshUser(); await loadCatalog();
  });
}
function renderPendingEvents(evs) {
  const el = document.getElementById('u-pending-events');
  if (!evs || !evs.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-title" style="margin-bottom:8px">Da saldare</div>` +
    evs.map(e => `
    <div class="card ev-card-pending" style="margin-bottom:8px">
      <div class="ev-status ev-pending">⏳ Da saldare · <strong>${eur(e.amount)}</strong></div>
      <div style="font-weight:700;margin:8px 0 2px">${_esc(e.evento)}</div>
      <div style="font-size:12px;color:var(--mut);margin-bottom:12px">${e.event_date?fdt(e.event_date):'—'}</div>
      <div class="ev-pay-grid">
        <button class="btn btn-p" onclick="userPayEventCredit('${e.registration_id}','${e.evento.replace(/'/g,"\\'")}',${e.amount})">💳 Credito</button>
        ${e.sumup_link
          ?`<a href="${e.sumup_link}" target="_blank" rel="noopener" class="btn btn-g">📱 SumUp</a>`
          :`<button class="btn btn-g" onclick="toast('Paga con SumUp in cassa: lo staff registrerà il pagamento.','ok')">📱 SumUp</button>`}
        <button class="btn btn-q" onclick="toast('Recati in cassa con il tuo QR per saldare','ok')">🏠 In cassa</button>
      </div>
    </div>`).join('');
}
async function userPayEventCredit(regId, eventName, amount) {
  modalConfirm(`Pagare "${eventName}" (${eur(amount)}) con il tuo credito?`, async () => {
    const {data, error} = await db.rpc('user_pay_event_credit', {p_user_id: currentUser.id, p_registration_id: regId});
    if (error || !data.ok) {
      const msg = (error && error.message) || data.error || 'Errore';
      if (msg === 'Saldo insufficiente') {
        modalInfo(`Saldo insufficiente\n\nSaldo attuale: ${eur(data.balance||0)}\nRichiesto: ${eur(data.required||amount)}\n\nRicarica la tessera oppure scegli SumUp o pagamento in cassa.`);
      } else { toast(msg); }
      return;
    }
    toast(`Pagato! Nuovo saldo: ${eur(data.new_balance)}`, 'ok');
    await refreshUser();
    await loadCatalog();
  });
}
async function registerEvent(id, title, price) {
  const isFree = !price || price == 0;
  const msg = isFree
    ? `Iscriviti gratuitamente a "${title}"?`
    : `Iscriviti a "${title}"?\n\nImporto da saldare: ${eur(price)}\nPotrai pagare con credito, SumUp o in cassa.`;
  modalConfirm(msg, async () => {
    const {data, error} = await db.rpc('user_register_event', {p_user_id:currentUser.id, p_event_id:id});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(isFree ? `Iscritto a "${data.event}"!` : `Iscritto! Importo da saldare: ${eur(data.amount)}`, 'ok');
    await refreshUser();
    await loadCatalog();
  });
}

// ── ADMIN QR SCANNER ─────────────────────────────────────────────────
let _adminScanner = null;
function toggleAdminScanner() {
  const wrap = document.getElementById('a-scanner-wrap');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    _adminScanner = new Html5Qrcode('a-scanner-reader');
    _adminScanner.start(
      {facingMode: 'environment'},
      {fps: 10, qrbox: {width: 240, height: 240}},
      text => { stopAdminScanner(); document.getElementById('a-lookup').value = text.toUpperCase(); adminLookup(); },
      () => {}
    ).catch(() => { toast('Fotocamera non disponibile'); stopAdminScanner(); });
  } else { stopAdminScanner(); }
}
function stopAdminScanner() {
  document.getElementById('a-scanner-wrap').style.display = 'none';
  if (_adminScanner) { _adminScanner.stop().catch(()=>{}).finally(() => { _adminScanner.clear(); _adminScanner = null; }); }
}
async function adminLookup() {
  const raw = document.getElementById('a-lookup').value.trim();
  if (!raw) return toast('Inserisci codice tessera o nome');
  try {
    const cassaTabBtn = document.querySelector('#atabs .tab[data-p="at-cassa"]');
    if (cassaTabBtn) switchTab(cassaTabBtn, 'atabs');
    const acLookup = document.getElementById('ac-lookup');
    if (acLookup) acLookup.value = raw;
    document.getElementById('a-lookup-result').style.display = 'none';
    await adminCassaLookup();
    const target = document.getElementById('ac-result').style.display !== 'none'
      ? document.getElementById('ac-result')
      : document.getElementById('ac-sr');
    if (target) target.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (e) {
    console.error('adminLookup', e);
    toast('Errore lookup: ' + (e.message||e));
  }
}

// ── STAFF AREA ────────────────────────────────────────────────────────
let _scanner = null;
function toggleScanner() {
  const wrap = document.getElementById('s-scanner-wrap');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    _scanner = new Html5Qrcode('s-scanner-reader');
    _scanner.start(
      {facingMode: 'environment'},
      {fps: 10, qrbox: {width: 240, height: 240}},
      text => {
        stopScanner();
        document.getElementById('s-lookup').value = text.toUpperCase();
        staffLookup();
      },
      () => {}
    ).catch(() => { toast('Fotocamera non disponibile'); stopScanner(); });
  } else {
    stopScanner();
  }
}
function stopScanner() {
  const wrap = document.getElementById('s-scanner-wrap');
  wrap.style.display = 'none';
  if (_scanner) {
    _scanner.stop().catch(()=>{}).finally(() => { _scanner.clear(); _scanner = null; });
  }
}
function gotoStaff() {
  document.getElementById('s-name').textContent = currentUser.display_name;
  showScreen('screen-staff');
  const backToggle = document.getElementById('s-socio-toggle');
  if (backToggle) backToggle.style.display = currentUser.is_staff ? '' : 'none';
  renderStaffHist();
}
function switchToStaffMode() {
  if (!currentUser || !currentUser.is_staff) return;
  sessionStorage.setItem('sh_r', 'staff');
  gotoStaff();
}
function switchToSocioMode() {
  if (!currentUser) return;
  sessionStorage.setItem('sh_r', 'user');
  gotoUser();
  setTimeout(checkUnseenEvents, 400);
}
// ── RICERCA SOCI: card_id + nome/cognome ─────────────────────────────
function _normalizeCardInput(q) {
  const u = (q||'').trim().toUpperCase();
  let m;
  if ((m = u.match(/^SH-?(\d+)$/))) return 'SH-' + m[1].padStart(3, '0');
  if (/^\d+$/.test(u))              return 'SH-' + u.padStart(3, '0');
  return null;
}
async function _searchUsersByName(q) {
  const needle = (q||'').trim().toLowerCase();
  if (!needle) return [];
  const {data} = await db.rpc('admin_list_users');
  if (!data) return [];
  return data
    .filter(u => u.role === 'user' && u.active !== false && (u.display_name||'').toLowerCase().includes(needle))
    .sort((a,b) => (a.display_name||'').localeCompare(b.display_name||''));
}
function _renderCassaSearch(prefix, matches) {
  const id = prefix + '-sr';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'search-results';
    const inp = document.getElementById(prefix + '-lookup');
    const card = inp.closest('.card');
    card.parentNode.insertBefore(el, card.nextSibling);
  }
  if (!matches.length) {
    el.innerHTML = '<div class="empty" style="padding:14px;text-align:center">Nessun socio trovato</div>';
  } else {
    el.innerHTML = matches.map(u => `
      <div class="search-result-item" onclick="pickSearchResult('${u.card_id}','${prefix}')">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">${_esc(u.display_name)}</div>
          <div style="font-size:11px;color:var(--mut);font-family:monospace">${u.card_id}</div>
        </div>
        <div style="font-size:13px;color:var(--gold);font-weight:600">${eur(u.balance||0)}</div>
      </div>`).join('');
  }
  el.style.display = 'block';
  const result = document.getElementById(prefix + '-result');
  if (result) result.style.display = 'none';
}
function _hideCassaSearch(prefix) {
  const el = document.getElementById(prefix + '-sr');
  if (el) el.style.display = 'none';
}
function pickSearchResult(cardId, prefix) {
  const inp = document.getElementById(prefix + '-lookup');
  if (inp) inp.value = cardId;
  _hideCassaSearch(prefix);
  if (prefix === 's')  return staffLookup();
  if (prefix === 'ac') return adminCassaLookup();
}
async function staffLookup() {
  const raw = document.getElementById('s-lookup').value;
  const cardId = _normalizeCardInput(raw);
  if (!cardId) {
    const q = (raw||'').trim();
    if (!q) return toast('Inserisci codice tessera o nome');
    const matches = await _searchUsersByName(q);
    if (matches.length === 1) {
      document.getElementById('s-lookup').value = matches[0].card_id;
      _hideCassaSearch('s');
      return staffLookup();
    }
    _renderCassaSearch('s', matches);
    return;
  }
  document.getElementById('s-lookup').value = cardId;
  _hideCassaSearch('s');
  const {data, error} = await db.rpc('staff_lookup', {p_card_id: cardId});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  const u = data.user || data;
  staffTarget = u;
  document.getElementById('s-res-name').textContent = u.display_name;
  document.getElementById('s-res-card').textContent = u.card_id;
  document.getElementById('s-res-bal').textContent  = eur(u.balance);
  document.getElementById('s-result').style.display = 'block';
  _renderEventRegs('s', data.event_registrations || u.event_registrations || []);
  if (Array.isArray(data.transactions) && data.transactions.length) {
    _staffTxAll = data.transactions;
    _staffTxTipo = 'all'; _staffTxDays = 0;
    const wrap = document.getElementById('s-tx-wrap');
    wrap.querySelectorAll('.fbtn').forEach(b => b.classList.toggle('active', b.dataset.mf==='all'||b.dataset.mf==='0'));
    wrap.style.display = 'block';
    _renderStaffTx();
  } else {
    loadStaffUserTx(u.card_id);
  }
  await Promise.all([
    loadStaffPendingEvents(u.card_id),
    loadStaffCheckin(u.card_id)
  ]);
  loadStaffGadgetReservationsForUser(u.id);
  loadStaffRegisterEventDropdown(u.card_id);
}
async function loadStaffUserTx(cardId) {
  const wrap = document.getElementById('s-tx-wrap');
  const {data, error} = await db.rpc('staff_get_user_transactions', {p_operator_id: currentUser.id, p_card_id: cardId});
  if (error || !data || !data.ok || !data.transactions.length) { wrap.style.display='none'; return; }
  _staffTxAll = data.transactions;
  _staffTxTipo = 'all'; _staffTxDays = 0;
  // reset filter buttons
  wrap.querySelectorAll('.fbtn').forEach(b => b.classList.toggle('active', b.dataset.mf==='all'||b.dataset.mf==='0'));
  wrap.style.display = 'block';
  _renderStaffTx();
}
function setStaffTxFilter(btn, group) {
  btn.closest('div').querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (group === 'tipo') _staffTxTipo = btn.dataset.mf;
  else _staffTxDays = parseInt(btn.dataset.mf);
  _renderStaffTx();
}
function _renderStaffTx() {
  const now = Date.now();
  const list = _staffTxAll.filter(t => {
    const tipoOk = _staffTxTipo === 'all' || t.type === _staffTxTipo;
    const dateOk = _staffTxDays === 0 || (now - new Date(t.created_at).getTime()) < _staffTxDays * 86400000;
    return tipoOk && dateOk;
  });
  const el = document.getElementById('s-tx-list');
  if (!list.length) { el.innerHTML='<div class="empty">Nessuna transazione</div>'; return; }
  el.innerHTML = list.map(t => _txRowHtml(t)).join('');
}
function _txIconHtml(t) {
  const type = t.type || '';
  if (type === 'recharge') return '<span style="color:var(--grn);font-weight:700">↑</span>';
  if (type === 'refund')   return '<span style="color:var(--gold);font-weight:700">↩</span>';
  if (type === 'purchase' || type === 'event_fee') return '<span style="color:var(--neg);font-weight:700">↓</span>';
  return '<span>•</span>';
}
function _txMetaHtml(t, operatorLabel) {
  const parts = [fdt(t.created_at)];
  if (t.category)       parts.push(_capitalize(t.category));
  if (t.type === 'recharge' && t.payment_method) parts.push(_capitalize(t.payment_method));
  const main = parts.join(' · ');
  const op = t.operator_name ? `${operatorLabel || 'Op'}: ${_esc(t.operator_name)}` : (operatorLabel === 'Operatore' ? 'Operatore: Sistema' : '');
  return `<div class="tx-dt">${main}</div>${op ? `<div class="tx-dt" style="opacity:.7">${op}</div>` : ''}`;
}
function _txRowHtml(t) {
  const balAfter = (t.balance_after != null) ? ` · Saldo dopo: ${eur(t.balance_after)}` : '';
  return `<div class="tx-row">
      <span class="tx-ic">${_txIconHtml(t)}</span>
      <div class="tx-inf">
        <div class="tx-dsc">${_esc(t.description||t.type)}</div>
        ${_txMetaHtml(t, 'Op')}
        ${balAfter ? `<div class="tx-dt" style="opacity:.7">${balAfter.replace(/^ · /,'')}</div>` : ''}
      </div>
      <div class="tx-amt ${t.amount>=0?'pos':'neg-c'}">${t.amount>=0?'+':''}${eur(t.amount)}</div>
    </div>`;
}
function _capitalize(s) { s = String(s||''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function _renderEventRegs(prefix, regs) {
  const wrap = document.getElementById(prefix + '-eventregs-wrap');
  const list = document.getElementById(prefix + '-eventregs-list');
  if (!wrap || !list) return;
  if (!Array.isArray(regs) || !regs.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const paidBadge = (s) => {
    const map = {paid:'✅ Pagato', pending:'⏳ Da saldare', refunded:'↩️ Rimborsato', free:'🎁 Gratuito'};
    return `<span class="badge ${s==='paid'?'bg':s==='pending'?'by':'br'}" style="font-size:10px">${map[s]||s||'—'}</span>`;
  };
  const checkinBadge = (b) => b ? '<span class="badge bg" style="font-size:10px">✓ Check-in</span>' : '';
  list.innerHTML = regs.map(r => {
    const comps = Array.isArray(r.companions) ? r.companions : [];
    const size = r.party_size || (1 + comps.length);
    const groupLine = size > 1
      ? `<div style="font-size:12px;color:var(--mut);margin-top:4px">👥 Gruppo di ${size}</div>`
      : `<div style="font-size:12px;color:var(--mut);margin-top:4px">Singolo</div>`;
    const compsList = comps.length ? `
      <div style="margin-top:8px;padding-left:12px;border-left:2px solid var(--brd)">
        ${comps.map(c => `<div style="font-size:12px;display:flex;gap:6px;align-items:center;margin-bottom:2px">
          <span>${_esc(c.nome||'')} ${_esc(c.cognome||'')}</span>
          ${paidBadge(c.payment_status)}${checkinBadge(c.checked_in)}
        </div>`).join('')}
      </div>` : '';
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-weight:700;flex:1">${_esc(r.event_title || r.title || 'Evento')}</div>
        ${paidBadge(r.payment_status)}${checkinBadge(r.checked_in)}
      </div>
      <div style="font-size:12px;color:var(--mut);margin-top:2px">${r.event_date?fdt(r.event_date):''}</div>
      ${groupLine}
      ${compsList}
    </div>`;
  }).join('');
}
async function loadStaffPendingEvents(cardId) {
  const {data, error} = await db.rpc('staff_list_pending_events', {p_card_id: cardId});
  const wrap = document.getElementById('s-pending-wrap');
  const list = document.getElementById('s-pending-list');
  if (error || !data || !data.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = data.map(r => `
    <div class="card" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
        <span style="font-weight:700;flex:1">${_esc(r.evento)}</span>
        ${r.total_registrations!=null?`<span style="font-size:11px;color:var(--mut)">👥 ${r.total_registrations} iscritti</span>`:''}
      </div>
      <div style="font-size:12px;color:var(--mut);margin-bottom:10px">${r.event_date ? fdt(r.event_date) : '—'} · <strong style="color:var(--gold)">${eur(r.amount)}</strong></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-p" style="flex:1;min-width:100px" onclick="staffPayEvent('${r.registration_id}','credito','${r.evento.replace(/'/g,"\\'")}',${r.amount})">💳 Credito</button>
        ${r.sumup_link?`<a href="${r.sumup_link}" target="_blank" rel="noopener" class="btn btn-g" style="flex:1;min-width:100px;text-decoration:none;display:flex;align-items:center;justify-content:center">📱 SumUp</a>`:
          `<button class="btn btn-g" style="flex:1;min-width:100px" onclick="staffPayEvent('${r.registration_id}','sumup','${r.evento.replace(/'/g,"\\'")}',${r.amount})">📱 SumUp</button>`}
        <button class="btn btn-q" style="flex:1;min-width:100px" onclick="staffPayEvent('${r.registration_id}','contanti','${r.evento.replace(/'/g,"\\'")}',${r.amount})">💵 Contanti</button>
      </div>
    </div>`).join('');
}
async function loadStaffGadgetReservationsForUser(userId) {
  const wrap = document.getElementById('s-gadget-res-wrap');
  if (!wrap) return;
  const {data, error} = await db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id});
  if (error) { wrap.style.display='none'; return; }
  const list = Array.isArray(data) ? data.filter(r => {
    const u = allAdminUsers.find(u => u.id === userId) || staffTarget;
    return u && r.card_id === (u.card_id || staffTarget?.card_id);
  }) : [];
  if (!list.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  document.getElementById('s-gadget-res-list').innerHTML = list.map(r => `
    <div class="card" style="margin-bottom:8px;padding:12px">
      <div style="font-weight:600">${_esc(r.gadget_name)} x${r.quantity}</div>
      <div style="font-size:12px;color:var(--mut)">${eur(r.total_price)} · Prenotato ${fdt(r.created_at).split(' ')[0]}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-p" style="flex:1;min-width:80px" onclick="staffFulfillGadget('${r.reservation_id}','credito','${_esc(r.gadget_name)}',${r.total_price})">💳 Credito</button>
        <button class="btn btn-q" style="flex:1;min-width:80px" onclick="staffFulfillGadget('${r.reservation_id}','contanti','${_esc(r.gadget_name)}',${r.total_price})">💵 Contanti</button>
        <button class="btn btn-g" style="flex:1;min-width:80px" onclick="staffFulfillGadget('${r.reservation_id}','sumup','${_esc(r.gadget_name)}',${r.total_price})">📱 SumUp</button>
      </div>
    </div>`).join('');
}
async function staffFulfillGadget(resId, method, name, total) {
  const label = {credito:'💳 Credito',contanti:'💵 Contanti',sumup:'📱 SumUp'}[method]||method;
  let previewLine = '';
  if (method === 'credito' && staffTarget) {
    const {data: pv} = await db.rpc('staff_preview_charge', {p_operator_id: currentUser.id, p_card_id: staffTarget.card_id, p_amount: total});
    if (pv && pv.promo_code) previewLine = `\n\n⚡ Promo [${pv.promo_code}]: -${eur(pv.promo_discount)}\nTotale → ${eur(pv.final_amount)}`;
  }
  modalConfirm(`Consegnare "${name}" e incassare (${label})?${previewLine}`, async () => {
    const {data, error} = await db.rpc('staff_fulfill_gadget_reservation', {p_operator_id: currentUser.id, p_reservation_id: resId, p_payment_method: method});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    const msg = data.promo_code
      ? `✅ Consegnato! Promo ${data.promo_code}: -${eur(data.discount)} → Addebitato ${eur(data.charged)}`
      : `✅ Consegnato! ${eur(data.amount)} (${label})`;
    toast(msg, 'ok');
    if (staffTarget) { const {data: r} = await db.rpc('staff_lookup', {p_card_id: staffTarget.card_id}); if (r?.ok) { const nu = r.user || r; staffTarget = nu; document.getElementById('s-res-bal').textContent = eur(nu.balance); } }
    loadStaffGadgetReservationsForUser(staffTarget?.id);
  });
}
async function loadStaffRegisterEventDropdown(cardId) {
  const wrap = document.getElementById('s-reg-event-wrap');
  if (!wrap) return;
  const {data, error} = await db.rpc('admin_list_events');
  if (error || !data || !data.length) { wrap.style.display='none'; return; }
  // Filtra eventi attivi a cui il socio non è già iscritto
  const {data: pend} = await db.rpc('staff_list_pending_events', {p_card_id: cardId});
  const {data: chk}  = await db.rpc('staff_list_active_registrations', {p_operator_id: currentUser.id, p_card_id: cardId});
  const registeredIds = new Set([
    ...((pend||[]).map(r => r.event_id)),
    ...((chk?.registrations||[]).map(r => r.event_id))
  ]);
  const available = data.filter(e => e.active && !registeredIds.has(e.id));
  const sel = document.getElementById('s-event-select');
  sel.innerHTML = '<option value="">Scegli evento…</option>' +
    available.map(e => `<option value="${e.id}">${_esc(e.title)} — ${eur(e.price)}</option>`).join('');
  wrap.style.display = available.length ? 'block' : 'none';
}
async function staffRegisterUserEvent() {
  if (!staffTarget) return toast('Cerca prima una tessera');
  const eventId = document.getElementById('s-event-select').value;
  if (!eventId) return toast('Seleziona un evento');
  const evName = document.getElementById('s-event-select').selectedOptions[0]?.text || '';
  modalConfirm(`Iscrivere ${staffTarget.display_name} a:\n\n"${evName}"?`, async () => {
    const {data, error} = await db.rpc('staff_register_user_event', {p_operator_id: currentUser.id, p_card_id: staffTarget.card_id, p_event_id: eventId});
    if (error || !data.ok) return toast((error&&error.message)||data.error);
    const msg = data.already_registered ? 'Socio già iscritto' : `✅ Iscritto a "${data.event_title}" — ${eur(data.amount)} da saldare`;
    toast(msg, 'ok');
    await loadStaffPendingEvents(staffTarget.card_id);
    loadStaffRegisterEventDropdown(staffTarget.card_id);
  });
}
async function loadStaffCheckin(cardId) {
  const wrap = document.getElementById('s-checkin-wrap');
  const list = document.getElementById('s-checkin-list');
  const {data, error} = await db.rpc('staff_list_active_registrations', {p_operator_id: currentUser.id, p_card_id: cardId});
  if (error || !data || !data.ok || !data.registrations.length) { wrap.style.display='none'; return; }
  const pending = data.registrations.filter(r => !r.checked_in);
  if (!pending.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = pending.map(r => `
    <div class="card" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-weight:700;font-size:14px">${_esc(r.evento)}</div>
        <div style="font-size:11px;color:var(--mut)">${r.event_date?fdt(r.event_date):'—'} · ${r.payment_status}</div>
      </div>
      <button class="btn btn-g" style="flex-shrink:0" onclick="staffCheckin('${r.registration_id}','${r.evento.replace(/'/g,"\\'")}',this)">✅ Check-in</button>
    </div>`).join('');
}
async function staffCheckin(regId, eventName, btn) {
  btn.disabled = true; btn.textContent = '⏳';
  const {data, error} = await db.rpc('staff_checkin_event', {p_operator_id: currentUser.id, p_registration_id: regId});
  if (error || !data.ok) { btn.disabled=false; btn.textContent='✅ Check-in'; return toast((error&&error.message)||data.error); }
  toast(data.already_in ? 'Già presente' : `✅ ${data.message}`, 'ok');
  btn.textContent = '✅ Fatto'; btn.style.opacity = '0.5';
  await loadStaffCheckin(staffTarget?.card_id);
}
async function staffPayEvent(regId, method, eventName, amount) {
  const label = {credito:'credito',sumup:'SumUp',contanti:'contanti'}[method];
  modalConfirm(`Salda "${eventName}" (${eur(amount)}) con ${label}?`, async () => {
    const {data, error} = await db.rpc('staff_pay_event', {
      p_operator_id: currentUser.id,
      p_registration_id: regId,
      p_method: method
    });
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(`✓ ${data.message}`, 'ok');
    document.getElementById('s-res-bal').textContent = eur(data.new_balance);
    if (staffTarget) staffTarget.balance = data.new_balance;
    await loadStaffPendingEvents(staffTarget.card_id);
    addSOp({type:'event', card:staffTarget.card_id, name:staffTarget.display_name, amount:-amount, nb:data.new_balance, desc:`Evento: ${eventName} (${label})`});
  });
}
async function staffRecharge(amount) {
  if (!staffTarget) return toast('Cerca prima una tessera');
  const pmSel = document.getElementById('s-recharge-pm');
  const pm = (pmSel?.value || 'contanti').toLowerCase();
  const pmLabel = pmSel?.selectedOptions?.[0]?.text || _capitalize(pm);
  modalConfirm(`Ricaricare ${eur(amount)} a ${staffTarget.display_name}?\n\nMetodo: ${pmLabel}`, async () => {
    const {data, error} = await db.rpc('staff_recharge', {p_operator_id:currentUser.id, p_card_id:staffTarget.card_id, p_amount:amount, p_payment_method: pm});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(`Ricarica ok! ${eur(staffTarget.balance)} → ${eur(data.new_balance)}`, 'ok');
    document.getElementById('s-res-bal').textContent = eur(data.new_balance);
    staffTarget.balance = data.new_balance;
    addSOp({type:'recharge', card:staffTarget.card_id, name:staffTarget.display_name, amount, nb:data.new_balance});
  });
}
async function staffRechargeCustom() {
  const v = parseFloat(document.getElementById('s-custom').value);
  if (!v||v<=0) return toast('Importo non valido');
  await staffRecharge(v);
  document.getElementById('s-custom').value = '';
}
async function staffCharge() {
  if (!staffTarget) return toast('Cerca prima una tessera');
  const v    = parseFloat(document.getElementById('s-charge-amt').value);
  const cat  = (document.getElementById('s-charge-cat')?.value || 'consumazione').toLowerCase();
  const note = document.getElementById('s-charge-desc').value.trim();
  const catLabel = document.getElementById('s-charge-cat')?.selectedOptions?.[0]?.text || cat;
  const desc = note || catLabel;
  if (!v||v<=0) return toast('Importo non valido');
  const {data: pv} = await db.rpc('staff_preview_charge', {p_operator_id: currentUser.id, p_card_id: staffTarget.card_id, p_amount: v});
  const promoLine = (pv && pv.promo_code)
    ? `\n\n⚡ Promo [${pv.promo_code}] attiva: -${eur(pv.promo_discount)}\nImporto originale: ${eur(v)} → Addebito finale: ${eur(pv.final_amount)} (sconto ${eur(pv.promo_discount)})`
    : '';
  modalConfirm(`Addebitare ${eur(v)} a ${staffTarget.display_name}?\n\nCategoria: ${catLabel}${promoLine}`, async () => {
    const {data, error} = await db.rpc('staff_charge', {p_operator_id:currentUser.id, p_card_id:staffTarget.card_id, p_amount:v, p_description:desc, p_category:cat});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    if (data.promo_code) {
      toast(`Promo ${data.promo_code}! Originale: ${eur(data.original_amount)} → Sconto: -${eur(data.discount)} → Addebitato: ${eur(data.charged)}`, 'ok');
    } else {
      toast(`Addebito ok! ${eur(data.old_balance)} → ${eur(data.new_balance)}`, 'ok');
    }
    document.getElementById('s-res-bal').textContent = eur(data.new_balance);
    staffTarget.balance = data.new_balance;
    document.getElementById('s-charge-amt').value = '';
    document.getElementById('s-charge-desc').value = '';
    addSOp({type:'charge', card:staffTarget.card_id, name:staffTarget.display_name, amount:-v, nb:data.new_balance, desc});
  });
}
function addSOp(op) {
  op.ts = new Date().toISOString();
  staffOps.unshift(op); if(staffOps.length>10) staffOps.pop();
  localStorage.setItem('s_ops', JSON.stringify(staffOps));
  renderStaffHist();
}
function renderStaffHist() {
  const wrap = document.getElementById('s-hist-wrap');
  const list = document.getElementById('s-hist');
  if (!staffOps.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = staffOps.map(o=>`
    <div class="tx-row">
      <span class="tx-ic">${o.type==='recharge'?'🔄':'🛍️'}</span>
      <div class="tx-inf"><div class="tx-dsc">${o.name} (${o.card})${o.desc?' — '+o.desc:''}</div><div class="tx-dt">${fdt(o.ts)}</div></div>
      <div class="tx-amt ${o.amount>=0?'pos':'neg-c'}">${o.amount>=0?'+':''}${eur(o.amount)}</div>
    </div>`).join('');
}
function clearSession() {
  modalConfirm('Svuotare la lista operazioni sessione?', () => {
    staffOps = [];
    localStorage.removeItem('s_ops');
    renderStaffHist();
    toast('Operazioni sessione svuotate', 'ok');
  });
}

// ── STAFF EVENTI ─────────────────────────────────────────────────────
let _staffEventsCache = [];
async function loadStaffEvents() {
  const el = document.getElementById('sev-list');
  el.innerHTML = '<div class="empty">⏳ Carico eventi…</div>';
  const {data, error} = await db.rpc('admin_list_events');
  if (error || !data) { el.innerHTML='<div class="empty">Errore caricamento</div>'; return; }
  _staffEventsCache = data;
  if (!data.length) { el.innerHTML='<div class="empty">Nessun evento</div>'; return; }
  el.innerHTML = data.map(e => `
    <div class="card" style="margin-bottom:10px;opacity:${e.visible===false?0.55:1}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-weight:700;flex:1">${_esc(e.title)}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${e.visible===false?'rgba(239,68,68,.15)':'rgba(34,197,94,.15)'};color:${e.visible===false?'var(--neg)':'var(--grn)'}">
          ${e.visible===false?'👁‍🗨 Nascosto':'👁 Visibile'}
        </span>
      </div>
      <div style="font-size:12px;color:var(--mut);margin-bottom:6px">${e.event_date?fdt(e.event_date):'—'} · ${_esc(e.location||'—')} · ${e.price>0?eur(e.price):'Gratuito'}</div>
      ${e.slug&&e.public_registration?`<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <a href="?event=${e.slug}" target="_blank" rel="noopener" class="reg-link" style="font-size:11px">🔗 ?event=${_esc(e.slug)}</a>
        <button class="btn-sm" style="font-size:11px;padding:2px 8px" onclick="copyPublicLink('${_esc(e.slug)}')">📋 Copia link</button>
      </div>`:''}
      <div id="sev-dash-${e.id}" class="ev-mini-dash" style="margin-bottom:10px">
        <span style="font-size:11px;color:var(--mut)">⏳ carico…</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm" onclick="staffToggleVisibility('${e.id}',${e.visible!==false})">${e.visible===false?'🔓 Mostra':'🔒 Nascondi'}</button>
        <button class="btn-sm" onclick="toggleStaffEventGuests('${e.id}','${e.title.replace(/'/g,"\\'")}',this)">👥 Iscritti</button>
        <button class="btn-sm" onclick="exportEventCSV('${e.id}','${e.title.replace(/'/g,"\\'")}')">📥 CSV</button>
      </div>
      <div id="sev-guests-${e.id}" style="display:none;margin-top:10px"></div>
    </div>`).join('');
  await Promise.all(data.map(e => loadStaffEvDash(e.id)));
}
async function loadStaffEvDash(eventId) {
  const el = document.getElementById('sev-dash-' + eventId);
  if (!el) return;
  const {data, error} = await db.rpc('admin_event_dashboard', {p_event_id: eventId});
  if (error || !data || !data.ok) { el.innerHTML='<span style="font-size:11px;color:var(--mut)">—</span>'; return; }
  el.innerHTML = `
    <div class="ev-kpi"><span class="ev-kpi-n">${data.total_iscritti}</span><span class="ev-kpi-l">👥 Iscritti</span></div>
    <div class="ev-kpi"><span class="ev-kpi-n" style="color:var(--grn)">${data.total_paganti}</span><span class="ev-kpi-l">💰 Paganti</span></div>
    <div class="ev-kpi"><span class="ev-kpi-n" style="color:var(--gold)">${data.total_presenti}</span><span class="ev-kpi-l">✅ Presenti</span></div>`;
}
async function toggleStaffEventGuests(eventId, eventTitle, btn) {
  const el = document.getElementById('sev-guests-' + eventId);
  if (el.style.display !== 'none') { el.style.display='none'; btn.textContent='👥 Iscritti'; return; }
  el.style.display = 'block'; btn.textContent = '⏳ Carico…';
  const {data, error} = await db.rpc('admin_list_event_registrations', {p_event_id: eventId});
  btn.textContent = '👥 Nascondi';
  if (error) { el.innerHTML=`<div class="empty">${error.message}</div>`; return; }
  el.innerHTML = _buildGuestHtml(data, eventId, 'staff');
}
async function staffToggleVisibility(eventId, currentVisible) {
  const label = currentVisible ? 'nascondere' : 'rendere visibile';
  modalConfirm(`Vuoi ${label} questo evento nel catalogo?`, async () => {
    const {data, error} = await db.rpc('admin_toggle_event_visibility', {p_admin_id: currentUser.id, p_event_id: eventId});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(`Evento ${data.visible?'visibile':'nascosto'}`, 'ok');
    loadStaffEvents();
  });
}

async function loadStaffPromos() {
  const el = document.getElementById('st-promo-list');
  el.innerHTML = '<div class="empty">⏳ Carico promo…</div>';
  const {data, error} = await db.rpc('get_catalog');
  if (error || !data) { el.innerHTML='<div class="empty">Errore caricamento</div>'; return; }
  const prs = (data.promos||[]);
  if (!prs.length) { el.innerHTML='<div class="empty">Nessuna promo attiva</div>'; return; }
  el.innerHTML = prs.map(p => {
    const sconto = p.discount_type==='percent' ? p.discount_value+'%' : eur(p.discount_value);
    const fino   = p.valid_until ? fdt(p.valid_until).split(' ')[0] : '∞';
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="mono" style="font-weight:700;font-size:15px">${_esc(p.code)}</span>
        <span style="font-size:12px;color:var(--mut);flex:1">${_esc(p.description||'')}</span>
        <span style="font-size:13px;color:var(--gold);font-weight:700">${sconto}</span>
        <span style="font-size:11px;color:var(--mut)">fino ${fino}</span>
      </div>
    </div>`;
  }).join('');
}
async function deletePromoFromStaff(id, code) {
  modalConfirm(`Eliminare la promo [${code}]?`, async () => {
    const {data, error} = await db.rpc('admin_delete_promo', {p_admin_id: currentUser.id, p_promo_id: id});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast('Promo eliminata', 'ok');
    loadStaffPromos();
  });
}

// ── ADMIN CASSA ───────────────────────────────────────────────────────
let _acScanner = null;
function toggleAcScanner() {
  const wrap = document.getElementById('ac-scanner-wrap');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    _acScanner = new Html5Qrcode('ac-scanner-reader');
    _acScanner.start(
      {facingMode:'environment'}, {fps:10, qrbox:{width:240,height:240}},
      text => { stopAcScanner(); document.getElementById('ac-lookup').value=text.toUpperCase(); adminCassaLookup(); },
      ()=>{}
    ).catch(()=>{ toast('Fotocamera non disponibile'); stopAcScanner(); });
  } else { stopAcScanner(); }
}
function stopAcScanner() {
  document.getElementById('ac-scanner-wrap').style.display='none';
  if (_acScanner) { _acScanner.stop().catch(()=>{}).finally(()=>{ _acScanner.clear(); _acScanner=null; }); }
}
async function adminCassaLookup() {
  const raw = document.getElementById('ac-lookup').value;
  const cardId = _normalizeCardInput(raw);
  if (!cardId) {
    const q = (raw||'').trim();
    if (!q) return toast('Inserisci codice tessera o nome');
    const matches = await _searchUsersByName(q);
    if (matches.length === 1) {
      document.getElementById('ac-lookup').value = matches[0].card_id;
      _hideCassaSearch('ac');
      return adminCassaLookup();
    }
    _renderCassaSearch('ac', matches);
    return;
  }
  document.getElementById('ac-lookup').value = cardId;
  _hideCassaSearch('ac');
  const {data, error} = await db.rpc('staff_lookup', {p_card_id: cardId});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  const u = data.user || data;
  staffTarget = u;
  document.getElementById('ac-res-name').textContent = u.display_name;
  document.getElementById('ac-res-card').textContent = u.card_id;
  document.getElementById('ac-res-bal').textContent  = eur(u.balance);
  document.getElementById('ac-result').style.display = 'block';
  _renderEventRegs('ac', data.event_registrations || u.event_registrations || []);
  if (Array.isArray(data.transactions) && data.transactions.length) {
    const wrap = document.getElementById('ac-tx-wrap');
    const list = document.getElementById('ac-tx-list');
    wrap.style.display = 'block';
    list.innerHTML = data.transactions.map(t => _txRowHtml(t)).join('');
  } else {
    loadAcUserTx(u.card_id);
  }
  await Promise.all([
    loadAcPendingEvents(u.card_id),
    loadAcCheckin(u.card_id)
  ]);
  loadAcGadgetReservationsForUser(u.id);
  loadAcRegisterEventDropdown(u.card_id);
}
async function loadAcPendingEvents(cardId) {
  const wrap = document.getElementById('ac-pending-wrap');
  const list = document.getElementById('ac-pending-list');
  const {data, error} = await db.rpc('staff_list_pending_events', {p_card_id: cardId});
  if (error || !data || !data.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = data.map(r => `
    <div class="card ev-card-pending" style="margin-bottom:8px">
      <div class="ev-status ev-pending">⏳ Da saldare · <strong>${eur(r.amount)}</strong></div>
      <div style="font-weight:700;margin:6px 0 2px">${_esc(r.evento)}</div>
      <div style="font-size:12px;color:var(--mut);margin-bottom:10px">${r.event_date?fdt(r.event_date):'—'}</div>
      <div class="ev-pay-grid">
        <button class="btn btn-p" onclick="adminCassaPayEvent('${r.registration_id}','credito','${r.evento.replace(/'/g,"\\'")}',${r.amount})">💳 Credito</button>
        <button class="btn btn-g" onclick="adminCassaPayEvent('${r.registration_id}','sumup','${r.evento.replace(/'/g,"\\'")}',${r.amount})">📱 SumUp</button>
        <button class="btn btn-q" onclick="adminCassaPayEvent('${r.registration_id}','contanti','${r.evento.replace(/'/g,"\\'")}',${r.amount})">💵 Contanti</button>
      </div>
    </div>`).join('');
}
async function loadAcGadgetReservationsForUser(userId) {
  const wrap = document.getElementById('ac-gadget-res-wrap');
  if (!wrap) return;
  const {data, error} = await db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id});
  if (error) { wrap.style.display='none'; return; }
  const list = Array.isArray(data) ? data.filter(r => r.card_id === staffTarget?.card_id) : [];
  if (!list.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  document.getElementById('ac-gadget-res-list').innerHTML = list.map(r => `
    <div class="card" style="margin-bottom:8px;padding:12px">
      <div style="font-weight:600">${_esc(r.gadget_name)} x${r.quantity}</div>
      <div style="font-size:12px;color:var(--mut)">${eur(r.total_price)} · Prenotato ${fdt(r.created_at).split(' ')[0]}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-p" style="flex:1;min-width:80px" onclick="acFulfillGadget('${r.reservation_id}','credito','${_esc(r.gadget_name)}',${r.total_price})">💳 Credito</button>
        <button class="btn btn-q" style="flex:1;min-width:80px" onclick="acFulfillGadget('${r.reservation_id}','contanti','${_esc(r.gadget_name)}',${r.total_price})">💵 Contanti</button>
        <button class="btn btn-g" style="flex:1;min-width:80px" onclick="acFulfillGadget('${r.reservation_id}','sumup','${_esc(r.gadget_name)}',${r.total_price})">📱 SumUp</button>
      </div>
    </div>`).join('');
}
async function acFulfillGadget(resId, method, name, total) {
  const label = {credito:'💳 Credito',contanti:'💵 Contanti',sumup:'📱 SumUp'}[method]||method;
  let previewLine = '';
  if (method === 'credito' && staffTarget) {
    const {data: pv} = await db.rpc('staff_preview_charge', {p_operator_id: currentUser.id, p_card_id: staffTarget.card_id, p_amount: total});
    if (pv && pv.promo_code) previewLine = `\n\n⚡ Promo [${pv.promo_code}]: -${eur(pv.promo_discount)}\nTotale → ${eur(pv.final_amount)}`;
  }
  modalConfirm(`Consegnare "${name}" e incassare (${label})?${previewLine}`, async () => {
    const {data, error} = await db.rpc('staff_fulfill_gadget_reservation', {p_operator_id: currentUser.id, p_reservation_id: resId, p_payment_method: method});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    const msg = data.promo_code
      ? `✅ Consegnato! Promo ${data.promo_code}: -${eur(data.discount)} → ${eur(data.charged)}`
      : `✅ Consegnato! ${eur(data.amount)} (${label})`;
    toast(msg, 'ok');
    if (staffTarget) { const {data: r} = await db.rpc('staff_lookup', {p_card_id: staffTarget.card_id}); if (r?.ok) { const nu = r.user || r; staffTarget = nu; document.getElementById('ac-res-bal').textContent = eur(nu.balance); } }
    loadAcGadgetReservationsForUser(staffTarget?.id);
  });
}
async function loadAcRegisterEventDropdown(cardId) {
  const wrap = document.getElementById('ac-reg-event-wrap');
  if (!wrap) return;
  const {data, error} = await db.rpc('admin_list_events');
  if (error || !data || !data.length) { wrap.style.display='none'; return; }
  const {data: pend} = await db.rpc('staff_list_pending_events', {p_card_id: cardId});
  const {data: chk}  = await db.rpc('staff_list_active_registrations', {p_operator_id: currentUser.id, p_card_id: cardId});
  const registeredIds = new Set([
    ...((pend||[]).map(r => r.event_id)),
    ...((chk?.registrations||[]).map(r => r.event_id))
  ]);
  const available = data.filter(e => e.active && !registeredIds.has(e.id));
  const sel = document.getElementById('ac-event-select');
  sel.innerHTML = '<option value="">Scegli evento…</option>' +
    available.map(e => `<option value="${e.id}">${_esc(e.title)} — ${eur(e.price)}</option>`).join('');
  wrap.style.display = available.length ? 'block' : 'none';
}
async function acRegisterUserEvent() {
  if (!staffTarget) return toast('Cerca prima una tessera');
  const eventId = document.getElementById('ac-event-select').value;
  if (!eventId) return toast('Seleziona un evento');
  const evName = document.getElementById('ac-event-select').selectedOptions[0]?.text || '';
  modalConfirm(`Iscrivere ${staffTarget.display_name} a:\n\n"${evName}"?`, async () => {
    const {data, error} = await db.rpc('staff_register_user_event', {p_operator_id: currentUser.id, p_card_id: staffTarget.card_id, p_event_id: eventId});
    if (error || !data.ok) return toast((error&&error.message)||data.error);
    const msg = data.already_registered ? 'Socio già iscritto' : `✅ Iscritto a "${data.event_title}" — ${eur(data.amount)} da saldare`;
    toast(msg, 'ok');
    await loadAcPendingEvents(staffTarget.card_id);
    loadAcRegisterEventDropdown(staffTarget.card_id);
  });
}
async function loadAcCheckin(cardId) {
  const wrap = document.getElementById('ac-checkin-wrap');
  const list = document.getElementById('ac-checkin-list');
  const {data, error} = await db.rpc('staff_list_active_registrations', {p_operator_id:currentUser.id, p_card_id:cardId});
  if (error || !data || !data.ok || !data.registrations.length) { wrap.style.display='none'; return; }
  const pending = data.registrations.filter(r => !r.checked_in);
  if (!pending.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = pending.map(r => `
    <div class="card" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-weight:700;font-size:14px">${_esc(r.evento)}</div>
        <div style="font-size:11px;color:var(--mut)">${r.event_date?fdt(r.event_date):'—'} · ${r.payment_status}</div>
      </div>
      <button class="btn btn-g" style="flex-shrink:0" onclick="adminCheckinRegBtn('${r.registration_id}','${r.evento.replace(/'/g,"\\'")}',this)">✅ Check-in</button>
    </div>`).join('');
}
async function loadAcUserTx(cardId) {
  const wrap = document.getElementById('ac-tx-wrap');
  const list = document.getElementById('ac-tx-list');
  const {data, error} = await db.rpc('staff_get_user_transactions', {p_operator_id:currentUser.id, p_card_id:cardId});
  if (error || !data || !data.ok || !data.transactions.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = data.transactions.map(t => _txRowHtml(t)).join('');
}
async function adminCassaRecharge(amount) {
  if (!staffTarget) return toast('Cerca prima una tessera');
  const pmSel = document.getElementById('ac-recharge-pm');
  const pm = (pmSel?.value || 'contanti').toLowerCase();
  const pmLabel = pmSel?.selectedOptions?.[0]?.text || _capitalize(pm);
  modalConfirm(`Ricaricare ${eur(amount)} a ${staffTarget.display_name}?\n\nMetodo: ${pmLabel}`, async () => {
    try {
      const {data, error} = await db.rpc('admin_recharge', {p_admin_id: currentUser.id, p_card_id: staffTarget.card_id, p_amount: amount, p_description: 'Ricarica admin', p_payment_method: pm});
      if (error||!data.ok) { console.error('admin_recharge', error, data); return toast((error&&error.message)||(data&&data.error)||'Errore ricarica'); }
      toast(`Ricarica ok! ${eur(staffTarget.balance)} → ${eur(data.new_balance)}`, 'ok');
      staffTarget.balance = data.new_balance;
      document.getElementById('ac-res-bal').textContent = eur(data.new_balance);
    } catch (e) {
      console.error('adminCassaRecharge', e);
      toast('Errore ricarica: ' + (e.message||e));
    }
  });
}
async function adminCassaRechargeCustom() {
  const v = parseFloat(document.getElementById('ac-custom').value);
  if (!v||v<=0) return toast('Importo non valido');
  await adminCassaRecharge(v);
  document.getElementById('ac-custom').value = '';
}
async function adminCassaCharge() {
  if (!staffTarget) return toast('Cerca prima una tessera');
  const v    = parseFloat(document.getElementById('ac-charge-amt').value);
  const cat  = (document.getElementById('ac-charge-cat')?.value || 'consumazione').toLowerCase();
  const note = document.getElementById('ac-charge-desc').value.trim();
  const catLabel = document.getElementById('ac-charge-cat')?.selectedOptions?.[0]?.text || cat;
  const desc = note || catLabel;
  if (!v||v<=0) return toast('Importo non valido');
  const {data: pv} = await db.rpc('staff_preview_charge', {p_operator_id: currentUser.id, p_card_id: staffTarget.card_id, p_amount: v});
  const promoLine = (pv && pv.promo_code)
    ? `\n\n⚡ Promo [${pv.promo_code}] attiva: -${eur(pv.promo_discount)}\nImporto originale: ${eur(v)} → Addebito finale: ${eur(pv.final_amount)} (sconto ${eur(pv.promo_discount)})`
    : '';
  modalConfirm(`Addebitare ${eur(v)} a ${staffTarget.display_name}?\n\nCategoria: ${catLabel}${promoLine}`, async () => {
    const {data, error} = await db.rpc('admin_charge', {p_admin_id: currentUser.id, p_card_id: staffTarget.card_id, p_amount: v, p_description: desc, p_category: cat});
    if (error||!data.ok) {
      if (data?.error === 'insufficient_balance') return toast(`Saldo insufficiente (${eur(data.balance)})`);
      return toast((error&&error.message)||data.error);
    }
    toast(`Addebito ok! ${eur(staffTarget.balance)} → ${eur(data.new_balance)}`, 'ok');
    staffTarget.balance = data.new_balance;
    document.getElementById('ac-res-bal').textContent = eur(data.new_balance);
    document.getElementById('ac-charge-amt').value = '';
    document.getElementById('ac-charge-desc').value = '';
  });
}
async function adminCassaPayEvent(regId, method, eventName, amount) {
  const label = {credito:'credito',sumup:'SumUp',contanti:'contanti'}[method];
  modalConfirm(`Salda "${eventName}" (${eur(amount)}) con ${label}?`, async () => {
    const {data, error} = await db.rpc('staff_pay_event', {p_operator_id:currentUser.id, p_registration_id:regId, p_method:method});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(`✓ ${data.message}`, 'ok');
    staffTarget.balance = data.new_balance;
    document.getElementById('ac-res-bal').textContent = eur(data.new_balance);
    await loadAcPendingEvents(staffTarget.card_id);
  });
}

// ── ADMIN AREA ────────────────────────────────────────────────────────
let _chart = null;
async function loadChart(btn) {
  if (btn) {
    document.querySelectorAll('#at-dash .fbtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const days = parseInt((btn || document.querySelector('#at-dash .fbtn.active')).dataset.days || 30);
  const {data} = await db.rpc('admin_transaction_stats', {p_days: days});
  if (!data || !data.length) return;
  const labels   = data.map(d => { const dt=new Date(d.giorno); return dt.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}); });
  const ricariche = data.map(d => Number(d.ricariche)||0);
  const spese     = data.map(d => Number(d.spese)||0);
  const ctx = document.getElementById('dash-chart').getContext('2d');
  if (_chart) _chart.destroy();
  _chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {label:'Ricariche', data: ricariche, backgroundColor:'rgba(34,197,94,0.7)', borderColor:'#22C55E', borderWidth:1},
        {label:'Spese',     data: spese,     backgroundColor:'rgba(239,68,68,0.7)',  borderColor:'#EF4444', borderWidth:1}
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color:'#FFFFFF', font:{size:12} } } },
      scales: {
        x: { ticks: { color:'#B5B5B5', font:{size:11} }, grid: { color:'#272727' } },
        y: { ticks: { color:'#B5B5B5', font:{size:11}, callback: v => '€'+v }, grid: { color:'#272727' } }
      }
    }
  });
}
function gotoAdmin() {
  document.getElementById('a-name').textContent = currentUser.display_name;
  showScreen('screen-admin');
  loadDash(); loadAUsers(); loadATx(); loadAGest();
}
async function loadDash() {
  const {data} = await db.rpc('admin_dashboard');
  if (!data) return;
  loadChart(null);
  const kpis = [
    {ic:'👥', v:data.total_users,          l:'Soci attivi'},
    {ic:'🏪', v:data.total_staff,          l:'Staff attivi'},
    {ic:'💰', v:eur(data.total_balance),   l:'Saldo in circolo'},
    {ic:'🔄', v:eur(data.total_recharges), l:'Tot. ricariche'},
    {ic:'🛍️', v:eur(data.total_purchases), l:'Tot. acquisti'},
    {ic:'📊', v:data.transactions_today,   l:'Trans. oggi'},
    {ic:'🎫', v:data.total_events,         l:'Eventi attivi'},
    {ic:'✅', v:data.total_registrations,  l:'Iscrizioni tot.'},
  ];
  document.getElementById('a-kpi').innerHTML = kpis.map(k=>`
    <div class="kpi-card">
      <div class="kpi-ic">${k.ic}</div>
      <div class="kpi-val">${k.v}</div>
      <div class="kpi-lbl">${k.l}</div>
    </div>`).join('');
}
async function loadAUsers() {
  const [{data}, {data: incomplete}] = await Promise.all([
    db.rpc('admin_list_users'),
    db.rpc('admin_list_incomplete_users', {p_admin_id: currentUser.id})
  ]);
  if (!data) return;
  allAdminUsers = data;
  _incompleteUsersMap = {};
  if (Array.isArray(incomplete)) {
    incomplete.forEach(u => { _incompleteUsersMap[u.card_id] = u; });
  }
  _updateAUsersCounts();
  renderAUsers(_adminUsersRole);
}
function _updateAUsersCounts() {
  const all = allAdminUsers || [];
  const counts = {
    all:   all.length,
    user:  all.filter(u => u.role === 'user' && !u.is_staff).length,
    staff: all.filter(u => u.is_staff === true).length,
    admin: all.filter(u => u.role === 'admin').length
  };
  document.querySelectorAll('#a-filter .fbtn-cnt').forEach(el => {
    const k = el.dataset.cnt;
    el.textContent = counts[k] != null ? counts[k] : 0;
  });
}
function _onAdminUsersSearch(val) {
  _adminUsersSearch = (val || '').toLowerCase().trim();
  renderAUsers(_adminUsersRole);
}
function _setAdminUsersSort(key) {
  if (_adminUsersSort.key === key) {
    _adminUsersSort.dir = _adminUsersSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _adminUsersSort = {key, dir: 'asc'};
  }
  renderAUsers(_adminUsersRole);
}
function renderAUsers(role) {
  const el = document.getElementById('a-users-list');
  let us = role==='all' ? allAdminUsers.slice()
    : role==='staff' ? allAdminUsers.filter(u => u.is_staff === true)
    : role==='user'  ? allAdminUsers.filter(u => u.role === 'user' && !u.is_staff)
    : allAdminUsers.filter(u => u.role === role);
  const q = _adminUsersSearch;
  if (q) {
    us = us.filter(u =>
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.card_id      || '').toLowerCase().includes(q) ||
      ((u.nome || '') + ' ' + (u.cognome || '')).toLowerCase().includes(q) ||
      (u.email        || '').toLowerCase().includes(q));
  }
  const s = _adminUsersSort;
  us.sort((a, b) => {
    let va = a[s.key], vb = b[s.key];
    if (s.key === 'balance') { va = Number(va || 0); vb = Number(vb || 0); return s.dir === 'asc' ? va - vb : vb - va; }
    va = (va || '').toString().toLowerCase();
    vb = (vb || '').toString().toLowerCase();
    if (va < vb) return s.dir === 'asc' ? -1 : 1;
    if (va > vb) return s.dir === 'asc' ?  1 : -1;
    return 0;
  });
  if (!us.length) {
    el.innerHTML = q ? '<div class="empty">Nessun risultato per la ricerca</div>' : '<div class="empty">Nessun utente</div>';
    return;
  }
  const arr = (col) => `<span class="sort-arr${s.key===col?' on':''}">${s.key===col ? (s.dir==='asc'?'↑':'↓') : '↕'}</span>`;
  el.innerHTML = `<div class="tbl-wrap"><table><thead><tr>
    <th class="sort-th" onclick="_setAdminUsersSort('card_id')">Tessera ${arr('card_id')}</th>
    <th class="sort-th" onclick="_setAdminUsersSort('display_name')">Nome ${arr('display_name')}</th>
    <th>Ruolo</th>
    <th class="sort-th" onclick="_setAdminUsersSort('balance')">Saldo ${arr('balance')}</th>
    <th>Stato</th>
    <th></th></tr></thead><tbody>`
    + us.map(u=>{
      const inc = _incompleteUsersMap[u.card_id];
      let badge = '';
      if (inc) {
        const label = inc.missing_cf ? '⚠️ Da completare' : '📋 Privacy mancante';
        const title = inc.missing_cf ? 'Codice fiscale mancante' : 'Consenso privacy non registrato';
        badge = `<span title="${title}" style="display:inline-block;margin-left:6px;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(255,183,3,.18);color:#e6a800;border:1px solid rgba(255,183,3,.35)">${label}</span>`;
      }
      return `<tr>
        <td class="mono">${u.card_id}</td>
        <td>
          <div>${u.display_name}${badge}</div>
          ${(u.email||u.nome)?`<div style="font-size:11px;color:var(--mut)">${[u.nome&&u.cognome?u.nome+' '+u.cognome:'',u.email].filter(Boolean).join(' · ')}</div>`:''}
        </td>
        <td style="white-space:nowrap">
          <span class="role-badge r${u.role[0]}">${u.role}</span>${u.is_staff ? ' <span class="role-badge rs" title="Puo\' operare come staff">staff</span>' : ''}
        </td>
        <td class="${u.balance>0?'pos':''}">${eur(u.balance)}</td>
        <td style="font-size:11px;color:${u.active?'var(--grn)':'var(--neg)'}">${u.active?'attivo':'disattivo'}</td>
        <td style="white-space:nowrap">
          <button class="btn-sm" title="Reset PIN" onclick="openPinModal('${u.card_id}')">🔑</button>
          <button class="btn-sm" title="Modifica" onclick="openEditUser('${u.id}')">✏️</button>
          ${u.is_staff ? `<button class="btn-sm" title="Rimuovi da staff" onclick="demoteFromStaff('${u.id}','${_esc(u.card_id)}','${_esc((u.display_name||'').replace(/'/g,"\\'"))}')">⬇️</button>` : ''}
          <button class="btn-sm" title="Elimina" style="color:var(--neg)" onclick="adminDeleteUser('${u.id}','${_esc(u.card_id)}','${_esc((u.display_name||'').replace(/'/g,"\\'"))}')">🗑️</button>
        </td>
      </tr>`;
    }).join('')
    + '</tbody></table></div>';
}
async function openNewUserForm() {
  const form = document.getElementById('nu-form');
  if (form.style.display === 'block') { form.style.display = 'none'; return; }
  try {
    let users = allAdminUsers;
    if (!users || !users.length) {
      const {data} = await db.rpc('admin_list_users');
      users = data || [];
    }
    let max = 0;
    users.forEach(u => {
      const m = (u.card_id||'').match(/^SH-(\d+)$/i);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    });
    document.getElementById('nu-card').value = 'SH-' + String(max + 1).padStart(3, '0');
  } catch (e) { console.error('openNewUserForm', e); }
  form.style.display = 'block';
  document.getElementById('nu-name').focus();
}
async function createUser() {
  const card = document.getElementById('nu-card').value.trim().toUpperCase();
  const name = document.getElementById('nu-name').value.trim();
  const pin  = document.getElementById('nu-pin').value.trim();
  const role = document.getElementById('nu-role').value;
  if (!card||!name||!pin) return toast('Compila tutti i campi');
  const {data, error} = await db.rpc('admin_create_user', {p_card_id:card, p_display_name:name, p_pin:pin, p_role:role});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  toast(`Utente ${card} creato!`, 'ok');
  ['nu-card','nu-name','nu-pin'].forEach(id => document.getElementById(id).value='');
  document.getElementById('nu-form').style.display = 'none';
  loadAUsers();
}
async function loadATx() {
  const {data} = await db.rpc('admin_list_transactions', {p_limit: 200});
  const el = document.getElementById('a-tx-list');
  if (!data || !data.length) { el.innerHTML='<div class="empty">Nessuna transazione</div>'; return; }
  _adminTxAll = data;
  _adminTxTipo = 'all'; _adminTxDays = 0; _adminTxSearch = '';
  const searchEl = document.getElementById('a-tx-search');
  if (searchEl) searchEl.value = '';
  document.querySelectorAll('#at-tx .fbtn').forEach(b => b.classList.toggle('active', b.dataset.mf==='all'||b.dataset.mf==='0'));
  _renderAdminTx();
}
function setAdminTxFilter(btn, group) {
  btn.closest('div').querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (group === 'tipo') _adminTxTipo = btn.dataset.mf;
  else _adminTxDays = parseInt(btn.dataset.mf);
  _renderAdminTx();
}
function filterAdminTxSearch(val) {
  _adminTxSearch = (val||'').toLowerCase().trim();
  _renderAdminTx();
}
function _renderAdminTx() {
  const now = Date.now();
  const list = _adminTxAll.filter(t => {
    const tipoOk = _adminTxTipo === 'all' || t.type === _adminTxTipo;
    const dateOk = _adminTxDays === 0 || (now - new Date(t.created_at).getTime()) < _adminTxDays * 86400000;
    const srcOk  = !_adminTxSearch ||
      (t.card_id||'').toLowerCase().includes(_adminTxSearch) ||
      (t.operator_name||'').toLowerCase().includes(_adminTxSearch);
    return tipoOk && dateOk && srcOk;
  });
  const el = document.getElementById('a-tx-list');
  if (!list.length) { el.innerHTML='<div class="empty">Nessuna transazione</div>'; return; }
  el.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Tessera</th><th>Tipo</th><th>Descrizione</th><th>Importo</th><th>Operatore</th><th></th></tr></thead><tbody>`
    + list.map(t=>{
      const canVoid = t.type !== 'refund';
      const dscRaw = (t.description||'').replace(/'/g,"\\'");
      return `<tr>
        <td class="dt-cell">${fdt(t.created_at)}</td>
        <td class="mono">${t.card_id}</td>
        <td>${txic(t.type)} ${t.type}</td>
        <td style="font-size:12px;color:var(--mut);max-width:220px;word-break:break-word">${_esc(t.description||'')}</td>
        <td class="${t.amount>=0?'pos':'neg-c'}">${t.amount>=0?'+':''}${eur(t.amount)}</td>
        <td>${t.operator_name||'—'}</td>
        <td style="white-space:nowrap">
          <button class="btn-sm" title="Modifica descrizione" onclick="adminEditTxDesc('${t.id}','${dscRaw}')">✏️</button>
          ${canVoid ? `<button class="btn-sm" title="Storna" style="color:var(--neg)" onclick="adminVoidTx('${t.id}',${t.amount},'${dscRaw}','${_esc(t.card_id)}')">↩️</button>` : ''}
        </td>
      </tr>`;
    }).join('')
    + '</tbody></table></div>';
}
async function loadAGest() {
  const [{data: evData}, {data: catData}, {data: gadSum}] = await Promise.all([
    db.rpc('admin_list_events'),
    db.rpc('get_catalog'),
    db.rpc('staff_gadget_reservation_summary')
  ]);
  // Pre-load SumUp links if tab is active
  const sumupPanel = document.getElementById('gs-sumup');
  if (sumupPanel && sumupPanel.classList.contains('active')) loadAdminSumupLinks();
  // Genera il form eventi nel pannello gs-ev (onclick inline garantito)
  const gsEv = document.getElementById('gs-ev');
  if (gsEv) {
    gsEv.innerHTML = `
      <button class="btn-sm p" style="margin-bottom:10px" onclick="toggleEl('fe-form')">+ Nuovo Evento</button>
      <div id="fe-form" class="card" style="display:none;margin-bottom:10px">
        <div class="fg"><label>Titolo</label><input id="fe-title" type="text" placeholder="Nome evento"></div>
        <div class="fg"><label>Descrizione</label><input id="fe-desc" type="text" placeholder="Descrizione"></div>
        <div class="form-row">
          <div class="fg"><label>Data e ora</label><input id="fe-date" type="datetime-local"></div>
          <div class="fg"><label>Luogo</label><input id="fe-loc" type="text" placeholder="Luogo"></div>
        </div>
        <div class="form-row">
          <div class="fg"><label>Max posti (0=∞)</label><input id="fe-maxp" type="number" min="0" placeholder="0"></div>
          <div class="fg"><label>Prezzo €</label><input id="fe-price" type="number" min="0" step="0.50" placeholder="0.00"></div>
        </div>
        <div class="form-row">
          <div class="fg"><label>Link SumUp (opz.)</label><input id="fe-sumup" type="url" placeholder="https://..."></div>
          <div class="fg"><label>Slug (opz.)</label><input id="fe-slug" type="text" placeholder="es. yoga-giugno-2026"></div>
        </div>
        <div class="fg" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="fe-public" style="width:18px;height:18px;accent-color:var(--gold)">
          <label for="fe-public">🌐 Apri iscrizioni esterne (link pubblico)</label>
        </div>
        <div class="fg"><label>Immagine (opz.)</label><div id="fe-img-mount"></div><input type="hidden" id="fe-img"></div>
        <button class="btn btn-p w100" data-action="create-event">Crea Evento</button>
      </div>
      <div id="gs-ev-list"></div>`;
    mountImageUploader('fe-img-mount', 'fe-img', 'events');
  }
  const evList  = document.getElementById('gs-ev-list');
  const gadList = document.getElementById('gs-gad-list');
  const proList = document.getElementById('gs-pro-list');
  const evs = evData||[];
  if (!evs.length) { evList.innerHTML='<div class="empty">Nessun evento</div>'; }
  else {
    evList.innerHTML = evs.map(e=>`
      <div class="card" style="margin-bottom:10px;opacity:${e.visible===false?0.55:1}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-weight:700;flex:1">${_esc(e.title)}</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${e.visible===false?'rgba(239,68,68,.15)':'rgba(34,197,94,.15)'};color:${e.visible===false?'var(--neg)':'var(--grn)'}">
            ${e.visible===false?'👁‍🗨 Nascosto':'👁 Visibile'}
          </span>
        </div>
        <div style="font-size:12px;color:var(--mut)">${e.event_date?fdt(e.event_date):'—'} · ${_esc(e.location||'—')} · ${e.price>0?eur(e.price):'Gratuito'} · ${e.max_participants||'∞'} posti</div>
        ${e.slug&&e.public_registration?`<div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
          <a href="?event=${e.slug}" target="_blank" rel="noopener" class="reg-link" style="font-size:11px">🔗 ?event=${_esc(e.slug)}</a>
          <button class="btn-sm" style="font-size:11px;padding:2px 8px" onclick="copyPublicLink('${_esc(e.slug)}')">📋 Copia link</button>
        </div>`:''}
        <div id="ev-dash-${e.id}" class="ev-mini-dash" style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap;padding:10px;background:var(--bg);border-radius:8px">
          <span style="font-size:11px;color:var(--mut)">⏳ carico…</span>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-sm" onclick="openEditEvent('${e.id}')">✏️ Modifica</button>
          <button class="btn-sm" onclick="adminToggleVisibility('${e.id}',${e.visible!==false})">${e.visible===false?'🔓 Mostra':'🔒 Nascondi'}</button>
          <button class="btn-sm" onclick="toggleEventGuests('${e.id}','${e.title.replace(/'/g,"\\'")}',this)">👥 Iscritti</button>
          <button class="btn-sm" onclick="exportEventCSV('${e.id}','${e.title.replace(/'/g,"\\'")}')">📥 CSV</button>
          <button class="btn-sm" style="color:var(--neg)" data-action="delete-event" data-event-id="${e.id}" data-event-title="${_esc(e.title)}">🗑️ Elimina</button>
        </div>
        <div id="guests-${e.id}" style="display:none;margin-top:10px"></div>
      </div>`).join('');
    await Promise.all(evs.map(e => loadEvDash(e.id)));
  }
  const cat = catData||{};
  const gads = cat.gadgets||[];
  _gadgetsAdminCache = {}; gads.forEach(g => _gadgetsAdminCache[g.id] = g);
  _eventsAdminCache = {}; (evs||[]).forEach(e => _eventsAdminCache[e.id] = e);
  const gadSummary = (gadSum && gadSum.gadgets) ? gadSum.gadgets : [];
  const gadSumMap = {};
  gadSummary.forEach(g => { gadSumMap[g.id] = g; });
  gadList.innerHTML = gads.length
    ? gads.map(g => {
        const sum = gadSumMap[g.id] || {prenotati: 0, disponibili: g.stock, prenotazioni: []};
        const pren = sum.prenotati || 0;
        const disp = sum.disponibili ?? g.stock;
        const gn = g.name.replace(/'/g,"\\'"); const gd = (g.description||'').replace(/'/g,"\\'");
        return `<div class="card" style="margin-bottom:8px;padding:12px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:700;flex:1">${_esc(g.name)}</span>
            <span style="font-size:12px;color:var(--mut)">Stock: ${g.stock}${pren>0?` · <span style="color:var(--grn);font-weight:600">Disp: ${disp}</span>`:''}</span>
            <span style="font-weight:700;color:var(--gold)">${eur(g.price)}</span>
          </div>
          ${g.description?`<div style="font-size:12px;color:var(--mut);margin-top:3px">${_esc(g.description)}</div>`:''}
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
            ${pren>0
              ? `<button class="btn-sm" style="background:rgba(255,214,10,.15);color:var(--gold)" onclick="toggleGadgetPren('${g.id}',this)">📌 ${pren} prenotat${pren===1?'o':'i'}</button>`
              : `<span style="font-size:11px;color:var(--mut)">📌 0 prenotati</span>`}
            <button class="btn-sm" onclick="openEditGadget('${g.id}','${gn}',${g.price},'${gd}',${g.stock})">✏️ Modifica</button>
            <button class="btn-sm" style="color:var(--neg)" onclick="adminDeleteGadget('${g.id}','${gn}')">🗑️ Elimina</button>
          </div>
          <div id="gpren-${g.id}" style="display:none;margin-top:8px"></div>
        </div>`;
      }).join('')
    : '<div class="empty">Nessun gadget</div>';
  gadSummary.forEach(g => {
    const el = document.getElementById('gpren-' + g.id);
    if (!el) return;
    el.dataset.pren = JSON.stringify(g.prenotazioni || []);
  });
  const prs = cat.promos||[];
  _promosAdminCache = {}; prs.forEach(p => _promosAdminCache[p.id] = p);
  proList.innerHTML = prs.length
    ? prs.map(p => {
        const sconto = p.discount_type==='percent' ? p.discount_value+'%' : eur(p.discount_value);
        const fino   = p.valid_until ? fdt(p.valid_until).split(' ')[0] : '∞';
        const untilVal = p.valid_until ? p.valid_until.slice(0,10) : '';
        return `<div class="card" style="margin-bottom:8px;padding:12px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="mono" style="font-weight:700;font-size:15px">${_esc(p.code)}</span>
            <span style="font-size:12px;color:var(--mut);flex:1">${_esc(p.description||'')}</span>
            <span style="font-size:13px;color:var(--gold);font-weight:700">${sconto}</span>
            <span style="font-size:11px;color:var(--mut)">fino ${fino}</span>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn-sm" onclick="openEditPromo('${p.id}','${_esc(p.code)}','${_esc(p.description||'')}','${p.discount_type}',${p.discount_value},'${untilVal}')">✏️ Modifica</button>
            <button class="btn-sm" style="color:var(--neg)" onclick="deletePromo('${p.id}','${_esc(p.code)}')">🗑️ Elimina</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Nessuna promo</div>';
}
async function loadAdminSumupLinks() {
  const el = document.getElementById('gs-sumup-list');
  if (!el) return;
  el.innerHTML = '<div class="empty">⏳ Carico…</div>';
  const {data: cat} = await db.rpc('get_catalog');
  const links = cat?.sumup_links || [];
  if (!links.length) { el.innerHTML='<div class="empty">Nessun link SumUp</div>'; return; }
  el.innerHTML = links.map(l => `
    <div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:600;flex:1">${_esc(l.label)}</span>
        ${l.amount!=null?`<span style="color:var(--gold);font-weight:700">${eur(l.amount)}</span>`:''}
      </div>
      <div style="font-size:11px;color:var(--mut);word-break:break-all;margin:4px 0">${_esc(l.url)}</div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <a href="${l.url}" target="_blank" rel="noopener" class="btn-sm" style="text-decoration:none">🔗 Apri</a>
        <button class="btn-sm" onclick="openEditSumupLink('${l.id}','${_esc(l.label.replace(/'/g,"\\'"))}','${_esc(l.url.replace(/'/g,"\\'"))}',${l.amount!=null?l.amount:'null'})">✏️ Modifica</button>
        <button class="btn-sm" style="color:var(--neg)" onclick="adminDeleteSumupLink('${l.id}','${_esc(l.label)}')">🗑️ Elimina</button>
      </div>
    </div>`).join('');
}
async function adminAddSumupLink() {
  const label  = document.getElementById('sl-label').value.trim();
  const url    = document.getElementById('sl-url').value.trim();
  const amount = parseFloat(document.getElementById('sl-amount').value) || null;
  if (!label || !url) return toast('Etichetta e URL obbligatori');
  const {data, error} = await db.rpc('admin_add_sumup_link', {p_admin_id: currentUser.id, p_label: label, p_url: url, p_amount: amount});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  toast('Link aggiunto!', 'ok');
  ['sl-label','sl-url','sl-amount'].forEach(id => document.getElementById(id).value='');
  loadAdminSumupLinks();
}
function openEditSumupLink(id, label, url, amount) {
  document.getElementById('sle-id').value     = id;
  document.getElementById('sle-label').value  = label;
  document.getElementById('sle-url').value    = url;
  document.getElementById('sle-amount').value = (amount != null && amount !== 'null') ? amount : '';
  document.getElementById('sle-bg').style.display = 'block';
}
function closeEditSumupLink() {
  document.getElementById('sle-bg').style.display = 'none';
}
async function saveEditSumupLink() {
  const id     = document.getElementById('sle-id').value;
  const label  = document.getElementById('sle-label').value.trim();
  const url    = document.getElementById('sle-url').value.trim();
  const amount = parseFloat(document.getElementById('sle-amount').value) || null;
  if (!label || !url) return toast('Etichetta e URL obbligatori');
  const {data, error} = await db.rpc('admin_update_sumup_link', {p_admin_id: currentUser.id, p_link_id: id, p_label: label, p_url: url, p_amount: amount});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  toast('Link aggiornato!', 'ok');
  closeEditSumupLink();
  loadAdminSumupLinks();
}
async function adminDeleteSumupLink(id, label) {
  modalConfirm(`Eliminare il link "${label}"?`, async () => {
    const {data, error} = await db.rpc('admin_delete_sumup_link', {p_admin_id: currentUser.id, p_link_id: id});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast('Link eliminato', 'ok');
    loadAdminSumupLinks();
  });
}
async function adminToggleVisibility(eventId, currentVisible) {
  const label = currentVisible ? 'nascondere' : 'rendere visibile';
  modalConfirm(`Vuoi ${label} questo evento nel catalogo?`, async () => {
    const {data, error} = await db.rpc('admin_toggle_event_visibility', {p_admin_id: currentUser.id, p_event_id: eventId});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(`Evento ${data.visible?'visibile':'nascosto'}`, 'ok');
    loadAGest();
  });
}
async function adminDeleteEvent(eventId, eventTitle) {
  modalConfirm(`Eliminare definitivamente "${eventTitle}"?\n\nTutte le iscrizioni e accompagnatori verranno cancellati.`, async () => {
    try {
      const {data, error} = await db.rpc('admin_delete_event', {p_admin_id: currentUser.id, p_event_id: eventId});
      if (error || !data || !data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore eliminazione');
      toast('Evento eliminato', 'ok');
      loadAGest();
    } catch(e) { toast(e.message||'Errore'); }
  });
}
function copyPublicLink(slug) {
  const link = `https://maci81x.github.io/shanghai-card/?event=${slug}`;
  navigator.clipboard?.writeText(link).then(()=>toast('Link copiato!','ok')).catch(()=>toast(link));
}
function _slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9\s-]/g,'')
    .trim().replace(/\s+/g,'-')
    .replace(/-+/g,'-');
}
async function adminCreateEvent() {
  try {
    const get = (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error('Campo mancante nel DOM: #' + id);
      return el.value;
    };
    const title = get('fe-title').trim();
    const desc  = get('fe-desc').trim();
    const date  = get('fe-date');
    const loc   = get('fe-loc').trim();
    const maxp  = parseInt(get('fe-maxp')) || null;
    const price = parseFloat(get('fe-price')) || 0;
    const sumup = get('fe-sumup').trim();
    let   slug  = get('fe-slug').trim();
    const pubEl = document.getElementById('fe-public');
    if (!pubEl) throw new Error('Campo mancante nel DOM: #fe-public');
    const pub = pubEl.checked;

    if (!title) { modalInfo('⚠️ Inserisci il titolo'); return; }
    if (pub && !slug) slug = _slugify(title);

    const imgUrl = (document.getElementById('fe-img')?.value || '').trim();

    const { data, error } = await db.rpc('admin_create_event', {
      p_admin_id:            currentUser.id,
      p_title:               title,
      p_description:         desc || null,
      p_event_date:          date ? new Date(date).toISOString() : null,
      p_location:            loc || null,
      p_max_participants:    maxp,
      p_price:               price,
      p_sumup_link:          sumup || null,
      p_slug:                slug || null,
      p_public_registration: pub
    });

    console.log('adminCreateEvent RPC:', { data, error });

    if (error) throw new Error('Errore RPC: ' + error.message);
    if (!data || data.ok === false) throw new Error('RPC ko: ' + (data?.error || JSON.stringify(data)));

    if (imgUrl && data.event_id) {
      await db.rpc('admin_update_event', {p_admin_id: currentUser.id, p_event_id: data.event_id, p_image_url: imgUrl});
    }

    // Reset form
    ['fe-title','fe-desc','fe-date','fe-loc','fe-maxp','fe-price','fe-sumup','fe-slug','fe-img']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    resetImageUploader('fe-img-mount');
    if (pubEl) pubEl.checked = false;
    const fEl = document.getElementById('fe-form');
    if (fEl) fEl.style.display = 'none';
    loadAGest();

    if (data.public_link) {
      const link = data.public_link;
      modalInfo(`✅ Evento creato!\n\n🔗 Link pubblico:\n${link}\n\nCondividi questo link per le iscrizioni esterne.`, () => {
        navigator.clipboard?.writeText(link).then(() => toast('Link copiato!', 'ok')).catch(() => {});
      }, '📋 Copia link');
    } else {
      modalInfo('✅ Evento creato!');
    }
  } catch (err) {
    console.error('adminCreateEvent:', err);
    modalInfo('❌ Errore\n\n' + err.message);
  }
}
async function createGadget() {
  const name  = document.getElementById('fg-name').value.trim();
  const desc  = document.getElementById('fg-desc').value.trim();
  const price = parseFloat(document.getElementById('fg-price').value);
  const stock = parseInt(document.getElementById('fg-stock').value)||0;
  const img   = document.getElementById('fg-img').value.trim();
  if (!name||!price) return toast('Inserisci nome e prezzo');
  const {data, error} = await db.rpc('admin_create_gadget', {p_name:name, p_description:desc||null, p_price:price, p_stock:stock, p_image_url:img||null});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  toast('Gadget creato!', 'ok');
  ['fg-name','fg-desc','fg-price','fg-stock','fg-img'].forEach(id=>document.getElementById(id).value='');
  resetImageUploader('fg-img-mount');
  document.getElementById('fg-form').style.display='none';
  loadAGest();
}
// ── GADGET ADMIN ─────────────────────────────────────────────────────
function toggleGadgetPren(gadgetId, btn) {
  const el = document.getElementById('gpren-' + gadgetId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  const list = JSON.parse(el.dataset.pren || '[]');
  if (!list.length) { el.innerHTML = '<div class="empty" style="font-size:12px">Nessuna prenotazione attiva</div>'; }
  else {
    el.innerHTML = `<div class="tbl-wrap"><table style="font-size:12px"><thead><tr><th>Tessera</th><th>Nome</th><th>Qtà</th><th>Data</th></tr></thead><tbody>`
      + list.map(r=>`<tr>
          <td class="mono">${_esc(r.card_id)}</td>
          <td>${_esc(r.display_name)}</td>
          <td style="text-align:center">${r.quantity}</td>
          <td>${fdt(r.created_at).split(' ')[0]}</td>
        </tr>`).join('')
      + '</tbody></table></div>';
  }
  el.style.display = 'block';
}
function openEditGadget(id, name, price, desc, stock) {
  document.getElementById('gae-id').value    = id;
  document.getElementById('gae-name').value  = name;
  document.getElementById('gae-price').value = price;
  document.getElementById('gae-desc').value  = desc;
  document.getElementById('gae-stock').value = stock;
  const gCached = (typeof _gadgetsAdminCache !== 'undefined' && _gadgetsAdminCache[id]) || {};
  const curImg = gCached.image_url || '';
  document.getElementById('gae-img').value = curImg;
  setImageUploaderPreview('gae-img-mount', curImg);
  document.getElementById('gad-edit-bg').style.display = 'flex';
}
function closeEditGadget() { document.getElementById('gad-edit-bg').style.display = 'none'; }
async function saveEditGadget() {
  const id    = document.getElementById('gae-id').value;
  const name  = document.getElementById('gae-name').value.trim();
  const price = parseFloat(document.getElementById('gae-price').value);
  const desc  = document.getElementById('gae-desc').value.trim();
  const stock = parseInt(document.getElementById('gae-stock').value)||0;
  const img   = document.getElementById('gae-img').value.trim();
  if (!name || !price) return toast('Nome e prezzo obbligatori');
  const {data, error} = await db.rpc('admin_update_gadget', {p_admin_id: currentUser.id, p_gadget_id: id, p_name: name, p_price: price, p_description: desc||null, p_stock: stock});
  if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
  const cachedImg = ((typeof _gadgetsAdminCache !== 'undefined' && _gadgetsAdminCache[id]) || {}).image_url || '';
  if (img !== cachedImg) {
    const {data: imgRes, error: imgErr} = await db.rpc('admin_set_gadget_image', {p_admin_id: currentUser.id, p_gadget_id: id, p_image_url: img || null});
    if (imgErr || !imgRes || !imgRes.ok) { toast('Salvato ma immagine non aggiornata'); }
  }
  toast('Gadget aggiornato!', 'ok');
  closeEditGadget();
  loadAGest();
}
async function adminDeleteGadget(id, name) {
  modalConfirm(`Eliminare il gadget "${name}"?\n\nLe prenotazioni attive non vengono cancellate.`, async () => {
    const {data, error} = await db.rpc('admin_delete_gadget', {p_admin_id: currentUser.id, p_gadget_id: id});
    if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
    toast('Gadget eliminato', 'ok');
    loadAGest();
  });
}
async function loadStaffGadgets() {
  const el = document.getElementById('st-gad-list');
  if (!el) return;
  el.innerHTML = '<div class="empty">⏳ Carico…</div>';
  const {data, error} = await db.rpc('staff_gadget_reservation_summary');
  if (error || !data || !data.ok) { el.innerHTML='<div class="empty">Errore caricamento</div>'; return; }
  const gads = data.gadgets || [];
  if (!gads.length) { el.innerHTML='<div class="empty">Nessun gadget</div>'; return; }
  el.innerHTML = gads.map(g => {
    const pren = g.prenotati || 0;
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:700;flex:1">${_esc(g.name)}</span>
        <span style="font-size:12px;color:var(--mut)">Stock: ${g.stock}</span>
        <span style="font-weight:700;color:var(--gold)">${eur(g.price)}</span>
      </div>
      ${g.description?`<div style="font-size:12px;color:var(--mut);margin-top:3px">${_esc(g.description)}</div>`:''}
      <div style="margin-top:8px">
        ${pren>0
          ? `<button class="btn-sm" style="background:rgba(255,214,10,.15);color:var(--gold)" onclick="toggleStaffGadgetPren('${g.id}',this,'${JSON.stringify(g.prenotazioni||[]).replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">📌 ${pren} prenotat${pren===1?'o':'i'} — vedi chi</button>`
          : `<span style="font-size:11px;color:var(--mut)">📌 0 prenotati</span>`}
      </div>
      <div id="sgpren-${g.id}" style="display:none;margin-top:8px"></div>
    </div>`;
  }).join('');
}
function toggleStaffGadgetPren(gadgetId, btn, prenJson) {
  const el = document.getElementById('sgpren-' + gadgetId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  try {
    const list = JSON.parse(prenJson.replace(/&quot;/g, '"'));
    el.innerHTML = !list.length
      ? '<div class="empty" style="font-size:12px">Nessuna</div>'
      : `<div class="tbl-wrap"><table style="font-size:12px"><thead><tr><th>Tessera</th><th>Nome</th><th>Qtà</th><th>Data</th></tr></thead><tbody>`
        + list.map(r=>`<tr><td class="mono">${_esc(r.card_id)}</td><td>${_esc(r.display_name)}</td><td style="text-align:center">${r.quantity}</td><td>${fdt(r.created_at).split(' ')[0]}</td></tr>`).join('')
        + '</tbody></table></div>';
  } catch(e) { el.innerHTML = '—'; }
  el.style.display = 'block';
}

// ── LANDING EVENTO PUBBLICO ───────────────────────────────────────────
let _publicEvent = null;
async function loadPublicEvent(slug) {
  showScreen('screen-event');
  const {data, error} = await db.rpc('get_public_event', {p_slug: slug});
  if (error || !data.ok) {
    document.getElementById('ev-info').innerHTML = `<div class="empty">Evento non trovato o non disponibile</div>`;
    return;
  }
  _publicEvent = data.event;
  document.getElementById('ev-title').textContent = _publicEvent.title;
  const dateStr = _publicEvent.event_date ? new Date(_publicEvent.event_date).toLocaleString('it-IT',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}) : '—';
  const spotsHtml = _publicEvent.spots_left !== null
    ? `<div style="margin-top:8px"><span class="badge ${_publicEvent.spots_left>0?'bg':'br'}">${_publicEvent.spots_left>0?_publicEvent.spots_left+' posti disponibili':'Sold out'}</span></div>`
    : '';
  document.getElementById('ev-info').innerHTML = `
    ${_publicEvent.image_url?`<img src="${_publicEvent.image_url}" style="width:100%;border-radius:12px;margin-bottom:12px;max-height:200px;object-fit:cover" alt="${_esc(_publicEvent.title)}">`:''}
    <div style="font-size:15px;font-weight:700;margin-bottom:6px">${_publicEvent.title}</div>
    ${_publicEvent.description?`<div style="font-size:13px;color:var(--mut);margin-bottom:8px">${_publicEvent.description}</div>`:''}
    <div style="font-size:13px;margin-bottom:3px">📅 ${dateStr}</div>
    ${_publicEvent.location?`<div style="font-size:13px;margin-bottom:3px">📍 ${_publicEvent.location}</div>`:''}
    <div style="font-size:15px;font-weight:700;color:var(--gold);margin-top:10px">${_publicEvent.price>0?eur(_publicEvent.price):'Evento gratuito'}</div>
    ${spotsHtml}
  `;
  if (_publicEvent.spots_left === null || _publicEvent.spots_left > 0) {
    document.getElementById('ev-reg-area').style.display = 'block';
    document.getElementById('ev-guests-list').innerHTML = '';
    addGuestRow();
  }
}
function addGuestRow() {
  const list = document.getElementById('ev-guests-list');
  const idx = list.children.length;
  const div = document.createElement('div');
  div.className = 'card';
  div.style.cssText = 'margin-bottom:10px;padding:14px';
  div.innerHTML = `
    <div style="font-size:12px;color:var(--mut);font-weight:600;margin-bottom:10px;text-transform:uppercase">Persona ${idx+1}</div>
    <div class="form-row">
      <div class="fg"><label>Nome *</label><input type="text" class="g-nome" placeholder="Mario"></div>
      <div class="fg"><label>Cognome *</label><input type="text" class="g-cognome" placeholder="Rossi"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Telefono *</label><input type="tel" class="g-tel" placeholder="+39 333..."></div>
      <div class="fg"><label>Email</label><input type="email" class="g-email" placeholder="email@..."></div>
    </div>
    ${idx>0?`<button class="btn-ico" style="margin-top:4px" onclick="this.closest('div.card').remove();updateEvTotal()">✕ Rimuovi</button>`:''}
  `;
  list.appendChild(div);
  div.querySelectorAll('input').forEach(i => i.addEventListener('input', updateEvTotal));
  updateEvTotal();
}
function updateEvTotal() {
  const n = document.getElementById('ev-guests-list').children.length;
  const el = document.getElementById('ev-total');
  if (_publicEvent && _publicEvent.price > 0) {
    el.innerHTML = `Totale per ${n} ${n===1?'persona':'persone'}: <strong style="color:var(--gold)">${eur(_publicEvent.price * n)}</strong>`;
    if (_publicEvent.sumup_link) {
      el.innerHTML += ` <a href="${_publicEvent.sumup_link}" target="_blank" rel="noopener" class="reg-link" style="display:block;margin-top:6px">💳 Paga ora con SumUp</a>`;
    }
  } else {
    el.textContent = `${n} ${n===1?'partecipante':'partecipanti'}`;
  }
}
async function submitGuests() {
  const rows = document.querySelectorAll('#ev-guests-list > div');
  const guests = [];
  for (const row of rows) {
    const nome     = row.querySelector('.g-nome')?.value.trim();
    const cognome  = row.querySelector('.g-cognome')?.value.trim();
    const telefono = row.querySelector('.g-tel')?.value.trim();
    if (!nome || !cognome || !telefono) return toast('Nome, cognome e telefono obbligatori per ogni persona');
    guests.push({nome, cognome, email: row.querySelector('.g-email')?.value.trim()||null, telefono});
  }
  if (!guests.length) return toast('Aggiungi almeno una persona');
  const btn = document.getElementById('ev-reg-btn');
  btn.disabled = true; btn.textContent = 'Registrazione…';
  const {data, error} = await db.rpc('register_event_guests', {p_event_id: _publicEvent.id, p_guests: guests});
  btn.disabled = false; btn.textContent = 'Registra';
  if (error || !data.ok) return toast((error&&error.message)||data.error);
  document.getElementById('ev-reg-area').style.display = 'none';
  document.getElementById('ev-reg-msg').textContent = data.message + (_publicEvent.price>0?' Se non hai ancora pagato, usa il link sopra.':'');
  document.getElementById('ev-reg-success').style.display = 'block';
  toast('Registrazione confermata!', 'ok');
}

// ── REGISTRAZIONE ────────────────────────────────────────────────────
function showRegister() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('register-view').style.display = '';
  document.getElementById('reg-form-area').style.display = 'block';
  document.getElementById('reg-success').style.display = 'none';
}
function showLogin() {
  document.getElementById('register-view').style.display = 'none';
  document.getElementById('login-view').style.display = '';
}
function _toggleClaimMode(isClaim) {
  document.getElementById('r-card-wrap').style.display = isClaim ? 'block' : 'none';
  const btn = document.getElementById('reg-btn');
  if (btn) btn.textContent = isClaim ? 'Attiva la mia tessera' : 'Crea la mia card';
}
function _isClaimMode() {
  const el = document.querySelector('input[name="r-mode"]:checked');
  return el && el.value === 'claim';
}
async function doRegister() {
  const claim   = _isClaimMode();
  const nome    = document.getElementById('r-nome').value.trim();
  const cognome = document.getElementById('r-cognome').value.trim();
  const cf      = document.getElementById('r-cf').value.trim();
  const email   = document.getElementById('r-email').value.trim();
  const tel     = document.getElementById('r-tel').value.trim();
  const pin     = document.getElementById('r-pin').value;
  const pin2    = document.getElementById('r-pin2').value;
  const gdpr1   = document.getElementById('r-gdpr1').checked;
  const gdpr2   = document.getElementById('r-gdpr2').checked;
  const gdpr3   = document.getElementById('r-gdpr3').checked;
  const gdpr4   = document.getElementById('r-gdpr4').checked;
  const cardIn  = document.getElementById('r-card').value.trim().toUpperCase();

  if (claim && !cardIn) return toast('Inserisci il codice tessera (es. SH-015)');
  if (!nome || !cognome || !cf || !email) return toast('Compila tutti i campi obbligatori (*)');
  if (pin !== pin2) return toast('I PIN non coincidono');
  if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) return toast('Il PIN deve essere di 4-6 cifre numeriche');
  if (!gdpr1 || !gdpr2) return toast('Accetta i consensi obbligatori per continuare');

  const btn = document.getElementById('reg-btn');
  const btnLabel = claim ? 'Attiva la mia tessera' : 'Crea la mia card';
  btn.disabled = true; btn.textContent = claim ? 'Attivazione in corso…' : 'Creazione in corso…';

  let data, error;
  if (claim) {
    ({data, error} = await db.rpc('claim_account', {
      p_card_id: cardIn,
      p_nome: nome, p_cognome: cognome, p_codice_fiscale: cf,
      p_email: email, p_telefono: tel || null, p_pin: pin,
      p_gdpr_trattamento: gdpr1, p_gdpr_privacy_letta: gdpr2,
      p_gdpr_comunicazioni: gdpr3, p_gdpr_immagini: gdpr4
    }));
  } else {
    ({data, error} = await db.rpc('public_register', {
      p_nome: nome, p_cognome: cognome, p_codice_fiscale: cf,
      p_email: email, p_telefono: tel || null, p_pin: pin,
      p_gdpr_trattamento: gdpr1, p_gdpr_privacy: gdpr2,
      p_gdpr_comunicazioni: gdpr3, p_gdpr_immagini: gdpr4
    }));
  }

  btn.disabled = false; btn.textContent = btnLabel;

  if (error) return toast(error.message);
  if (!data || !data.ok) {
    const code = data && data.error;
    if (code === 'already_claimed') return toast('Questa tessera è già registrata. Accedi con il PIN.');
    if (code === 'not_found')       return toast('Tessera non trovata. Verifica il codice.');
    return toast((data && (data.message || data.error)) || 'Errore');
  }

  document.getElementById('reg-form-area').style.display = 'none';
  document.getElementById('reg-success-code').textContent = data.card_id;
  const successBox = document.getElementById('reg-success');
  successBox.style.display = 'block';
  if (claim) {
    successBox.querySelector('div[style*="font-size:40px"]').textContent = '✨';
    successBox.querySelector('div[style*="font-weight:700"]').textContent = 'Tessera attivata!';
    const info = successBox.querySelector('div[style*="margin-bottom:16px"]');
    if (info) info.innerHTML = `Ciao <strong>${_esc(data.display_name || '')}</strong>!<br>Il tuo saldo residuo è <strong style="color:var(--gold)">${eur(data.balance||0)}</strong>.<br>Il tuo codice tessera è:`;
    toast('Tessera attivata con successo!', 'ok');
  } else {
    toast('Tessera creata con successo!', 'ok');
  }
}

// ── RESET PIN ────────────────────────────────────────────────────────
let _pinCard = null;
function openPinModal(cardId) {
  _pinCard = cardId;
  document.getElementById('pin-modal-card').textContent = cardId;
  document.getElementById('pin-modal-val').value = '';
  document.getElementById('pin-modal-bg').classList.add('open');
}
function closePinModal() {
  document.getElementById('pin-modal-bg').classList.remove('open');
  _pinCard = null;
}
async function doResetPin() {
  const pin = document.getElementById('pin-modal-val').value.trim();
  if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) return toast('PIN deve essere 4-6 cifre');
  const {data, error} = await db.rpc('admin_reset_pin', {p_card_id: _pinCard, p_new_pin: pin});
  if (error || !data.ok) return toast((error&&error.message)||data.error);
  toast(data.message, 'ok');
  closePinModal();
}

// ── EVENTI OSPITI ────────────────────────────────────────────────────
async function adminCheckinReg(regId, btn) {
  btn.disabled = true; btn.textContent = '⏳';
  const {data, error} = await db.rpc('staff_checkin_event', {p_operator_id:currentUser.id, p_registration_id:regId});
  if (error || !data.ok) { btn.disabled=false; btn.textContent='Check-in'; return toast((error&&error.message)||data.error); }
  toast(data.already_in ? 'Già presente' : `✅ ${data.message}`, 'ok');
  btn.parentElement.innerHTML = `<span style="color:var(--grn);font-weight:700">✅</span>`;
}
async function adminCheckinGuest(guestId, btn) {
  btn.disabled = true; btn.textContent = '⏳';
  const {data, error} = await db.rpc('staff_checkin_guest', {p_operator_id:currentUser.id, p_guest_id:guestId});
  if (error || !data.ok) { btn.disabled=false; btn.textContent='Check-in'; return toast((error&&error.message)||data.error); }
  toast(data.already_in ? 'Già presente' : `✅ ${data.message}`, 'ok');
  btn.parentElement.innerHTML = `<span style="color:var(--grn);font-weight:700">✅</span>`;
}
async function adminCheckinRegBtn(regId, eventName, btn) {
  btn.disabled = true; btn.textContent = '⏳';
  const {data, error} = await db.rpc('staff_checkin_event', {p_operator_id:currentUser.id, p_registration_id:regId});
  if (error || !data.ok) { btn.disabled=false; btn.textContent='✅ Check-in'; return toast((error&&error.message)||data.error); }
  toast(data.already_in ? 'Già presente' : `✅ ${data.message}`, 'ok');
  btn.textContent = '✅ Fatto'; btn.style.opacity='0.5'; btn.disabled=true;
  if (staffTarget) await loadAcCheckin(staffTarget.card_id);
}
async function loadEvDash(eventId) {
  const el = document.getElementById('ev-dash-' + eventId);
  if (!el) return;
  const {data, error} = await db.rpc('admin_event_dashboard', {p_event_id: eventId});
  if (error || !data || !data.ok) { el.innerHTML='<span style="font-size:11px;color:var(--mut)">—</span>'; return; }
  el.innerHTML = `
    <div class="ev-kpi"><span class="ev-kpi-n">${data.total_iscritti}</span><span class="ev-kpi-l">👥 Iscritti</span></div>
    <div class="ev-kpi"><span class="ev-kpi-n" style="color:var(--grn)">${data.total_paganti}</span><span class="ev-kpi-l">💰 Paganti · ${eur(data.incasso_totale)}</span></div>
    <div class="ev-kpi"><span class="ev-kpi-n" style="color:var(--gold)">${data.total_presenti}</span><span class="ev-kpi-l">✅ Presenti</span></div>`;
}
async function toggleEventGuests(eventId, eventTitle, btn) {
  const el = document.getElementById('guests-' + eventId);
  if (el.style.display !== 'none') { el.style.display='none'; btn.textContent='👥 Iscritti'; return; }
  el.style.display = 'block';
  btn.textContent = '⏳ Carico…';
  const {data, error} = await db.rpc('admin_list_event_registrations', {p_event_id: eventId});
  btn.textContent = '👥 Nascondi';
  if (error) { el.innerHTML=`<div class="empty">${error.message}</div>`; return; }
  el.innerHTML = _buildGuestHtml(data, eventId, 'admin');
}
function _buildGuestHtml(data, eventId, context) {
  const soci = data.soci || [], ospiti = data.ospiti || [], total = data.total || 0;
  const statusColor = s => s==='saldato_credito'||s==='saldato_sumup'||s==='saldato_contanti' ? 'var(--grn)' : s==='da_saldare' ? 'var(--gold)' : 'var(--mut)';
  const statusLabel = s => ({da_saldare:'Da saldare',saldato_credito:'Credito',saldato_sumup:'SumUp',saldato_contanti:'Contanti',annullato:'Annullato',gratuito:'Gratuito'}[s]||s);
  const payBtns = (regId, name, amt) => `<div style="display:flex;gap:3px;margin-top:4px">
    <button class="btn-sm p" style="font-size:10px;padding:2px 6px" onclick="payRegFromList('${regId}','credito','${name}',${amt},'${eventId}','${context}')">💳</button>
    <button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="payRegFromList('${regId}','contanti','${name}',${amt},'${eventId}','${context}')">💵</button>
    <button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="payRegFromList('${regId}','sumup','${name}',${amt},'${eventId}','${context}')">📱</button>
  </div>`;
  const guestPayBtns = (gId, name, amt) => `<div style="display:flex;gap:3px;margin-top:4px">
    <button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="payGuestFromList('${gId}','contanti','${name}',${amt},'${eventId}','${context}')">💵</button>
    <button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="payGuestFromList('${gId}','sumup','${name}',${amt},'${eventId}','${context}')">📱</button>
  </div>`;
  // Popola mappa companions per staffManageCompanions
  window._guestCompMap = window._guestCompMap || {};
  soci.forEach(r => { window._guestCompMap[r.registration_id] = r.companions || []; });
  const totalPersons = soci.reduce((s,r) => s + (r.party_size||1), 0) + ospiti.length;
  let html = `<div style="font-size:12px;color:var(--mut);margin-bottom:8px">${totalPersons} persone totali (${soci.length+ospiti.length} iscrizioni)</div>`;
  if (soci.length) {
    html += `<div class="sec-lbl" style="margin-bottom:6px">Soci (${soci.length})</div>`;
    html += `<div class="tbl-wrap"><table><thead><tr><th>Tessera</th><th>Nome</th><th>€</th><th>Stato</th><th>Gruppo</th><th>Check-in</th></tr></thead><tbody>`
      + soci.map(r => {
          const dn  = _esc(r.display_name||'').replace(/'/g,"\\'");
          const pSz = r.party_size || 1;
          const companions = r.companions || [];
          const _pcb = (cId, cName, rId) => `<div style="display:flex;gap:3px;margin-top:3px">
            <button class="btn-sm p" style="font-size:10px;padding:2px 5px" onclick="payCompanionFromList('${cId}','credito','${cName}','${rId}','${eventId}','${context}')">💳</button>
            <button class="btn-sm" style="font-size:10px;padding:2px 5px" onclick="payCompanionFromList('${cId}','contanti','${cName}','${rId}','${eventId}','${context}')">💵</button>
            <button class="btn-sm" style="font-size:10px;padding:2px 5px" onclick="payCompanionFromList('${cId}','sumup','${cName}','${rId}','${eventId}','${context}')">📱</button>
          </div>`;
          const compRows = companions.map(c => {
            const cn = (`${_esc(c.nome)} ${_esc(c.cognome)}`).replace(/'/g,"\\'");
            const ps = c.payment_status || 'da_saldare';
            return `<tr style="background:rgba(255,214,10,.04)">
              <td colspan="2" style="padding-left:22px;font-size:12px;color:var(--mut)">↳ ${_esc(c.nome)} ${_esc(c.cognome)}</td>
              <td></td>
              <td style="font-size:11px;color:${statusColor(ps)}">
                ${statusLabel(ps)}
                ${ps==='da_saldare' ? _pcb(c.id, cn, r.registration_id) : ''}
              </td>
              <td></td>
              <td>${c.checked_in
                ? `<span style="color:var(--grn);font-weight:700">✅</span>`
                : `<button class="btn-sm" style="font-size:11px" onclick="checkinCompanion('${c.id}','${eventId}','${context}',this)">Check-in</button>`}</td>
            </tr>`;
          }).join('');
          return `<tr>
            <td class="mono">${r.card_id}</td>
            <td>${_esc(r.display_name||'')}</td>
            <td>${eur(r.amount)}</td>
            <td style="color:${statusColor(r.payment_status)}">
              ${statusLabel(r.payment_status)}
              ${r.payment_status==='da_saldare' ? payBtns(r.registration_id, dn, r.amount) : ''}
            </td>
            <td style="white-space:nowrap">
              ${pSz>1?`<span style="color:var(--gold);font-weight:700">👥 ${pSz}</span>`:'—'}
              <button class="btn-sm" style="font-size:10px;padding:2px 5px;margin-top:2px" onclick="staffManageCompanions('${r.registration_id}','${eventId}','${context}')">✏️</button>
            </td>
            <td>${r.checked_in
              ? `<span style="color:var(--grn);font-weight:700">✅</span>`
              : `<button class="btn-sm" onclick="adminCheckinReg('${r.registration_id}',this)">Check-in</button>`}</td>
          </tr>${compRows}`;
        }).join('')
      + `</tbody></table></div>`;
  }
  if (ospiti.length) {
    html += `<div class="sec-lbl" style="margin:10px 0 6px">Ospiti (${ospiti.length})</div>`;
    html += `<div class="tbl-wrap"><table><thead><tr><th>Nome</th><th>Cognome</th><th>Tel</th><th>€</th><th>Stato</th><th>Check-in</th></tr></thead><tbody>`
      + ospiti.map(g => {
          const nc = _esc((g.nome+' '+g.cognome).replace(/'/g,"\\'"));
          return `<tr>
            <td>${_esc(g.nome)}</td><td>${_esc(g.cognome)}</td>
            <td style="font-size:12px">${g.telefono||'—'}</td>
            <td>${eur(g.amount||0)}</td>
            <td style="color:${statusColor(g.payment_status)}">
              ${statusLabel(g.payment_status)}
              ${g.payment_status==='da_saldare'&&(g.amount||0)>0 ? guestPayBtns(g.id, nc, g.amount||0) : ''}
            </td>
            <td>${g.checked_in
              ? `<span style="color:var(--grn);font-weight:700">✅</span>`
              : `<button class="btn-sm" onclick="adminCheckinGuest('${g.id}',this)">Check-in</button>`}</td>
          </tr>`;
        }).join('')
      + `</tbody></table></div>`;
  }
  if (!soci.length && !ospiti.length) html += '<div class="empty">Nessun iscritto</div>';
  return html;
}
async function payRegFromList(regId, method, displayName, amount, eventId, context) {
  const label = {credito:'credito',contanti:'contanti',sumup:'SumUp'}[method]||method;
  modalConfirm(`Salda "${displayName}" (${eur(amount)}) con ${label}?`, async () => {
    const {data, error} = await db.rpc('staff_pay_event', {p_operator_id: currentUser.id, p_registration_id: regId, p_method: method});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(`✓ ${data.message}`, 'ok');
    if (context === 'admin') await _reloadAdminEventGuests(eventId);
    else await _reloadStaffEventGuests(eventId);
  });
}
async function payGuestFromList(guestId, method, nomeCog, amount, eventId, context) {
  const label = {contanti:'contanti',sumup:'SumUp'}[method]||method;
  modalConfirm(`Salda "${nomeCog}" (${eur(amount)}) con ${label}?`, async () => {
    const {data, error} = await db.rpc('staff_pay_event_guest', {p_operator_id: currentUser.id, p_guest_id: guestId, p_method: method});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast(`✓ ${data.message}`, 'ok');
    if (context === 'admin') await _reloadAdminEventGuests(eventId);
    else await _reloadStaffEventGuests(eventId);
  });
}
async function _reloadAdminEventGuests(eventId) {
  const el = document.getElementById('guests-' + eventId);
  if (!el || el.style.display === 'none') return;
  const {data} = await db.rpc('admin_list_event_registrations', {p_event_id: eventId});
  if (data) { el.innerHTML = _buildGuestHtml(data, eventId, 'admin'); loadEvDash(eventId); }
}
async function _reloadStaffEventGuests(eventId) {
  const el = document.getElementById('sev-guests-' + eventId);
  if (!el || el.style.display === 'none') return;
  const {data} = await db.rpc('admin_list_event_registrations', {p_event_id: eventId});
  if (data) { el.innerHTML = _buildGuestHtml(data, eventId, 'staff'); loadStaffEvDash(eventId); }
}
async function exportEventCSV(eventId, eventTitle) {
  const {data, error} = await db.rpc('admin_export_event_csv', {p_event_id: eventId});
  if (error) return toast(error.message);
  const raw = (data && Array.isArray(data.iscritti)) ? data.iscritti : [];
  if (!raw.length) return toast('Nessun iscritto da esportare');
  const statusLabel = s => ({da_saldare:'Da saldare',saldato_credito:'Credito',saldato_sumup:'SumUp',saldato_contanti:'Contanti',annullato:'Annullato',gratuito:'Gratuito'}[s]||s||'—');
  const rows = raw.map(r => ({
    tipo:            r.tipo||'',
    tessera:         r.card_id||'',
    nome:            r.nome||'',
    cognome:         r.cognome||'',
    telefono:        r.telefono||'',
    email:           r.email||'',
    importo:         Number(r.amount||0).toFixed(2),
    stato_pagamento: statusLabel(r.payment_status),
    presenza:        r.checked_in ? 'Sì' : 'No',
    operatore:       r.operatore||''
  }));
  const today = new Date().toISOString().slice(0,10);
  const safeName = (eventTitle||'evento').replace(/[^a-zA-Z0-9]/g,'_').toLowerCase();
  downloadCSV(rows, `iscritti_${safeName}_${today}.csv`);
}

// ── EXPORT CSV ────────────────────────────────────────────────────────
function downloadCSV(rows, filename) {
  if (!rows || !rows.length) return toast('Nessun dato da esportare');
  const bom = '﻿';
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(';')].concat(rows.map(r => keys.map(k => '"' + String(r[k]??'').replace(/"/g,'""') + '"').join(';')));
  const blob = new Blob([bom + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
async function exportCSVUsers() {
  const {data, error} = await db.rpc('admin_export_all');
  if (error) return toast(error.message);
  const today = new Date().toISOString().slice(0,10);
  downloadCSV(data.users, `shanghai_card_utenti_${today}.csv`);
}
async function exportCSVTx() {
  const {data, error} = await db.rpc('admin_export_all');
  if (error) return toast(error.message);
  const today = new Date().toISOString().slice(0,10);
  downloadCSV(data.transactions, `shanghai_card_transazioni_${today}.csv`);
}

// ── GUIDA IN-APP ─────────────────────────────────────────────────────
const _GUIDE = {
  user: `<h3 style="color:var(--gold);margin:0 0 16px">🎴 LA TUA SHANGHAI CARD — Guida</h3>
<p><strong>📱 HOME</strong><br>
• Vedi il tuo saldo disponibile<br>
• Mostra il QR code allo staff per ricariche e pagamenti</p>
<p><strong>💳 RICARICA</strong><br>
• Ricarica la tua card con SumUp (€5, €10, €20, €50)<br>
• Dopo il pagamento SumUp, lo staff accrediterà il saldo sulla tua tessera</p>
<p><strong>📋 MOVIMENTI</strong><br>
• Consulta lo storico di tutte le tue transazioni<br>
• Filtra per tipo (ricarica, spesa, evento) e periodo</p>
<p><strong>🎪 EVENTI</strong><br>
• Sfoglia gli eventi del Rione<br>
• Clicca "Iscriviti" per prenotare il tuo posto<br>
• Dopo l'iscrizione scegli come pagare:<br>
&nbsp;&nbsp;- 💳 Credito: paga subito col saldo della card<br>
&nbsp;&nbsp;- 📱 SumUp: paga online (lo staff confermerà)<br>
&nbsp;&nbsp;- 🏠 In cassa: paghi di persona alla cassa<br>
• Gli eventi gratuiti si prenotano con un click<br>
• Dopo l'iscrizione usa "👥 Gestisci gruppo" per aggiungere accompagnatori con nome e cognome<br>
• Puoi rimuovere un accompagnatore solo prima del pagamento</p>
<p><strong>🛍️ GADGET</strong><br>
• Scegli il gadget e la quantità [−][N][+] direttamente nel modale di prenotazione<br>
• Ritira e paga in cassa da Antonella</p>
<p><strong>💳 SUMUP</strong><br>
• Trovi i link SumUp per ricariche e servizi nella sezione Catalogo → SumUp<br>
• Dopo il pagamento online, segnala allo staff per l'accredito</p>
<p><strong>👤 PROFILO</strong><br>
• Vedi i tuoi dati, la tessera e il QR<br>
• Cambia il PIN<br>
• Scegli tema chiaro o scuro</p>
<p><strong>📤 INVITA GLI AMICI</strong><br>
• Condividi l'app col link breve: <a href="https://bit.ly/shanghai-card" target="_blank" rel="noopener" style="color:var(--gold)">bit.ly/shanghai-card</a><br>
• Suggerisci "Aggiungi a Home" dopo l'apertura — l'app si installa come una vera app</p>`,

  staff: `<h3 style="color:var(--gold);margin:0 0 16px">🏪 GUIDA CASSA — Staff</h3>
<p><strong>📷 CERCA SOCIO</strong><br>
• Scansiona il QR code del socio o digita il numero tessera<br>
• Vedi: saldo, eventi da saldare, ultime transazioni</p>
<p><strong>💰 RICARICA</strong><br>
• Ricarica rapida: €5, €10, €20, €50<br>
• Ricarica manuale: inserisci un importo personalizzato<br>
• Il saldo si aggiorna immediatamente</p>
<p><strong>💸 ADDEBITO</strong><br>
• Addebita una consumazione o un servizio<br>
• Se c'è una promo attiva, il sistema te lo mostra PRIMA della conferma<br>
• Inserisci importo e descrizione, conferma nel popup</p>
<p><strong>🎪 EVENTI — DA SALDARE</strong><br>
• Dopo il lookup del socio, vedi i suoi eventi "da saldare"<br>
• Per ogni evento scegli il metodo di pagamento:<br>
&nbsp;&nbsp;- 💳 Credito: scala dal saldo del socio<br>
&nbsp;&nbsp;- 📱 SumUp: conferma che ha pagato con SumUp<br>
&nbsp;&nbsp;- 💵 Contanti: conferma pagamento in contanti<br>
• Ogni operazione registra chi ha operato e come</p>
<p><strong>📋 GESTIONE EVENTI (Catalogo)</strong><br>
• Vedi tutti gli eventi con il cruscotto: 👥 Persone / 💰 Paganti / ✅ Presenti<br>
• Il contatore 👥 somma le persone per gruppo (es. 1 iscrizione da 3 = 3 persone)<br>
• Click su "👥 Iscritti" → lista con colonna Gruppo: n. persone + nomi accompagnatori<br>
• ✏️ nella colonna Gruppo: gestisci accompagnatori (aggiungi/rimuovi nome e cognome)<br>
• Righe ↳ sotto ogni socio = accompagnatori con check-in individuale<br>
• 💰 Salda direttamente dalla lista: 💳 credito, 💵 contanti, 📱 SumUp<br>
• ✅ Check-in per socio e per ogni accompagnatore singolarmente<br>
• 📥 CSV: una riga per persona (soci, accompagnatori, ospiti separati)<br>
• 🔒/🔓: nascondi o mostra un evento</p>
<p><strong>🏷️ PROMO</strong><br>
• Vedi le promo attive — le promo si applicano automaticamente sugli addebiti<br>
• Solo l'admin può creare/modificare/eliminare promo</p>
<p><strong>📤 INVITA NUOVI SOCI</strong><br>
• Link app per passaparola e volantini: <a href="https://bit.ly/shanghai-card" target="_blank" rel="noopener" style="color:var(--gold)">bit.ly/shanghai-card</a></p>`,

  admin: `<h3 style="color:var(--gold);margin:0 0 16px">⚙️ GUIDA AMMINISTRAZIONE</h3>
<p><strong>📊 DASHBOARD</strong><br>
• Panoramica: soci totali, saldo totale, transazioni del periodo<br>
• Grafico ricariche vs spese con filtro periodo (7/14/30/60 giorni)</p>
<p><strong>🏪 CASSA</strong><br>
• Tutte le funzioni dello staff: cerca socio, ricarica, addebita, salda eventi<br>
• Funziona da QR scan o ricerca tessera</p>
<p><strong>👥 SOCI</strong><br>
• Lista completa dei soci con saldo e ruolo<br>
• 🔑 Reset PIN di un socio<br>
• Crea nuovi soci manualmente</p>
<p><strong>📋 TRANSAZIONI</strong><br>
• Storico completo con filtri tipo+periodo e ricerca per tessera/nome<br>
• 📥 Esporta in CSV per Excel</p>
<p><strong>🎪 EVENTI (Gestione)</strong><br>
• Crea nuovo evento: titolo, data, luogo, prezzo, posti, link SumUp, slug<br>
• 🌐 "Apri iscrizioni esterne": genera link pubblico (?event=slug) con copia<br>
• Il link appare anche in lista per condivisione rapida<br>
• Cruscotto: 👥 Persone totali (SUM party_size) / 💰 Paganti / ✅ Presenti (inclusi accompagnatori)<br>
• Lista iscritti: colonna Gruppo con n. persone + nomi; righe ↳ per ogni accompagnatore<br>
• ✏️ Gestisci accompagnatori: aggiungi/rimuovi nome e cognome di ogni persona<br>
• ✅ Check-in per socio e per ogni accompagnatore singolarmente<br>
• 💰 Salda dalla lista: 💳 credito, 💵 contanti, 📱 SumUp<br>
• 📥 CSV: una riga per persona (tipo: socio/accompagnatore/ospite)<br>
• 🔒 Nascondi eventi passati dalla vista socio/staff</p>
<p><strong>🛍️ GADGET</strong><br>
• Crea e gestisci i gadget del Rione (nome, prezzo, stock, descrizione)</p>
<p><strong>🏷️ PROMO</strong><br>
• Crea nuove promo (percentuale o importo fisso)<br>
• ✏️ Modifica o 🗑️ Elimina promo (solo admin)<br>
• Le promo attive si applicano automaticamente</p>
<p><strong>💳 SUMUP</strong><br>
• Gestisci i link SumUp del Rione (etichetta, URL, importo opzionale)<br>
• I link sono visibili ai soci nella sezione Catalogo → SumUp</p>
<p><strong>📥 EXPORT</strong><br>
• Esporta tutti i dati (soci, transazioni, iscritti eventi) in CSV</p>
<p><strong>📤 LINK APP</strong><br>
• Link breve per volantini, social, passaparola: <a href="https://bit.ly/shanghai-card" target="_blank" rel="noopener" style="color:var(--gold)">bit.ly/shanghai-card</a></p>`
};
function openGuide(role) {
  document.getElementById('guide-content').innerHTML = _GUIDE[role] || '';
  document.getElementById('guide-bg').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeGuide() {
  document.getElementById('guide-bg').style.display = 'none';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if(e.key==='Escape') closeGuide(); });

async function createPromo() {
  const code  = document.getElementById('fp-code').value.trim().toUpperCase();
  const desc  = document.getElementById('fp-desc').value.trim();
  const type  = document.getElementById('fp-type').value;
  const val   = parseInt(document.getElementById('fp-val').value);
  const until = document.getElementById('fp-until').value;
  const maxu  = parseInt(document.getElementById('fp-maxu').value)||null;
  const img   = document.getElementById('fp-img').value.trim();
  if (!code||!val) return toast('Inserisci codice e valore');
  const {data, error} = await db.rpc('admin_create_promo', {p_code:code, p_description:desc||null, p_discount_type:type, p_discount_value:val, p_valid_until:until?new Date(until+'T23:59:59').toISOString():null, p_max_uses:maxu});
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  if (img && data.promo_id) {
    await db.rpc('admin_set_promo_image', {p_admin_id: currentUser.id, p_promo_id: data.promo_id, p_image_url: img});
  }
  toast('Promo creata!', 'ok');
  ['fp-code','fp-desc','fp-val','fp-until','fp-maxu','fp-img'].forEach(id=>document.getElementById(id).value='');
  resetImageUploader('fp-img-mount');
  document.getElementById('fp-form').style.display='none';
  loadAGest();
}
function openEditPromo(id, code, desc, type, val, until) {
  document.getElementById('fpe-id').value   = id;
  document.getElementById('fpe-code').value = code;
  document.getElementById('fpe-desc').value = desc;
  document.getElementById('fpe-type').value = type;
  document.getElementById('fpe-val').value  = val;
  document.getElementById('fpe-until').value= until;
  const pCached = (typeof _promosAdminCache !== 'undefined' && _promosAdminCache[id]) || {};
  const curImg = pCached.image_url || '';
  document.getElementById('fpe-img').value = curImg;
  setImageUploaderPreview('fpe-img-mount', curImg);
  document.getElementById('fpe-bg').style.display = 'block';
}
function closeEditPromo() {
  document.getElementById('fpe-bg').style.display = 'none';
}
async function saveEditPromo() {
  const id    = document.getElementById('fpe-id').value;
  const code  = document.getElementById('fpe-code').value.trim().toUpperCase();
  const desc  = document.getElementById('fpe-desc').value.trim();
  const type  = document.getElementById('fpe-type').value;
  const val   = parseFloat(document.getElementById('fpe-val').value);
  const until = document.getElementById('fpe-until').value;
  const img   = document.getElementById('fpe-img').value.trim();
  if (!code || !val) return toast('Codice e valore obbligatori');
  const {data, error} = await db.rpc('admin_update_promo', {
    p_admin_id: currentUser.id, p_promo_id: id,
    p_code: code, p_description: desc||null, p_type: type, p_value: val,
    p_valid_until: until || null
  });
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  const cachedImg = ((typeof _promosAdminCache !== 'undefined' && _promosAdminCache[id]) || {}).image_url || '';
  if (img !== cachedImg) {
    await db.rpc('admin_set_promo_image', {p_admin_id: currentUser.id, p_promo_id: id, p_image_url: img || null});
  }
  toast('Promo aggiornata!', 'ok');
  closeEditPromo();
  if (currentUser.role === 'admin') loadAGest(); else loadStaffPromos();
}
async function deletePromo(id, code) {
  modalConfirm(`Eliminare la promo [${code}]?`, async () => {
    const {data, error} = await db.rpc('admin_delete_promo', {p_admin_id: currentUser.id, p_promo_id: id});
    if (error||!data.ok) return toast((error&&error.message)||data.error);
    toast('Promo eliminata', 'ok');
    loadAGest();
  });
}

// =====================================================================
// ADMIN EXTENSIONS (17/07/2026)
// Aggiunte: image uploader, edit socio, delete socio, edit evento,
// storno/edit transazione, popup nuovi eventi per soci.
// =====================================================================

// ── IMAGE UPLOADER ──────────────────────────────────────────────────
async function uploadImageToBucket(file, folder) {
  if (!file) return null;
  if (file.size > 2 * 1024 * 1024) { toast('Immagine troppo grande (max 2 MB)'); return null; }
  const ok = ['image/jpeg','image/png','image/webp'].includes(file.type);
  if (!ok) { toast('Formato non supportato (jpg, png, webp)'); return null; }
  const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
  const name = `${crypto.randomUUID()}.${ext}`;
  const path = `${folder}/${name}`;
  const { error } = await db.storage.from('images').upload(path, file, {
    cacheControl: '31536000', upsert: false, contentType: file.type
  });
  if (error) { console.error('upload error', error); toast('Upload fallito: ' + error.message); return null; }
  const { data } = db.storage.from('images').getPublicUrl(path);
  return data?.publicUrl || null;
}
function mountImageUploader(mountId, hiddenId, folder) {
  const host = document.getElementById(mountId);
  if (!host) return;
  host.dataset.folder = folder;
  host.dataset.hidden = hiddenId;
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label class="btn-sm" style="cursor:pointer;margin:0">
        📷 Scegli immagine
        <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="_onImagePicked(this,'${mountId}')">
      </label>
      <button type="button" class="btn-sm" style="color:var(--neg);display:none" data-role="rm" onclick="_clearImage('${mountId}')">🗑️ Rimuovi</button>
      <span data-role="status" style="font-size:11px;color:var(--mut)"></span>
    </div>
    <div data-role="preview" style="margin-top:8px;display:none">
      <img data-role="img" src="" style="max-width:100%;max-height:140px;border-radius:8px;border:1px solid var(--brd)">
    </div>`;
}
function setImageUploaderPreview(mountId, url) {
  const host = document.getElementById(mountId);
  if (!host) return;
  const preview = host.querySelector('[data-role="preview"]');
  const img = host.querySelector('[data-role="img"]');
  const rm = host.querySelector('[data-role="rm"]');
  if (url) { img.src = url; preview.style.display = 'block'; if (rm) rm.style.display = ''; }
  else { img.src = ''; preview.style.display = 'none'; if (rm) rm.style.display = 'none'; }
}
function resetImageUploader(mountId) {
  const host = document.getElementById(mountId);
  if (!host) return;
  const hiddenId = host.dataset.hidden;
  if (hiddenId) { const h = document.getElementById(hiddenId); if (h) h.value = ''; }
  setImageUploaderPreview(mountId, '');
  const status = host.querySelector('[data-role="status"]');
  if (status) status.textContent = '';
}
async function _onImagePicked(input, mountId) {
  const file = input.files && input.files[0];
  if (!file) return;
  const host = document.getElementById(mountId);
  const status = host.querySelector('[data-role="status"]');
  const folder = host.dataset.folder || 'misc';
  const hiddenId = host.dataset.hidden;
  status.textContent = 'Carico…';
  const url = await uploadImageToBucket(file, folder);
  input.value = ''; // reset per permettere upload dello stesso file dopo
  if (!url) { status.textContent = ''; return; }
  if (hiddenId) { const h = document.getElementById(hiddenId); if (h) h.value = url; }
  setImageUploaderPreview(mountId, url);
  status.textContent = '✓ Caricata';
  setTimeout(() => { status.textContent = ''; }, 2000);
}
function _clearImage(mountId) {
  resetImageUploader(mountId);
}

// ── EDIT SOCIO ──────────────────────────────────────────────────────
function openEditUser(userId) {
  const u = (allAdminUsers || []).find(x => x.id === userId);
  if (!u) { toast('Utente non trovato'); return; }
  document.getElementById('ue-id').value      = u.id;
  document.getElementById('ue-card').textContent = u.card_id || '';
  document.getElementById('ue-display').value = u.display_name || '';
  document.getElementById('ue-nome').value    = u.nome || '';
  document.getElementById('ue-cognome').value = u.cognome || '';
  document.getElementById('ue-email').value   = u.email || '';
  document.getElementById('ue-tel').value     = u.telefono || '';
  document.getElementById('ue-role').value    = u.role || 'user';
  document.getElementById('ue-active').value  = String(u.active !== false);
  document.getElementById('u-edit-bg').style.display = 'block';
}
function closeEditUser() {
  document.getElementById('u-edit-bg').style.display = 'none';
}
async function saveEditUser() {
  const id = document.getElementById('ue-id').value;
  if (!id) return;
  const payload = {
    p_admin_id:    currentUser.id,
    p_user_id:     id,
    p_display_name:document.getElementById('ue-display').value.trim() || null,
    p_nome:        document.getElementById('ue-nome').value.trim() || null,
    p_cognome:     document.getElementById('ue-cognome').value.trim() || null,
    p_email:       document.getElementById('ue-email').value.trim() || null,
    p_telefono:    document.getElementById('ue-tel').value.trim() || null,
    p_role:        document.getElementById('ue-role').value,
    p_active:      document.getElementById('ue-active').value === 'true'
  };
  const { data, error } = await db.rpc('admin_update_user', payload);
  if (error) return toast(error.message);
  if (!data || !data.ok) return toast(data?.error || 'Errore');
  toast('Socio aggiornato', 'ok');
  closeEditUser();
  loadAUsers();
}

// ── DELETE SOCIO ────────────────────────────────────────────────────
async function adminDeleteUser(userId, cardId, displayName) {
  modalConfirm(`Eliminare il socio ${cardId} – ${displayName}?\n\nOperazione irreversibile.`, async () => {
    const { data, error } = await db.rpc('admin_delete_user', {p_admin_id: currentUser.id, p_user_id: userId});
    if (error) return modalInfo('❌ Errore\n\n' + error.message);
    if (!data || !data.ok) {
      const code = data?.error;
      if (code === 'cannot_delete_admin')     return modalInfo('❌ Impossibile eliminare\n\nNon si può eliminare un amministratore.');
      if (code === 'has_transactions')        return _offerDeactivate(userId, cardId, `Il socio ha ${data.count} transazioni collegate. Non può essere eliminato per motivi contabili.`);
      if (code === 'has_event_registrations') return _offerDeactivate(userId, cardId, `Il socio ha ${data.count} iscrizioni a eventi. Non può essere eliminato.`);
      if (code === 'not_found')               return modalInfo('❌ Socio non trovato');
      return modalInfo('❌ Errore\n\n' + (code || 'sconosciuto'));
    }
    toast('Socio eliminato', 'ok');
    loadAUsers();
  });
}
function _offerDeactivate(userId, cardId, reasonMsg) {
  modalConfirm(`${reasonMsg}\n\nVuoi disattivarlo invece?`, async () => {
    const { data, error } = await db.rpc('admin_update_user', {p_admin_id: currentUser.id, p_user_id: userId, p_active: false});
    if (error || !data?.ok) return toast(error?.message || data?.error || 'Errore');
    toast(`${cardId} disattivato`, 'ok');
    loadAUsers();
  });
}

// ── EDIT EVENTO ─────────────────────────────────────────────────────
function openEditEvent(eventId) {
  const e = _eventsAdminCache[eventId];
  if (!e) { toast('Evento non trovato'); return; }
  document.getElementById('eve-id').value    = e.id;
  document.getElementById('eve-title').value = e.title || '';
  document.getElementById('eve-desc').value  = e.description || '';
  // datetime-local vuole "YYYY-MM-DDTHH:MM"
  document.getElementById('eve-date').value  = e.event_date ? new Date(e.event_date).toISOString().slice(0,16) : '';
  document.getElementById('eve-loc').value   = e.location || '';
  document.getElementById('eve-maxp').value  = e.max_participants || 0;
  document.getElementById('eve-price').value = e.price || 0;
  document.getElementById('eve-sumup').value = e.sumup_link || '';
  document.getElementById('eve-slug').value  = e.slug || '';
  document.getElementById('eve-public').checked = !!e.public_registration;
  const curImg = e.image_url || '';
  document.getElementById('eve-img').value = curImg;
  setImageUploaderPreview('eve-img-mount', curImg);
  document.getElementById('ev-edit-bg').style.display = 'block';
}
function closeEditEvent() {
  document.getElementById('ev-edit-bg').style.display = 'none';
}
async function saveEditEvent() {
  const id = document.getElementById('eve-id').value;
  if (!id) return;
  const dateVal = document.getElementById('eve-date').value;
  const payload = {
    p_admin_id:            currentUser.id,
    p_event_id:            id,
    p_title:               document.getElementById('eve-title').value.trim() || null,
    p_description:         document.getElementById('eve-desc').value.trim() || null,
    p_event_date:          dateVal ? new Date(dateVal).toISOString() : null,
    p_location:            document.getElementById('eve-loc').value.trim() || null,
    p_max_participants:    parseInt(document.getElementById('eve-maxp').value) || 0,
    p_price:               parseFloat(document.getElementById('eve-price').value) || 0,
    p_sumup_link:          document.getElementById('eve-sumup').value.trim() || null,
    p_slug:                document.getElementById('eve-slug').value.trim() || null,
    p_public_registration: document.getElementById('eve-public').checked,
    p_image_url:           document.getElementById('eve-img').value.trim() || null
  };
  const { data, error } = await db.rpc('admin_update_event', payload);
  if (error) return toast(error.message);
  if (!data || !data.ok) return toast(data?.error || 'Errore');
  toast('Evento aggiornato', 'ok');
  closeEditEvent();
  loadAGest();
}

// ── STORNO / EDIT TX ────────────────────────────────────────────────
function adminVoidTx(txId, amount, desc, cardId) {
  const amt = Number(amount||0);
  const label = (amt >= 0 ? '+' : '') + eur(amt);
  const reason = prompt(`Storna transazione di ${label} su ${cardId}?\n\nDescrizione: ${desc || '(vuota)'}\n\nMotivo dello storno:`, 'Storno admin');
  if (reason === null) return;
  modalConfirm(`Confermi lo storno di ${label} per ${cardId}?\n\nMotivo: ${reason || 'Storno admin'}\n\nVerrà creata una transazione inversa e aggiornato il saldo.`, async () => {
    const { data, error } = await db.rpc('admin_void_transaction', {p_admin_id: currentUser.id, p_transaction_id: txId, p_reason: reason || 'Storno admin'});
    if (error) return modalInfo('❌ Errore\n\n' + error.message);
    if (!data || !data.ok) {
      if (data?.error === 'already_refund') return modalInfo('❌ Questa è già una transazione di storno.');
      return modalInfo('❌ Errore\n\n' + (data?.error || 'sconosciuto'));
    }
    toast('Transazione stornata', 'ok');
    loadATx();
  });
}
async function adminEditTxDesc(txId, currentDesc) {
  const next = prompt('Modifica descrizione transazione:', currentDesc || '');
  if (next === null) return;
  const { data, error } = await db.rpc('admin_update_transaction_description', {p_admin_id: currentUser.id, p_transaction_id: txId, p_description: next});
  if (error) return toast(error.message);
  if (!data || !data.ok) return toast(data?.error || 'Errore');
  toast('Descrizione aggiornata', 'ok');
  loadATx();
}

// ── POPUP NUOVI EVENTI PER SOCI ─────────────────────────────────────
async function checkUnseenEvents() {
  if (!currentUser || currentUser.role !== 'user') return;
  try {
    const { data, error } = await db.rpc('user_unseen_events', {p_user_id: currentUser.id});
    if (error) { console.warn('user_unseen_events', error); return; }
    if (!Array.isArray(data) || !data.length) return;
    _unseenEventsQueue = data;
    openEventPopup(data[0], data.length);
  } catch (e) { console.warn('checkUnseenEvents', e); }
}
function openEventPopup(ev, total) {
  if (!ev) return;
  const imgWrap = document.getElementById('evp-img-wrap');
  const img = document.getElementById('evp-img');
  if (ev.image_url) { img.src = ev.image_url; imgWrap.style.display = ''; }
  else { imgWrap.style.display = 'none'; img.src = ''; }
  document.getElementById('evp-title').textContent = ev.title || 'Nuovo evento';
  const meta = [];
  if (ev.event_date) meta.push('📅 ' + fdt(ev.event_date));
  if (ev.location)   meta.push('📍 ' + ev.location);
  if (ev.price > 0)  meta.push('💶 ' + eur(ev.price));
  else if (ev.price === 0) meta.push('🎁 Gratuito');
  document.getElementById('evp-meta').textContent = meta.join(' · ');
  document.getElementById('evp-desc').textContent = ev.description || '';
  const more = document.getElementById('evp-more');
  if (total > 1) { more.textContent = `E altri ${total - 1} nuovi eventi in bacheca.`; more.style.display = ''; }
  else { more.style.display = 'none'; }
  document.getElementById('ev-popup-bg').dataset.eventId   = ev.id;
  document.getElementById('ev-popup-bg').dataset.eventSlug = ev.slug || '';
  document.getElementById('ev-popup-bg').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
async function closeEventPopup() {
  const bg = document.getElementById('ev-popup-bg');
  const eventId = bg.dataset.eventId;
  bg.style.display = 'none';
  document.body.style.overflow = '';
  if (eventId && currentUser) {
    try { await db.rpc('user_mark_event_seen', {p_user_id: currentUser.id, p_event_id: eventId}); }
    catch (e) { console.warn('mark_event_seen', e); }
  }
}
async function goToEventFromPopup() {
  const bg = document.getElementById('ev-popup-bg');
  const eventId = bg.dataset.eventId;
  await closeEventPopup();
  if (typeof navGo === 'function') navGo('eventi');
  if (eventId) {
    setTimeout(() => {
      const card = document.getElementById('ev-item-' + eventId) || document.querySelector(`[data-event-id="${eventId}"]`);
      if (card && card.scrollIntoView) card.scrollIntoView({behavior:'smooth', block:'center'});
    }, 350);
  }
}

// ── ADD/REMOVE STAFF (promozione/degradazione soci) ─────────────────
let _astSelectedUserId = null;

function openAddStaffModal() {
  _astSelectedUserId = null;
  document.getElementById('ast-search').value = '';
  document.getElementById('ast-detail').style.display = 'none';
  document.getElementById('ast-noresult').style.display = 'none';
  _filterAddStaffCandidates('');
  document.getElementById('add-staff-bg').style.display = 'block';
}
function closeAddStaffModal() {
  document.getElementById('add-staff-bg').style.display = 'none';
  _astSelectedUserId = null;
}
function _filterAddStaffCandidates(query) {
  const q = (query || '').toLowerCase().trim();
  const list = (allAdminUsers || []).filter(u => u.role === 'user' && u.active !== false && u.is_staff !== true);
  const filtered = q
    ? list.filter(u =>
        (u.display_name || '').toLowerCase().includes(q) ||
        (u.card_id || '').toLowerCase().includes(q) ||
        ((u.nome || '') + ' ' + (u.cognome || '')).toLowerCase().includes(q))
    : list;
  const results = document.getElementById('ast-results');
  const noresult = document.getElementById('ast-noresult');
  const detail = document.getElementById('ast-detail');
  if (!filtered.length) {
    results.innerHTML = '';
    noresult.style.display = q ? 'block' : 'none';
    detail.style.display = 'none';
    return;
  }
  noresult.style.display = 'none';
  results.innerHTML = filtered.slice(0, 30).map(u => `
    <div onclick="_selectAddStaffCandidate('${u.id}')" style="padding:10px 12px;border-bottom:1px solid var(--brd);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div>
        <span class="mono" style="color:var(--gold);font-weight:600">${_esc(u.card_id)}</span>
        <span style="margin-left:8px">${_esc(u.display_name || '')}</span>
      </div>
      <span style="font-size:11px;color:var(--mut)">${eur(u.balance || 0)}</span>
    </div>`).join('');
}
function _selectAddStaffCandidate(userId) {
  const u = (allAdminUsers || []).find(x => x.id === userId);
  if (!u) return;
  _astSelectedUserId = userId;
  document.getElementById('ast-detail-name').textContent = `${u.card_id} · ${u.display_name}`;
  const meta = [];
  if (u.nome && u.cognome) meta.push(`${u.nome} ${u.cognome}`);
  if (u.email) meta.push(u.email);
  meta.push('Saldo ' + eur(u.balance || 0));
  document.getElementById('ast-detail-meta').textContent = meta.join(' · ');
  document.getElementById('ast-detail').style.display = 'block';
  document.getElementById('ast-noresult').style.display = 'none';
  document.getElementById('ast-results').innerHTML = '';
}
async function promoteSelectedToStaff() {
  if (!_astSelectedUserId) return toast('Seleziona un socio');
  const u = (allAdminUsers || []).find(x => x.id === _astSelectedUserId) || {};
  const { data, error } = await db.rpc('admin_promote_to_staff', {p_admin_id: currentUser.id, p_user_id: _astSelectedUserId});
  if (error) return toast(error.message);
  if (!data || !data.ok) {
    const code = data && data.error;
    if (code === 'already_staff') return toast('È già Staff');
    if (code === 'is_admin')      return toast('Non puoi assegnare Staff a un admin');
    if (code === 'not_found')     return toast('Socio non trovato');
    return toast(code || 'Errore');
  }
  toast(`${u.display_name || 'Socio'} può ora operare come staff`, 'ok');
  closeAddStaffModal();
  loadAUsers();
}
function demoteFromStaff(userId, cardId, displayName) {
  modalConfirm(`Rimuovere il ruolo staff a ${displayName} (${cardId})?\n\nResterà iscritto come socio.`, async () => {
    const { data, error } = await db.rpc('admin_demote_to_user', {p_admin_id: currentUser.id, p_user_id: userId});
    if (error) return toast(error.message);
    if (!data || !data.ok) {
      const code = data && data.error;
      if (code === 'not_staff') return toast('Non è staff');
      if (code === 'not_found') return toast('Utente non trovato');
      return toast(code || 'Errore');
    }
    toast(`Ruolo staff rimosso. Resta iscritto come socio con tessera ${cardId}.`, 'ok');
    loadAUsers();
  });
}
