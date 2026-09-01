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
let _promoGroupsCache = null, _evePromoOrig = '';

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
  else prefillCardInput();
});

// ── UTILITIES ────────────────────────────────────────────────────────
const eur = c => '€ ' + Number(c||0).toFixed(2).replace('.',',');
const fdt = iso => { if(!iso) return '—'; const d=new Date(iso); return d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'2-digit'})+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}); };
const txic = t => ({recharge:'🔄',purchase:'🛍️',event_fee:'🎫',refund:'↩️',transfer_out:'💸',transfer_in:'💰',promo_bonus:'🌴'}[t]||'•');
// ── DATE E ORA PER <input type="datetime-local"> ─────────────────────
// L'input datetime-local NON fa conversioni: mostra la stringa così com'è e
// restituisce "YYYY-MM-DDTHH:mm" in ora LOCALE. Il DB usa timestamptz (UTC).
// Serve quindi convertire nei due sensi, altrimenti ogni salvataggio sposta
// l'orario dell'offset locale (in CEST: -2h a ogni giro).
//   UTC → input:  '2026-08-09T17:30:00Z'     → '2026-08-09T19:30'
//   input → UTC:  '2026-08-09T19:30'         → '2026-08-09T17:30:00.000Z'
// Round-trip a deriva zero: _localInputToIso(_isoToLocalInput(iso)) === iso.
function _isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const tzMs = d.getTimezoneOffset() * 60000;   // positivo a ovest di UTC
  return new Date(d.getTime() - tzMs).toISOString().slice(0, 16);
}
function _localInputToIso(local) {
  if (!local) return null;
  const d = new Date(local);                    // interpretata come ora locale
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function _imgWrap16x9(url, alt, radius) {
  if (!url) return '';
  const r = radius || '12px 12px 0 0';
  const a = String(alt||'').replace(/"/g,'&quot;');
  const uEnc = String(url).replace(/"/g,'&quot;').replace(/'/g,"\\'");
  return `<div onclick="openEventImageFullscreen('${uEnc}')" style="width:100%;padding-top:40%;position:relative;overflow:hidden;background:#1a1a1a;border-radius:${r};cursor:pointer">
    <img src="${url}" alt="${a}" loading="lazy" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;-webkit-object-fit:cover;display:block">
  </div>`;
}
function openEventImageFullscreen(url) {
  if (!url) return;
  const prev = document.getElementById('imgFullscreen');
  if (prev) prev.remove();
  const uEsc = _esc(url);
  const wrap = document.createElement('div');
  wrap.id = 'imgFullscreen';
  wrap.setAttribute('style', 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;padding:16px;padding-top:calc(16px + env(safe-area-inset-top,0px));padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))');
  wrap.onclick = function(e){ if (e.target === wrap) wrap.remove(); };
  wrap.innerHTML = `<img src="${uEsc}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;-webkit-object-fit:contain;border-radius:8px">
    <button aria-label="Chiudi" onclick="event.stopPropagation();document.getElementById('imgFullscreen').remove()" style="position:absolute;top:calc(16px + env(safe-area-inset-top,0px));right:16px;width:44px;height:44px;border-radius:50%;border:none;background:rgba(255,255,255,0.2);color:#fff;font-size:24px;cursor:pointer">✕</button>`;
  document.body.appendChild(wrap);
}

let _tt;
function toast(msg, type='err') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + type;
  clearTimeout(_tt); _tt = setTimeout(() => el.className='', 3200);
}
function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// ── TESTO RICCO (descrizioni evento) ─────────────────────────────────
// Ordine obbligato: 1) escape HTML, 2) autolink su testo ancora senza tag,
// 3) **grassetto**, 4) a capo → <br>. Mai innerHTML del testo grezzo.
const _RX_LINK = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"])|([\w.+-]+@[\w-]+\.[\w.-]{2,})|((?:\+39[ .]?)?3\d{2}[ .]?\d{3}[ .]?\d{3,4}|\+39[ .]?0\d{1,3}[ .]?\d{5,8})/g;
function _telHref(raw) {
  const d = String(raw).replace(/[ .]/g, '');
  return d.startsWith('+') ? d : '+39' + d;
}
function _richText(s) {
  if (s == null || s === '') return '';
  let h = _esc(String(s));
  h = h.replace(_RX_LINK, (m, url, mail, tel) => {
    if (url)  return `<a href="${url.replace(/&amp;/g, '&')}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    if (mail) return `<a href="mailto:${mail}">${mail}</a>`;
    return `<a href="tel:${_telHref(tel)}">${tel}</a>`;
  });
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return h.replace(/\r\n|\r|\n/g, '<br>');
}
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
  document.getElementById('l-card').value = '';
  hideNav();
  showScreen('screen-login');
  prefillCardInput();
}

// ── MOVIMENTI FILTRI ─────────────────────────────────────────────────
let _movTipo = 'all', _movDays = 0, _allTx = [];
let _pendingEvents = [], _myEventIds = new Set(), _myEventRegs = {}, _eventsCache = [], _promoCache = [];
let _userBalance = 0;
let _staffTxAll = [], _staffTxTipo = 'all', _staffTxDays = 0;
let _adminTxAll = [], _adminTxTipo = 'all', _adminTxDays = 0, _adminTxSearch = '';
let _adminGadgets = [], _adminEvents = [];
let _gqtyId, _gqtyName, _gqtyPrice, _gqtyN = 1;
let _compRegId = null, _compMode = 'user', _compEventId = '', _compCtx = '', _compCache = [];
let _compEventPrice = 0, _compSelfStatus = '', _compEventTitle = '', _compSumupLink = '';
let _myRegs = [], _myGadgetRes = null, _gadgetsCache = [], _sizeSel = {};
const PRESET_SIZES = ['XS','S','M','L','XL','XXL'];
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
    <div class="card" style="margin-bottom:12px">
      <button class="btn btn-p w100" onclick="openTransferModal()">💸 Trasferisci credito a un socio</button>
      <div style="font-size:11px;color:var(--mut);text-align:center;margin-top:8px">Invia una parte del tuo saldo a un altro socio del Rione</div>
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

// ── TRASFERIMENTO CREDITO TRA SOCI ───────────────────────────────────
let _trRecipient = null;
let _trStep = 1;
let _trSearchTimer = null;
let _trScanner = null;

function openTransferModal() {
  _trRecipient = null;
  _trStep = 1;
  document.getElementById('tr-selected').style.display = 'none';
  document.getElementById('tr-step1').style.display = '';
  document.getElementById('tr-step2').style.display = 'none';
  document.getElementById('tr-step3').style.display = 'none';
  document.getElementById('tr-query').value = '';
  document.getElementById('tr-results').innerHTML = '';
  document.getElementById('tr-amount').value = '';
  document.getElementById('tr-note').value = '';
  document.getElementById('tr-pin').value = '';
  document.getElementById('tr-amount-err').style.display = 'none';
  document.getElementById('tr-pin-err').style.display = 'none';
  document.getElementById('tr-balance').textContent = eur(_userBalance);
  _transferSetNextBtn('Avanti', false);
  _transferStopScanner();
  document.getElementById('transfer-modal').classList.add('open');
}
function closeTransferModal() {
  _transferStopScanner();
  document.getElementById('transfer-modal').classList.remove('open');
  _trRecipient = null;
  _trStep = 1;
}
function _transferSetNextBtn(label, enabled) {
  const b = document.getElementById('tr-next-btn');
  b.textContent = label;
  b.disabled = !enabled;
  b.style.opacity = enabled ? '' : '.5';
}
function _transferSearchDebounced() {
  clearTimeout(_trSearchTimer);
  _trSearchTimer = setTimeout(_transferSearch, 300);
}
async function _transferSearch() {
  const q = document.getElementById('tr-query').value.trim();
  const box = document.getElementById('tr-results');
  if (q.length < 2) { box.innerHTML = ''; return; }
  const {data, error} = await db.rpc('user_search_recipient', {p_query: q});
  if (error) { box.innerHTML = `<div class="empty">Errore: ${_esc(error.message)}</div>`; return; }
  if (!data || !data.ok) { box.innerHTML = `<div class="empty">${_esc((data&&data.error)||'Errore ricerca')}</div>`; return; }
  const results = (data.results || []).filter(r => r.card_id !== currentUser.card_id);
  if (!results.length) { box.innerHTML = '<div class="empty">Nessun socio trovato</div>'; return; }
  box.innerHTML = results.map(r => {
    const nome = _esc((r.nome||'') + ' ' + (r.cognome||'')).trim();
    const cid = _esc(r.card_id);
    return `<div class="search-result-item" onclick="_transferSelectRecipient('${cid.replace(/'/g,"\\'")}','${nome.replace(/'/g,"\\'")}')">
      <div style="flex:1;min-width:0">
        <div style="font-family:monospace;font-size:12px;color:var(--mut)">${cid}</div>
        <div style="font-weight:600">${nome||'—'}</div>
      </div>
      <div style="font-size:18px;color:var(--gold)">›</div>
    </div>`;
  }).join('');
}
function _transferSelectRecipient(cardId, fullName) {
  _trRecipient = {card_id: cardId, name: fullName};
  document.getElementById('tr-rec-name').textContent = fullName || '—';
  document.getElementById('tr-rec-card').textContent = cardId;
  document.getElementById('tr-selected').style.display = '';
  document.getElementById('tr-step1').style.display = 'none';
  document.getElementById('tr-step2').style.display = '';
  document.getElementById('tr-results').innerHTML = '';
  _transferStopScanner();
  _trStep = 2;
  _transferValidateAmount();
  setTimeout(() => document.getElementById('tr-amount').focus(), 60);
}
function _transferResetRecipient() {
  _trRecipient = null;
  _trStep = 1;
  document.getElementById('tr-selected').style.display = 'none';
  document.getElementById('tr-step1').style.display = '';
  document.getElementById('tr-step2').style.display = 'none';
  document.getElementById('tr-step3').style.display = 'none';
  _transferSetNextBtn('Avanti', false);
}
function _parseAmount(s) {
  const n = Number(String(s||'').replace(',', '.'));
  return isFinite(n) ? n : NaN;
}
function _transferValidateAmount() {
  const amt = _parseAmount(document.getElementById('tr-amount').value);
  const err = document.getElementById('tr-amount-err');
  err.style.display = 'none';
  err.textContent = '';
  if (isNaN(amt) || amt <= 0) {
    _transferSetNextBtn('Avanti', false);
    return false;
  }
  if (amt > _userBalance) {
    err.textContent = 'Credito insufficiente';
    err.style.display = '';
    _transferSetNextBtn('Avanti', false);
    return false;
  }
  _transferSetNextBtn('Avanti', true);
  return true;
}
function _transferNext() {
  if (_trStep === 2) {
    if (!_transferValidateAmount()) return;
    const amt = _parseAmount(document.getElementById('tr-amount').value);
    const note = document.getElementById('tr-note').value.trim().slice(0,100);
    const rec = _trRecipient;
    const notePart = note ? `<br>Nota: ${_esc(note)}` : '';
    document.getElementById('tr-confirm-msg').innerHTML =
      `Confermi il trasferimento?<br><br><strong>${eur(amt)}</strong> a <strong>${_esc(rec.name)}</strong> (<span style="font-family:monospace">${_esc(rec.card_id)}</span>)${notePart}`;
    document.getElementById('tr-step2').style.display = 'none';
    document.getElementById('tr-step3').style.display = '';
    _transferSetNextBtn('Conferma trasferimento', true);
    _trStep = 3;
    setTimeout(() => document.getElementById('tr-pin').focus(), 60);
  } else if (_trStep === 3) {
    _transferSubmit();
  }
}
async function _transferSubmit() {
  const pin = document.getElementById('tr-pin').value.trim();
  const pinErr = document.getElementById('tr-pin-err');
  pinErr.style.display = 'none';
  pinErr.textContent = '';
  if (!pin) { pinErr.textContent = 'Inserisci il PIN'; pinErr.style.display = ''; return; }
  const amt = _parseAmount(document.getElementById('tr-amount').value);
  const note = document.getElementById('tr-note').value.trim().slice(0,100);
  const rec = _trRecipient;
  if (!rec) return toast('Seleziona un destinatario');
  const btn = document.getElementById('tr-next-btn');
  btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = 'Trasferimento…';
  const {data, error} = await db.rpc('user_transfer_credit', {
    p_sender_card: currentUser.card_id,
    p_sender_pin: pin,
    p_recipient_card: rec.card_id,
    p_amount: amt,
    p_note: note || null
  });
  btn.disabled = false; btn.style.opacity = ''; btn.textContent = 'Conferma trasferimento';
  if (error) { pinErr.textContent = error.message || 'Errore'; pinErr.style.display = ''; return; }
  if (!data || !data.ok) {
    const msg = (data && data.error) || 'Errore trasferimento';
    if (/pin/i.test(msg) && /err/i.test(msg)) {
      pinErr.textContent = 'PIN errato';
      pinErr.style.display = '';
      document.getElementById('tr-pin').value = '';
      document.getElementById('tr-pin').focus();
    } else if (/insuff/i.test(msg)) {
      document.getElementById('tr-step3').style.display = 'none';
      document.getElementById('tr-step2').style.display = '';
      _trStep = 2;
      _transferSetNextBtn('Avanti', false);
      const amtErr = document.getElementById('tr-amount-err');
      amtErr.textContent = 'Credito insufficiente';
      amtErr.style.display = '';
    } else if (/te stesso/i.test(msg) || /self/i.test(msg)) {
      toast(msg);
      _transferResetRecipient();
    } else {
      pinErr.textContent = msg;
      pinErr.style.display = '';
    }
    return;
  }
  const recName = data.recipient_name || rec.name;
  closeTransferModal();
  toast(`✓ Trasferiti ${eur(amt)} a ${recName}`, 'ok');
  await refreshUser();
}
function _transferToggleScanner() {
  const wrap = document.getElementById('tr-scanner-wrap');
  if (wrap.style.display === 'none' || !wrap.style.display) {
    wrap.style.display = 'block';
    if (typeof Html5Qrcode === 'undefined') { toast('Libreria QR non disponibile'); wrap.style.display = 'none'; return; }
    _trScanner = new Html5Qrcode('tr-scanner-reader');
    _trScanner.start(
      {facingMode: 'environment'},
      {fps: 10, qrbox: {width: 220, height: 220}},
      async text => {
        _transferStopScanner();
        const cid = String(text||'').trim().toUpperCase();
        if (!cid) return;
        if (cid === currentUser.card_id) { toast('Non puoi trasferire credito a te stesso'); return; }
        const {data} = await db.rpc('user_search_recipient', {p_query: cid});
        const match = (data && data.ok && (data.results||[]).find(r => (r.card_id||'').toUpperCase() === cid));
        if (!match) { toast('Tessera non trovata o non valida'); return; }
        _transferSelectRecipient(match.card_id, ((match.nome||'') + ' ' + (match.cognome||'')).trim());
      },
      () => {}
    ).catch(() => { toast('Fotocamera non disponibile'); _transferStopScanner(); });
  } else {
    _transferStopScanner();
  }
}
function _transferStopScanner() {
  const wrap = document.getElementById('tr-scanner-wrap');
  if (wrap) wrap.style.display = 'none';
  if (_trScanner) {
    _trScanner.stop().catch(()=>{}).finally(() => { try { _trScanner.clear(); } catch(_){} _trScanner = null; });
  }
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
  _userBalance   = Number(data.balance || 0);
  renderBal(data.balance);
  _allTx         = data.transactions   || [];
  _pendingEvents = data.pending_events || [];
  _myEventIds    = new Set(data.my_event_ids || []);
  _myEventRegs   = {};
  _myRegs        = data.event_registrations || data.my_event_regs || [];
  _myRegs.forEach(r => { _myEventRegs[r.event_id] = r; });
  _myGadgetRes   = Array.isArray(data.gadget_reservations) ? data.gadget_reservations : null;
  renderTx(_allTx.slice(0, 5));
  renderPendingEvents(_pendingEvents);
  loadUserGadgetReservations();
  await loadUserEvents();
  await renderPromoStatus();
}
function renderBal(c) {
  document.getElementById('u-balance').textContent = eur(c);
  const b = document.getElementById('u-badge');
  if (c >= 10) { b.textContent='● Ottimo'; b.className='badge bg'; }
  else if (c >= 5) { b.textContent='● Basso'; b.className='badge by'; }
  else { b.textContent='● Critico'; b.className='badge br'; }
}

// ── PROMO FEDELTÀ (gruppi cene) ──────────────────────────────────────
async function loadPromoGroups(force) {
  if (_promoGroupsCache && !force) return _promoGroupsCache;
  const {data, error} = await db.rpc('list_promo_groups');
  if (error) { console.warn('list_promo_groups:', error.message); return _promoGroupsCache || []; }
  _promoGroupsCache = Array.isArray(data) ? data : [];
  return _promoGroupsCache;
}
// Popola una <select> di gruppi promo, pre-selezionando `current`
// (events.promo_group, esposto da admin_list_events). Vuoto/null → "Nessuno".
async function _fillPromoSelect(selectId, current) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const groups = await loadPromoGroups();
  const opts = ['<option value="">Nessuno</option>'];
  groups.forEach(g => {
    opts.push(`<option value="${_esc(g.promo_group)}">${_esc(g.label || g.promo_group)}</option>`);
  });
  sel.innerHTML = opts.join('');
  sel.value = (current != null && current !== '') ? String(current) : '';
  // se il gruppo salvato non è più in elenco, lo aggiungo per non perderlo al salvataggio
  if (sel.value === '' && current) {
    sel.insertAdjacentHTML('beforeend', `<option value="${_esc(current)}">${_esc(current)}</option>`);
    sel.value = String(current);
  }
}
// Etichetta leggibile di un gruppo promo (fallback: il valore grezzo)
function _promoLabel(promoGroup) {
  if (!promoGroup) return '';
  const g = (_promoGroupsCache || []).find(x => x.promo_group === promoGroup);
  return (g && g.label) || promoGroup;
}
// Elenco in sola lettura dei gruppi bonus fedeltà (tab Promo admin).
// Sistema separato dai codici sconto: qui non si crea/modifica/elimina nulla,
// la configurazione delle soglie vive nella tabella di config lato DB.
async function renderPromoGroupsInfo() {
  const el = document.getElementById('gs-promo-groups');
  if (!el) return;
  const groups = await loadPromoGroups();
  if (!groups.length) { el.innerHTML = ''; return; }   // nessuno stato vuoto: sezione assente
  el.innerHTML = `
    <div class="sec-lbl">🌴 Bonus fedeltà attivi</div>
    ${groups.map(g => {
      const soglie = (g.thresholds || [])
        .slice()
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map(t => `<span class="pgrp-pill">${Number(t.position)}ª → ${Number(t.bonus_pct)}%</span>`)
        .join('');
      return `
        <div class="card pgrp-card">
          <div class="pgrp-ttl">🌴 ${_esc(g.label || g.promo_group)}</div>
          <div class="pgrp-sub">Bonus automatico su cene consecutive del gruppo</div>
          ${soglie ? `<div class="pgrp-pills">${soglie}</div>` : ''}
          <div class="pgrp-ro">Solo lettura</div>
        </div>`;
    }).join('')}
    <div class="pgrp-sep"></div>`;
}
function _promoBadgeHtml(promoGroup) {
  if (!promoGroup) return '';
  return `<span class="promo-pill" title="Gruppo promo: ${_esc(_promoLabel(promoGroup))}">🌴 ${_esc(_promoLabel(promoGroup))}</span>`;
}
async function renderPromoStatus() {
  const el = document.getElementById('u-promo-block');
  if (!el || !currentUser) return;
  const groups = await loadPromoGroups();
  if (!groups.length) { el.innerHTML = ''; return; }
  const rows = await Promise.all(groups.map(async g => {
    const {data, error} = await db.rpc('user_promo_status', {p_user_id: currentUser.id, p_promo_group: g.promo_group});
    if (error || !data) return null;
    return {g, s: data};
  }));
  const attivi = rows.filter(r => r && Number(r.s.completed || 0) > 0);
  el.innerHTML = attivi.map(r => _promoCardHtml(r.g, r.s)).join('');
}
function _promoCardHtml(g, s) {
  const label     = s.label || g.label || 'Promo';
  const completed = Number(s.completed || 0);
  const thresholds = new Set((g.thresholds || []).map(t => Number(t.position)));
  const maxPos    = Number(s.max_position || 0)
    || (g.thresholds || []).reduce((m, t) => Math.max(m, Number(t.position) || 0), 0);
  const nextPos   = s.next_position   != null ? Number(s.next_position)   : null;
  const nextPct   = s.next_bonus_pct  != null ? Number(s.next_bonus_pct)  : null;
  const totBonus  = Number(s.total_bonus_received || 0);

  let riga2 = '';
  if (completed < maxPos && nextPos) {
    riga2 = `<div class="promo-line">Prossima soglia: <strong>${nextPos}ª cena</strong> → <strong>${nextPct}%</strong> cashback</div>`;
  } else if (maxPos && completed >= maxPos) {
    riga2 = `<div class="promo-line">🎉 Ciclo completato! Grazie per aver partecipato.</div>`;
  }

  let cells = '';
  for (let i = 1; i <= maxPos; i++) {
    const done = i <= completed;
    const star = thresholds.has(i) && (i <= completed || i === nextPos);
    cells += `<div class="promo-cell${done ? ' on' : ''}">${star ? '<span class="promo-star">★</span>' : ''}</div>`;
  }

  return `
    <div class="card promo-card">
      <div class="promo-hdr"><span class="promo-emoji">🌴</span><span class="promo-ttl">${_esc(String(label).toUpperCase())}</span></div>
      <div class="promo-line">Cene partecipate: <strong>${completed}</strong> di <strong>${maxPos}</strong></div>
      ${riga2}
      <div class="promo-line promo-tot">Bonus totale accreditato: ${eur(totBonus)}</div>
      ${maxPos ? `<div class="promo-bar" style="grid-template-columns:repeat(${maxPos},1fr)">${cells}</div>` : ''}
    </div>`;
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
  // gli eventi del socio arrivano da user_list_events (fasce + mia iscrizione incluse)
  await loadUserEvents();
  renderGadgets(data.gadgets||[]);
  renderPromos(data.promos||[]);
  await renderSumUp(data.sumup_links||[]);
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
// ── EVENTI SOCIO: LISTA COMPATTA ─────────────────────────────────────
// Fonte unica della vetrina eventi lato socio: user_list_events porta in un
// colpo solo l'evento, la mia iscrizione e il prezzo minimo delle fasce.
// Qui niente poster e niente pagamenti: la lista resta un indice cronologico,
// tutto il resto vive nel dettaglio evento (openEventDetail).
let _evList = [];

function _evShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('it-IT', {weekday: 'short', day: 'numeric', month: 'short'});
}
function _evLongDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('it-IT', {weekday: 'long', day: 'numeric', month: 'long'}) +
    ' · ' + d.toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'});
}
// min_price è il minimo delle fasce a pagamento: 0 solo se l'evento è davvero gratis.
function _evPriceHint(e) {
  if (e.has_tiers) {
    const min = Number(e.min_price || 0);
    return min > 0 ? 'da ' + eur(min) : 'Gratis';
  }
  const p = Number(e.price || 0);
  return p > 0 ? eur(p) : 'Gratis';
}
async function loadUserEvents() {
  if (!currentUser) return [];
  const {data, error} = await db.rpc('user_list_events', {p_user_id: currentUser.id});
  if (error) { console.warn('user_list_events:', error.message); return _evList; }
  _evList = Array.isArray(data) ? data : [];
  renderUserEvents();
  return _evList;
}
function _evByDate(a, b) { return new Date(a.event_date || 0) - new Date(b.event_date || 0); }
function _evRowHtml(e, right) {
  return `<button class="ev-row" id="ev-item-${e.id}" data-event-id="${e.id}" onclick="openEventDetail('${e.id}')">
    <span class="ev-row-date">${_evShortDate(e.event_date)}</span>
    <span class="ev-row-main">
      <span class="ev-row-ttl">${_esc(e.title || 'Evento')}</span>
      ${e.location ? `<span class="ev-row-sub">${_esc(e.location)}</span>` : ''}
    </span>
    ${right}
    <span class="ev-row-chev">›</span>
  </button>`;
}
function renderUserEvents() {
  const old = document.getElementById('u-my-regs');
  if (old) old.innerHTML = '';            // le iscrizioni ora stanno nella lista qui sotto
  const el = document.getElementById('u-ev-list');
  if (!el) return;
  const mine  = _evList.filter(e => e.my_registration).sort(_evByDate);
  const altri = _evList.filter(e => !e.my_registration).sort(_evByDate);
  if (!mine.length && !altri.length) { el.innerHTML = '<div class="empty">Nessun evento in programma</div>'; return; }
  const blocchi = [];
  if (mine.length) {
    blocchi.push(`<div class="sec-title" style="margin:2px 0 8px">Le mie iscrizioni</div>` +
      mine.map(e => _evRowHtml(e, e.my_registration.fully_paid
        ? '<span class="pb pb-ok">Saldato</span>'
        : '<span class="pb pb-wait">Da saldare</span>')).join(''));
  }
  if (altri.length) {
    blocchi.push(`<div class="sec-title" style="margin:${mine.length ? '18px' : '2px'} 0 8px">Prossimi eventi</div>` +
      altri.map(e => _evRowHtml(e, `<span class="ev-row-price">${_evPriceHint(e)}</span>`)).join(''));
  }
  el.innerHTML = blocchi.join('');
}

// ── DETTAGLIO EVENTO: ISCRIZIONE E PAGAMENTO PER PERSONA ─────────────
// Ogni persona (io + accompagnatori) ha la sua fascia e la sua quota: il
// pagamento è per-persona, non per-iscrizione. Chi non viene saldato ora
// resta "da saldare" e potrà pagare per conto suo più avanti.
// _evd = { ev, tiers, reg, sumup }: fotografia server-side dell'evento aperto.
let _evd = null;
let _evdMode = 'view';     // 'view' | 'compose' (nuova iscrizione) | 'add' (aggiungi persone)
let _evdRows = [];         // righe persona in composizione: {key, nome, cognome, tier_id}
let _evdRowSeq = 0;
let _evdSelfTier = '';     // fascia scelta per me in fase di iscrizione
let _evdSel = {};          // { [unitKey]: true } → persone selezionate da saldare
let _evdSumupOpen = false; // pannello link SumUp aperto

// Fallback per un evento non più in vetrina (es. passato) di cui però ho una
// quota aperta: i dati minimi arrivano da get_user_state.
function _evFallback(eventId) {
  const p = (_pendingEvents || []).find(x => x.event_id === eventId);
  if (p) return {id: eventId, title: p.evento || 'Evento', event_date: p.event_date};
  const r = _myEventRegs[eventId];
  if (r) return {id: eventId, title: r.event_title || 'Evento', event_date: r.event_date, location: r.event_location};
  return null;
}
async function openEventDetail(eventId) {
  if (!eventId) return;
  let ev = _evList.find(e => e.id === eventId);
  if (!ev) { await loadUserEvents(); ev = _evList.find(e => e.id === eventId); }
  if (!ev) ev = _evFallback(eventId);
  if (!ev) return toast('Evento non disponibile');
  _evdMode = 'view'; _evdRows = []; _evdSelfTier = ''; _evdSel = {}; _evdSumupOpen = false;
  document.getElementById('evd-title').textContent = ev.title || 'Evento';
  document.getElementById('evd-body').innerHTML = '<div class="empty">⏳ Carico l\'evento…</div>';
  document.getElementById('evd-bg').classList.add('open');
  document.body.style.overflow = 'hidden';
  await _evdLoad(ev);
}
function closeEventDetail() {
  document.getElementById('evd-bg').classList.remove('open');
  document.body.style.overflow = '';
  _evd = null; _evdMode = 'view'; _evdRows = []; _evdSel = {}; _evdSumupOpen = false;
}
// Fasce, iscrizione e link SumUp in parallelo. Si ricarica dal server dopo ogni
// scrittura: gli stati di pagamento non si indovinano lato client.
async function _evdLoad(evArg) {
  const ev = evArg || (_evd && _evd.ev);
  if (!ev) return;
  const [t, r, s, menu] = await Promise.all([
    db.rpc('list_event_tiers',            {p_event_id: ev.id}),
    db.rpc('user_get_event_registration', {p_user_id: currentUser.id, p_event_id: ev.id}),
    db.rpc('list_event_sumup_links',      {p_event_id: ev.id}),
    _fetchEventMenu(ev.id)                // una sola volta: riusato da iscrizione e quote
  ]);
  if (t.error) console.warn('list_event_tiers:', t.error.message);
  if (s.error) console.warn('list_event_sumup_links:', s.error.message);
  if (r.error || !r.data || r.data.ok === false) {
    document.getElementById('evd-body').innerHTML = '<div class="empty">Impossibile caricare l\'iscrizione</div>';
    return toast((r.error && r.error.message) || (r.data && r.data.error) || 'Errore iscrizione');
  }
  _evd = {
    ev:    _evList.find(e => e.id === ev.id) || ev,
    tiers: Array.isArray(t.data) ? t.data : [],
    reg:   r.data,
    sumup: Array.isArray(s.data) ? s.data : [],
    menu:  menu || {common: [], by_tier: []}
  };
  _evdSel = {};             // la selezione riparte dalla verità del server
  _evdSumupOpen = false;
  renderEventDetail();
}
function _evdHasTiers()   { return !!(_evd && _evd.tiers.length); }
function _evdRegistered() { return !!(_evd && _evd.reg && _evd.reg.registered); }
function _evdRegId()      { return (_evd && _evd.reg && _evd.reg.registration) ? _evd.reg.registration.id : null; }
// Modifiche consentite solo prima della data evento (come per le iscrizioni staff)
function _evdCanEdit() {
  const d = _evd && _evd.ev && _evd.ev.event_date;
  return d ? new Date(d) > new Date() : true;
}

// Le "unità" pagabili: io (se ancora incluso) + ogni accompagnatore attivo.
function _evdUnits() {
  if (!_evdRegistered()) return [];
  const r = _evd.reg.registration || {};
  const units = [];
  if (r.self_included !== false) units.push({
    key: 'self', type: 'self',
    name: (currentUser && currentUser.display_name) || 'Tu',
    tier_id: r.tier_id || null,
    tier_label: r.tier_label || '', amount: Number(r.amount || 0),
    status: r.payment_status || 'da_saldare'
  });
  (_evd.reg.companions || [])
    .filter(c => (c.status || 'attivo') === 'attivo')
    .forEach(c => units.push({
      key: String(c.id), type: 'companion', id: c.id,
      name: `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Accompagnatore',
      tier_id: c.tier_id || null,
      tier_label: c.tier_label || '', amount: Number(c.amount || 0),
      status: c.payment_status || 'da_saldare'
    }));
  return units;
}
// 'saldato' | 'gratuito' | 'attesa' | 'da_saldare'. Solo 'da_saldare' è
// selezionabile: una quota in fascia €0 non si paga mai.
function _evdUnitState(u) {
  const s = String(u.status || 'da_saldare');
  if (s === 'gratuito') return 'gratuito';
  if (s.indexOf('saldato') === 0) return 'saldato';
  if (s.endsWith('_in_attesa')) return 'attesa';
  if (Number(u.amount || 0) <= 0) return 'gratuito';
  return 'da_saldare';
}
function _evdPayable()  { return _evdUnits().filter(u => _evdUnitState(u) === 'da_saldare'); }
function _evdSelected() { return _evdPayable().filter(u => _evdSel[u.key]); }
function _evdSelTotal() { return _evdSelected().reduce((s, u) => s + Number(u.amount || 0), 0); }
function _evdTargets() {
  const sel = _evdSelected();
  return {
    self: sel.some(u => u.type === 'self'),
    companion_ids: sel.filter(u => u.type === 'companion').map(u => u.id)
  };
}

function renderEventDetail() {
  const el = document.getElementById('evd-body');
  if (!el || !_evd) return;
  const e = _evd.ev;
  const meta = [_evLongDate(e.event_date), e.location].filter(Boolean);
  const head = `
    ${e.image_url ? _imgWrap16x9(e.image_url, e.title, '12px') : ''}
    <div class="evd-ttl">${_esc(e.title || 'Evento')}</div>
    <div class="evd-meta">${meta.map(_esc).join(' · ')}</div>
    ${e.description ? `<div class="evd-desc">${_richText(e.description)}</div>` : ''}
    ${_evdMenuHtml()}
    ${_evdTiersHtml()}`;
  let body;
  if (_evdMode === 'compose')    body = _evdComposeHtml();
  else if (_evdMode === 'add')   body = _evdAddPeopleHtml();
  else if (_evdRegistered())     body = _evdPaymentHtml();
  else if (!_evdCanEdit())       body = `<div class="evd-hint" style="margin-top:16px">Evento passato: iscrizioni chiuse.</div>`;
  else body = `<button class="btn btn-p w100" style="margin-top:16px" onclick="evdStartCompose()">Iscriviti</button>`;
  el.innerHTML = head + body;
  if (_evdMode !== 'view') _evdUpdateTotal();
}
// ── MENÙ DELL'EVENTO (socio) ─────────────────────────────────────────
// Le sezioni comuni valgono per tutti; quelle di una fascia si vedono solo a chi
// ha (o sta scegliendo) quella fascia. Menù vuoto → nessuna sezione mostrata.
function _evdMenu() { return (_evd && _evd.menu) || {common: [], by_tier: []}; }
function _menuItemsFor(tierId) {
  const m = _evdMenu();
  const t = tierId ? (m.by_tier || []).find(x => String(x.tier_id) === String(tierId)) : null;
  return (m.common || []).concat(t ? (t.items || []) : []);
}
function _menuRigheHtml(items) {
  return items.map(it => `<div class="menu-line">
    <span class="menu-line-t">${_esc(it.section_label || '')}</span>
    ${it.item_detail ? `<span class="menu-line-d">${_esc(it.item_detail)}</span>` : ''}
  </div>`).join('');
}
function _evdMenuHtml() {
  const m = _evdMenu();
  if (!_menuHasItems(m)) return '';
  const perFascia = (m.by_tier || []).filter(t => (t.items || []).length);
  return `<div class="menu-card">
    <div class="tier-list-lbl">🍽️ Menù</div>
    ${(m.common || []).length ? _menuRigheHtml(m.common) : ''}
    ${perFascia.map(t => `<div class="menu-sub">
      <div class="menu-sub-t">Menù — ${_esc(t.tier_label || 'fascia')}</div>
      ${_menuRigheHtml(t.items)}
    </div>`).join('')}
  </div>`;
}
// Anteprima compatta: "Antipasto — Bruschette • Primo — Gnocchi al pesto"
function _menuPreviewHtml(tierId) {
  const items = _menuItemsFor(tierId);
  if (!items.length) return '';
  return `<div class="menu-prev">🍽️ ${items.map(it =>
    _esc(it.section_label || '') + (it.item_detail ? ' — ' + _esc(it.item_detail) : '')).join(' • ')}</div>`;
}
function _evdTiersHtml() {
  if (!_evdHasTiers()) return '';
  return `<div class="tier-list">
    <div class="tier-list-lbl">Fasce di prezzo</div>
    ${_evd.tiers.map(t => `<div class="tier-list-row">
      <span class="tier-list-name">${_esc(t.label || '')}</span>
      <span class="tier-list-price">${_tierPriceLabel(t.price)}</span>
    </div>`).join('')}
  </div>`;
}

// ── COMPOSIZIONE GRUPPO (iscrizione e aggiunta persone) ──────────────
function evdStartCompose()   { _evdMode = 'compose'; _evdRows = []; _evdSelfTier = ''; renderEventDetail(); }
function evdStartAddPeople() { _evdMode = 'add'; _evdRows = [_evdNewRow()]; renderEventDetail(); }
function evdCancelCompose()  { _evdMode = 'view'; _evdRows = []; renderEventDetail(); }
function _evdNewRow() { return {key: 'p' + (++_evdRowSeq), nome: '', cognome: '', tier_id: ''}; }
function evdAddRow()  { _evdRows = _evdRows.concat([_evdNewRow()]); _evdRenderRows(); }
function evdRemoveRow(key) { _evdRows = _evdRows.filter(r => r.key !== key); _evdRenderRows(); }
function evdRowField(key, field, value) {
  const r = _evdRows.find(x => x.key === key);
  if (!r) return;
  r[field] = value;
  if (field === 'tier_id') { _evdUpdateTotal(); _evdUpdatePreview(key, value); }
}
function evdSetSelfTier(value) {
  _evdSelfTier = value;
  _evdUpdateTotal();
  _evdUpdatePreview('self', value);
}
// Il menù è già in memoria (_evd.menu): l'anteprima si aggiorna senza altre query.
function _evdUpdatePreview(key, tierId) {
  const el = document.getElementById('mp-' + key);
  if (el) el.innerHTML = _menuPreviewHtml(tierId);
}
function _evdTierPrice(tierId) {
  const t = (_evd ? _evd.tiers : []).find(x => String(x.id) === String(tierId));
  return t ? Number(t.price || 0) : 0;
}
// Totale live: somma delle fasce scelte (le fasce a €0 valgono 0).
function _evdComposeTotal(includeSelf) {
  const hasTiers = _evdHasTiers();
  const flat = Number((_evd && _evd.ev.price) || 0);
  const quota = r => hasTiers ? _evdTierPrice(r.tier_id) : flat;
  const base = includeSelf ? (hasTiers ? _evdTierPrice(_evdSelfTier) : flat) : 0;
  return _evdRows.reduce((s, r) => s + quota(r), base);
}
function _evdUpdateTotal() {
  const el = document.getElementById('evd-total');
  if (!el || !_evd) return;
  const includeSelf = _evdMode === 'compose';
  const n = _evdRows.length + (includeSelf ? 1 : 0);
  el.innerHTML = `${n} ${n === 1 ? 'persona' : 'persone'} · Totale <strong>${eur(_evdComposeTotal(includeSelf))}</strong>`;
}
function _evdTierSelectHtml(selected, onchange) {
  const opts = ['<option value="">Scegli la fascia…</option>'].concat(
    _evd.tiers.map(t =>
      `<option value="${t.id}"${String(t.id) === String(selected) ? ' selected' : ''}>${_esc(t.label || '')} — ${_tierPriceLabel(t.price)}</option>`));
  return `<select onchange="${onchange}">${opts.join('')}</select>`;
}
function _evdRowsHtml() {
  if (!_evdRows.length) {
    return `<div class="evd-hint">${_evdMode === 'compose' ? 'Nessun accompagnatore: ti iscrivi solo tu.' : 'Aggiungi almeno una persona.'}</div>`;
  }
  return _evdRows.map(r => `<div class="card evd-person">
    <div class="evd-person-top">
      <input type="text" placeholder="Nome" value="${_escAttr(r.nome)}" oninput="evdRowField('${r.key}','nome',this.value)">
      <input type="text" placeholder="Cognome" value="${_escAttr(r.cognome)}" oninput="evdRowField('${r.key}','cognome',this.value)">
      <button class="btn-sm evd-person-x" title="Rimuovi" onclick="evdRemoveRow('${r.key}')">✕</button>
    </div>
    ${_evdHasTiers() ? `<div class="fg" style="margin:8px 0 0"><label>Fascia</label>${_evdTierSelectHtml(r.tier_id, `evdRowField('${r.key}','tier_id',this.value)`)}</div>` : ''}
    <div id="mp-${r.key}">${_menuPreviewHtml(_evdHasTiers() ? r.tier_id : null)}</div>
  </div>`).join('');
}
function _evdRenderRows() {
  const el = document.getElementById('evd-rows');
  if (!el) return renderEventDetail();
  el.innerHTML = _evdRowsHtml();
  _evdUpdateTotal();
}
function _evdComposeHtml() {
  const selfTier = _evdHasTiers()
    ? `<div class="fg" style="margin:8px 0 0"><label>La tua fascia</label>${_evdTierSelectHtml(_evdSelfTier, 'evdSetSelfTier(this.value)')}</div>`
    : '';
  return `<div class="evd-sec">
    <div class="sec-title" style="margin-bottom:8px">Chi partecipa</div>
    <div class="card evd-person">
      <div class="evd-person-name">${_esc((currentUser && currentUser.display_name) || 'Tu')} <span class="evd-you">(tu)</span></div>
      ${selfTier}
      <div id="mp-self">${_menuPreviewHtml(_evdHasTiers() ? _evdSelfTier : null)}</div>
    </div>
    <div id="evd-rows">${_evdRowsHtml()}</div>
    <button class="btn btn-q w100" style="margin-top:8px" onclick="evdAddRow()">➕ Aggiungi persona</button>
    <div id="evd-total" class="evd-total"></div>
    <div class="evd-actions">
      <button class="btn btn-q" onclick="evdCancelCompose()">Annulla</button>
      <button class="btn btn-p" style="flex:2" onclick="evdSubmitRegister()">Conferma iscrizione</button>
    </div>
  </div>`;
}
function _evdAddPeopleHtml() {
  return `<div class="evd-sec">
    <div class="sec-title" style="margin-bottom:8px">Aggiungi persone</div>
    <div id="evd-rows">${_evdRowsHtml()}</div>
    <button class="btn btn-q w100" style="margin-top:8px" onclick="evdAddRow()">➕ Aggiungi persona</button>
    <div id="evd-total" class="evd-total"></div>
    <div class="evd-actions">
      <button class="btn btn-q" onclick="evdCancelCompose()">Annulla</button>
      <button class="btn btn-p" style="flex:2" onclick="evdSubmitAddPeople()">Conferma</button>
    </div>
  </div>`;
}
// Validazione lato client speculare a quella del backend (stessi messaggi).
function _evdCollectCompanions() {
  const hasTiers = _evdHasTiers();
  const rows = _evdRows.map(r => ({nome: (r.nome || '').trim(), cognome: (r.cognome || '').trim(), tier_id: r.tier_id}));
  if (rows.some(r => !r.nome || !r.cognome)) { toast('Nome e cognome obbligatori per ogni persona'); return null; }
  if (hasTiers && rows.some(r => !r.tier_id)) { toast('Seleziona una fascia per ogni persona'); return null; }
  return rows.map(r => hasTiers
    ? {nome: r.nome, cognome: r.cognome, tier_id: r.tier_id}
    : {nome: r.nome, cognome: r.cognome});
}
async function evdSubmitRegister() {
  if (!_evd) return;
  const hasTiers = _evdHasTiers();
  if (hasTiers && !_evdSelfTier) return toast('Seleziona una fascia per te');
  const comps = _evdCollectCompanions();
  if (!comps) return;
  const {data, error} = await db.rpc('user_register_event_tiered', {
    p_user_id: currentUser.id,
    p_event_id: _evd.ev.id,
    p_self_tier_id: hasTiers ? _evdSelfTier : null,
    p_companions: comps,
    p_party_notes: null
  });
  if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore iscrizione');
  toast('✅ Iscrizione confermata', 'ok');
  _evdMode = 'view'; _evdRows = []; _evdSelfTier = '';
  await _evdLoad();       // → schermata di pagamento con le quote appena create
  await refreshUser();
}
async function evdSubmitAddPeople() {
  const regId = _evdRegId();
  if (!regId) return toast('Iscrizione non trovata');
  if (!_evdRows.length) return toast('Aggiungi almeno una persona');
  const comps = _evdCollectCompanions();
  if (!comps) return;
  const {data, error} = await db.rpc('user_add_companions_tiered', {
    p_user_id: currentUser.id, p_registration_id: regId, p_companions: comps
  });
  if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore');
  toast('✅ Persone aggiunte', 'ok');
  _evdMode = 'view'; _evdRows = [];
  await _evdLoad();
  await refreshUser();
}

// ── PAGAMENTO PER PERSONA ────────────────────────────────────────────
function evdToggleUnit(key, checked) { _evdSel = {..._evdSel, [key]: !!checked}; _evdRenderPay(); }
function evdToggleAll(checked) {
  const next = {..._evdSel};
  _evdPayable().forEach(u => { next[u.key] = !!checked; });
  _evdSel = next;
  _evdRenderPay();
}
function _evdPaymentHtml() { return `<div id="evd-pay">${_evdPayInner()}</div>`; }
function _evdRenderPay() {
  const el = document.getElementById('evd-pay');
  if (!el) return renderEventDetail();
  el.innerHTML = _evdPayInner();
}
function _evdUnitRowHtml(u) {
  const st = _evdUnitState(u);
  const right = {
    saldato:  '<span class="pb pb-ok">Saldato</span>',
    gratuito: '<span class="pb pb-ok">Gratuito ✓</span>',
    attesa:   '<span class="pb pb-cash">In attesa conferma staff</span>'
  }[st] || '<span class="evd-unit-lbl">Pago io</span>';
  const quota = Number(u.amount || 0) > 0 ? eur(u.amount) : 'Gratuito';
  return `<div class="evd-unit">
    ${st === 'da_saldare'
      ? `<input type="checkbox" ${_evdSel[u.key] ? 'checked' : ''} onchange="evdToggleUnit('${u.key}',this.checked)">`
      : '<span class="evd-unit-nochk"></span>'}
    <span class="evd-unit-main">
      <span class="evd-unit-name">${_esc(u.name)}${u.type === 'self' ? ' <span class="evd-you">(tu)</span>' : ''}</span>
      <span class="evd-unit-sub">${u.tier_label ? _esc(u.tier_label) + ' · ' : ''}${quota}</span>
      ${_menuPreviewHtml(u.tier_id)}
    </span>
    ${right}
    ${st === 'da_saldare' && u.type === 'companion' && _evdCanEdit()
      ? `<button class="row-act danger" title="Rimuovi dall'iscrizione" onclick="evdRemoveUnit('${u.key}')">🗑</button>` : ''}
  </div>`;
}
function _evdPayInner() {
  const units   = _evdUnits();
  const payable = _evdPayable();
  const sel     = _evdSelected();
  const tot     = _evdSelTotal();
  const allSel  = payable.length > 0 && payable.every(u => _evdSel[u.key]);
  const attesa  = units.filter(u => _evdUnitState(u) === 'attesa').length;
  const nulla   = sel.length === 0;
  const dis     = nulla ? 'disabled' : '';
  const master  = payable.length > 1
    ? `<label class="evd-master"><input type="checkbox" ${allSel ? 'checked' : ''} onchange="evdToggleAll(this.checked)"><span>Pago io per tutti</span></label>`
    : '';
  const metodi = payable.length ? `
    <div class="evd-tot">${nulla
      ? 'Seleziona chi vuoi saldare'
      : `${sel.length} ${sel.length === 1 ? 'persona' : 'persone'} · <strong>${eur(tot)}</strong>`}</div>
    <div class="evd-methods">
      <button class="btn btn-p" ${dis} onclick="evdPay('credito')">💳 Credito</button>
      <button class="btn btn-q" ${dis} onclick="evdPay('cassa')">💵 Cassa</button>
      ${_evd.sumup.length ? `<button class="btn btn-g" ${dis} onclick="evdPay('sumup')">📱 SumUp</button>` : ''}
    </div>
    <div class="evd-hint">Saldo disponibile: ${eur(_userBalance)}. Chi non selezioni resta da saldare e potrà pagare per conto suo.</div>
    ${_evdSumupOpen ? _evdSumupHtml() : ''}`
    : `<div class="evd-hint">${attesa ? 'Quote in attesa di conferma dello staff.' : '✓ Tutte le quote sono saldate.'}</div>`;
  return `<div class="evd-sec">
    <div class="sec-title" style="margin-bottom:4px">La tua iscrizione</div>
    ${master}
    <div class="evd-units">${units.map(_evdUnitRowHtml).join('')}</div>
    ${metodi}
    ${_evdCanEdit() ? `<button class="btn btn-q w100" style="margin-top:14px" onclick="evdStartAddPeople()">➕ Aggiungi persone</button>
      <div style="margin-top:12px;text-align:right"><a href="#" class="link-danger" onclick="evdCancelAll();return false">🗑 Annulla tutta l'iscrizione</a></div>`
      : '<div class="past-note">Evento passato — modifiche non disponibili</div>'}
  </div>`;
}
function _evdSumupHtml() {
  return `<div class="evd-sumup">
    <div class="sec-title" style="margin-bottom:6px">Paga con SumUp</div>
    <div class="evd-hint" style="margin:0 0 8px">Apri il link dell'importo giusto per ogni persona, poi conferma qui sotto: lo staff verificherà l'incasso.</div>
    ${_evd.sumup.map((l, i) => `<div class="evd-sumup-row">
      <span class="evd-sumup-lbl">${_esc(l.label || 'Link')}${l.amount != null ? ' · ' + eur(l.amount) : ''}</span>
      <button class="btn-sm p" onclick="evdOpenSumup(${i})">Apri</button>
    </div>`).join('')}
    <button class="btn btn-p w100" style="margin-top:10px" onclick="evdConfirmSumup()">Ho pagato — segnala allo staff</button>
  </div>`;
}
function evdOpenSumup(i) {
  const l = _evd && _evd.sumup[i];
  if (l && l.url) _openSumup(l.url);
}
async function evdPay(method) {
  const regId = _evdRegId();
  if (!regId) return toast('Iscrizione non trovata');
  const sel = _evdSelected();
  if (!sel.length) return toast('Nessuna persona da saldare selezionata');
  if (method === 'sumup') { _evdSumupOpen = true; _evdRenderPay(); return; }
  const targets = _evdTargets();
  if (method === 'cassa') {
    const {data, error} = await db.rpc('user_pay_event_cash', {
      p_user_id: currentUser.id, p_registration_id: regId, p_targets: targets
    });
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore');
    toast(data.message || 'Segnalato alla cassa: attende conferma dello staff', 'ok');
    await _evdLoad();
    await refreshUser();
    return;
  }
  // Credito: addebito immediato → conferma esplicita prima di toccare il saldo
  const n = sel.length;
  const tot = _evdSelTotal();
  modalConfirm(`Pagare ${n} ${n === 1 ? 'persona' : 'persone'} con il tuo credito?\n\nTotale addebitato: ${eur(tot)}\nSaldo attuale: ${eur(_userBalance)}`, async () => {
    const promoBefore = _promoTxKeys();
    const {data, error} = await db.rpc('user_pay_event_people', {
      p_user_id: currentUser.id, p_registration_id: regId, p_targets: targets
    });
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore pagamento');
    toast(data.message || '✅ Pagamento effettuato', 'ok');
    await _evdLoad();
    await refreshUser();           // saldo aggiornato in home
    _promoBonusToast(promoBefore);
  });
}
async function evdConfirmSumup() {
  const regId = _evdRegId();
  if (!regId) return toast('Iscrizione non trovata');
  if (!_evdSelected().length) return toast('Nessuna persona da saldare selezionata');
  const {data, error} = await db.rpc('user_pay_event_sumup_tiered', {
    p_user_id: currentUser.id, p_registration_id: regId, p_targets: _evdTargets()
  });
  if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore SumUp');
  toast(data.message || 'Segnalato allo staff: attende conferma', 'ok');
  await _evdLoad();
  await refreshUser();
}
// Rimozione di una quota non ancora saldata (correzione di un errore di inserimento)
async function evdRemoveUnit(key) {
  const regId = _evdRegId();
  const u = _evdUnits().find(x => x.key === key);
  if (!regId || !u || u.type !== 'companion') return;
  modalConfirm(`Rimuovere ${u.name} dall'iscrizione?`, async () => {
    const {data, error} = await db.rpc('user_remove_companion_from_event', {
      p_user_id: currentUser.id, p_registration_id: regId, p_companion_id: u.id
    });
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Rimozione non riuscita');
    toast(`${u.name} non partecipa più`, 'ok');
    const action = data.action || '';
    if (action === 'cancelled_full' || action === 'cancelled_after_removal') { closeEventDetail(); await refreshUser(); return; }
    await _evdLoad();
    await refreshUser();
  });
}
async function evdCancelAll() {
  const regId = _evdRegId();
  if (!regId) return toast('Iscrizione non trovata');
  const units = _evdUnits();
  const righe = units.map(u => `• ${u.name}: ${_refundRoute(u.status).txt}`).join('\n');
  const msg = `Vuoi davvero annullare TUTTA l'iscrizione?\n\n` +
    `Le persone già pagate verranno rimborsate.\n` +
    `${units.length === 1 ? '1 persona verrà rimossa' : units.length + ' persone verranno rimosse'} da "${_evd.ev.title}":\n${righe}`;
  modalConfirm(msg, async () => {
    const {data, error} = await db.rpc('user_cancel_event_registration', {
      p_user_id: currentUser.id, p_registration_id: regId
    });
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Annullamento non riuscito');
    const refunds = Array.isArray(data.refunds) ? data.refunds : [];
    const parti = refunds.map(_refundToast).filter(Boolean);
    toast(`${data.message || 'Iscrizione annullata'}${parti.length ? ' · ' + parti.join(' · ') : ''}`, 'ok');
    closeEventDetail();
    navGo('home');
    await refreshUser();      // saldo (eventuali rimborsi) + lista eventi
  });
}
function _gadgetSizes(g) { return (g && g.has_sizes && Array.isArray(g.sizes)) ? g.sizes : []; }
function selectGadgetSize(gadgetId, size) {
  _sizeSel = {..._sizeSel, [gadgetId]: size};
  renderGadgets(_gadgetsCache);
}
function renderGadgets(gads) {
  _gadgetsCache = gads || [];
  const el = document.getElementById('u-gad-list');
  if (!el) return;
  if (!_gadgetsCache.length) { el.innerHTML='<div class="empty">Nessun gadget disponibile</div>'; return; }
  el.innerHTML = `<div style="font-size:13px;color:var(--mut);margin-bottom:10px;padding:10px;background:var(--bg);border-radius:8px">
    🏪 Prenota qui e scegli come pagare: <strong>ritiri e paghi allo staff</strong> al momento della consegna
  </div>` +
  _gadgetsCache.map(g => {
    const sizes = _gadgetSizes(g);
    const sel   = _sizeSel[g.id] || '';
    const cur   = sizes.find(s => s.size === sel);
    const curAvail = cur ? Number(cur.available != null ? cur.available : cur.stock || 0) : 0;
    const needSize = g.has_sizes && !cur;
    const waitlist = !!(cur && curAvail <= 0);
    const btnLabel = needSize ? 'Scegli una taglia' : (waitlist ? 'Prenota (attesa ordine)' : '📌 Prenota');
    return `
    <div class="cat-card">
      ${g.image_url ? `<div style="margin-bottom:12px">${_imgWrap16x9(g.image_url, g.name, '12px')}</div>` : ''}
      <div class="cat-title">${_esc(g.name)}</div>
      <div class="cat-sub">${_esc(g.description||'')}</div>
      ${sizes.length ? `<div class="size-pills">${sizes.map(s => `
        <button class="size-pill ${s.size===sel?'active':''} ${Number(s.available != null ? s.available : s.stock || 0)<=0?'out':''}"
          onclick="selectGadgetSize('${g.id}','${_esc(s.size)}')">${_esc(s.size)}</button>`).join('')}</div>` : ''}
      ${waitlist ? `<div class="size-hint">⏳ Taglia esaurita. Al raggiungimento di un numero adeguato verrà effettuato l'ordine e sarai avvisato.</div>` : ''}
      <div class="cat-foot">
        <div class="cat-price">${eur(g.price)}</div>
        <div class="cat-stock">${g.has_sizes ? (cur ? 'Disp. ' + curAvail : 'Taglie disponibili') : 'Stock: ' + g.stock}</div>
        <button class="btn-sm p" ${needSize?'disabled style="opacity:.55"':''} onclick="openReserveGadget('${g.id}')">${btnLabel}</button>
      </div>
    </div>`;
  }).join('');
}
// ── METODI DI PAGAMENTO GADGET ───────────────────────────────────────
const PAY_METHODS = [
  {v: 'credito',  label: '💳 Credito'},
  {v: 'contanti', label: '💵 Contanti'},
  {v: 'sumup',    label: '🔗 SumUp'}
];
const _PM_PILL = {
  credito:  ['💳 Credito',  'pm-credito'],
  contanti: ['💵 Contanti', 'pm-contanti'],
  sumup:    ['🔗 SumUp',    'pm-sumup']
};
function payMethodPill(method) {
  const [label, cls] = _PM_PILL[method] || ['—', 'pm-contanti'];
  return `<span class="pm-pill ${cls}">${label}</span>`;
}
function _pmSegHtml(selected, onclickFn) {
  return PAY_METHODS.map(m =>
    `<button type="button" class="pm-btn ${m.v === selected ? 'active' : ''}" onclick="${onclickFn}('${m.v}')">${m.label}</button>`).join('');
}
let _gqtySize = '', _gqtyWait = false, _gqtyPay = 'credito';
function setGqtyPay(method) {
  _gqtyPay = method;
  document.getElementById('gqty-pay').innerHTML = _pmSegHtml(_gqtyPay, 'setGqtyPay');
  const note = document.getElementById('gqty-pay-note');
  const tot = _gqtyPrice * _gqtyN;
  if (_gqtyPay === 'credito') {
    note.innerHTML = `Il credito verrà addebitato dallo staff al momento della consegna.` +
      (_userBalance < tot ? `<br><span style="color:var(--neg)">Saldo attuale ${eur(_userBalance)}: ricarica prima del ritiro.</span>` : `<br>Saldo attuale: ${eur(_userBalance)}`);
  } else if (_gqtyPay === 'contanti') {
    note.textContent = 'Pagherai in contanti allo staff al momento del ritiro.';
  } else {
    note.textContent = 'Pagherai con SumUp allo staff al momento del ritiro.';
  }
}
function openReserveGadget(id) {
  const g = _gadgetsCache.find(x => x.id === id);
  if (!g) return toast('Gadget non disponibile');
  const sizes = _gadgetSizes(g);
  const sel   = _sizeSel[id] || '';
  const cur   = sizes.find(s => s.size === sel);
  if (g.has_sizes && !cur) return toast('Seleziona una taglia');
  _gqtyId = id; _gqtyName = g.name; _gqtyPrice = g.price; _gqtyN = 1;
  _gqtySize = cur ? cur.size : '';
  _gqtyWait = !!(cur && Number(cur.stock || 0) <= 0);
  document.getElementById('gqty-name').textContent = g.name;
  document.getElementById('gqty-unit').textContent = eur(g.price) + ' cad.';
  const szEl = document.getElementById('gqty-size');
  szEl.textContent = _gqtySize ? 'Taglia ' + _gqtySize : '';
  szEl.style.display = _gqtySize ? '' : 'none';
  const wEl = document.getElementById('gqty-wait');
  wEl.textContent = _gqtyWait ? '⏳ Taglia esaurita: la prenotazione andrà in lista d\'attesa. Al raggiungimento di un numero adeguato verrà effettuato l\'ordine e sarai avvisato.' : '';
  wEl.style.display = _gqtyWait ? '' : 'none';
  document.getElementById('gqty-n').textContent = 1;
  document.getElementById('gqty-total').textContent = 'Totale: ' + eur(g.price);
  setGqtyPay('credito');
  document.getElementById('gqty-bg').style.display = 'flex';
}
function gqtyAdj(delta) {
  _gqtyN = Math.min(10, Math.max(1, _gqtyN + delta));
  document.getElementById('gqty-n').textContent = _gqtyN;
  document.getElementById('gqty-total').textContent = 'Totale: ' + eur(_gqtyPrice * _gqtyN);
  setGqtyPay(_gqtyPay);
}
function closeGqty() { document.getElementById('gqty-bg').style.display = 'none'; }
async function confirmGqty() {
  closeGqty();
  const {data, error} = await db.rpc('user_reserve_gadget', {
    p_user_id: currentUser.id, p_gadget_id: _gqtyId, p_quantity: _gqtyN,
    p_size: _gqtySize || null, p_payment_method: _gqtyPay
  });
  if (error || !data || !data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore prenotazione');
  toast(data.waitlist
    ? '⏳ Sei in lista d\'attesa: ti avviseremo quando arriverà l\'ordine.'
    : 'Prenotato · da ritirare presso lo staff', 'ok');
  await refreshUser();
  await loadCatalog();
}
// ── ACCOMPAGNATORI ───────────────────────────────────────────────────
function _renderCompModal(mode) {
  // Self row (user mode + evento con prezzo)
  const selfEl = document.getElementById('comp-self-row');
  const selfReg = (_compMode === 'user') ? (Object.values(_myEventRegs).find(r => r.registration_id === _compRegId) || {}) : {};
  const selfCheckedIn = !!selfReg.checked_in;
  const selfName = (currentUser && currentUser.display_name) ? currentUser.display_name : 'Tu';
  if (mode === 'user' && _compEventPrice > 0) {
    const paid = _compSelfStatus && _compSelfStatus !== 'da_saldare';
    selfEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--brd);min-height:36px">
      ${!paid ? `<input type="checkbox" id="chk-self" onchange="_updateCompTotal()" style="width:16px;height:16px;flex-shrink:0">` : '<span style="width:16px;flex-shrink:0"></span>'}
      <div style="flex:1;min-width:0;font-size:14px">${_esc(selfName)} (tu)</div>
      ${selfCheckedIn ? '<span style="font-size:11px;color:var(--grn);flex-shrink:0">✅ Check-in</span>' : ''}
      <span class="badge ${paid?'bg':'by'}" style="flex-shrink:0">${paid?'✓ Pagato':'⏳ Da pagare'}</span>
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
      return `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--brd);min-height:36px">
        ${(!paid && _compEventPrice > 0) ? `<input type="checkbox" id="chk-c-${c.id}" onchange="_updateCompTotal()" style="width:16px;height:16px;flex-shrink:0">` : '<span style="width:16px;flex-shrink:0"></span>'}
        <div style="flex:1;min-width:0;font-size:14px">${_esc(c.nome)} ${_esc(c.cognome)}</div>
        ${c.checked_in ? '<span style="font-size:11px;color:var(--grn);flex-shrink:0">✅ Check-in</span>' : ''}
        <span class="badge ${paid?'bg':'by'}" style="flex-shrink:0">${paid?'✓ Pagato':'⏳ Da pagare'}</span>
        ${!paid ? `<button class="btn-sm" style="color:var(--neg);font-size:11px;padding:2px 6px;flex-shrink:0" title="Rimuovi" onclick="removeCompanion('${c.id}')">×</button>` : ''}
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
    const selfUnpaid = !_compSelfStatus || _compSelfStatus === 'da_saldare';
    const anyCompanionUnpaid = _compCache.some(c => !c.payment_status || c.payment_status === 'da_saldare');
    if (!selfUnpaid && !anyCompanionUnpaid) {
      footerEl.style.display = '';
      footerEl.innerHTML = `<div style="font-size:13px;color:var(--grn);text-align:center;padding:6px 0;font-weight:600">✓ Tutti pagati</div>`;
    } else {
      footerEl.style.display = '';
      _updateCompTotal();
    }
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
  const total = count * _compEventPrice;
  const canCredit = _userBalance >= total;
  const sumup = _compSumupLink || '';
  const sumupBtn = sumup
    ? `<a href="${sumup}" target="_blank" rel="noopener" class="btn btn-g w100" style="margin-top:6px;text-align:center;text-decoration:none;display:block">📱 Paga con SumUp</a>
       <div style="font-size:11px;color:var(--mut);margin-top:6px;text-align:center">Dopo il pagamento, la cassa confermerà le persone selezionate</div>`
    : '';
  if (count > 0) {
    const creditBtn = canCredit
      ? `<button class="btn btn-p w100" onclick="userPaySelected()">💳 Paga con credito</button>`
      : `<div style="font-size:12px;color:var(--mut);text-align:center;padding:6px 0">Credito insufficiente per pagare (${eur(_userBalance)} disponibili)</div>`;
    footerEl.innerHTML =
      `<div style="font-size:13px;margin-bottom:8px">💰 ${count} ${count===1?'persona':'persone'} × ${eur(_compEventPrice)} = <strong>${eur(total)}</strong></div>
       ${creditBtn}
       ${sumupBtn}`;
  } else {
    footerEl.innerHTML =
      `<div style="font-size:12px;color:var(--mut);text-align:center;padding:4px 0">Seleziona chi vuoi pagare</div>
       ${sumupBtn}`;
  }
}
function openCompanionsModal(regId) {
  _compMode = 'user'; _compRegId = regId;
  const reg = Object.values(_myEventRegs).find(r => r.registration_id === regId) || {};
  _compCache = (reg.companions || []).map(c => ({...c}));
  _compEventPrice = reg.event_price || 0;
  _compSelfStatus = reg.payment_status || 'da_saldare';
  _compEventTitle = reg.event_title || '';
  _compSumupLink = reg.event_sumup_link || '';
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
    await loadUserEvents();
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
    await loadUserEvents();
  }
}
async function userPaySelected() {
  const self_selected = document.getElementById('chk-self')?.checked || false;
  const companion_ids = _compCache
    .filter(c => (!c.payment_status || c.payment_status === 'da_saldare') && document.getElementById('chk-c-' + c.id)?.checked)
    .map(c => c.id);
  if (!self_selected && !companion_ids.length) return toast('Seleziona almeno una persona');
  const count = (self_selected ? 1 : 0) + companion_ids.length;
  const total = count * _compEventPrice;
  modalConfirm(`Pagare ${eur(total)} per ${count} ${count===1?'persona':'persone'} con il credito?`, async () => {
    const promoBefore = _promoTxKeys();
    const {data, error} = await db.rpc('user_pay_event_people', {
      p_user_id: currentUser.id,
      p_registration_id: _compRegId,
      p_targets: {self: self_selected, companion_ids}
    });
    if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore pagamento');
    toast(data.message || '✅ Pagamento effettuato!', 'ok');
    await refreshUser();
    _promoBonusToast(promoBefore);
    await loadUserEvents();
    const reg = Object.values(_myEventRegs).find(r => r.registration_id === _compRegId) || {};
    _compCache = (reg.companions || []).map(c => ({...c}));
    _compSelfStatus = reg.payment_status || 'da_saldare';
    _renderCompModal('user');
  });
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
// ── I MIEI GADGET ────────────────────────────────────────────────────
const _RES_BADGE = {
  prenotato:     ['🟡 Prenotato',    'pb-wait'],
  attesa_ordine: ['🟠 Attesa ordine','pb-wait'],
  consegnato:    ['🟢 Consegnato',   'pb-ok'],
  annullato:     ['⚪ Annullato',     'pb-off']
};
function resBadge(status) {
  const [label, cls] = _RES_BADGE[status] || [status || '—', 'pb-off'];
  return `<span class="pb ${cls}">${label}</span>`;
}
function _resId(r) { return r.reservation_id || r.id || ''; }
function _resUnit(r) {
  const tot = Number(r.payment_amount != null ? r.payment_amount : (r.total_price || 0));
  const qty = Number(r.quantity || 1) || 1;
  return tot > 0 ? tot / qty : Number(r.price || 0);
}
async function loadUserGadgetReservations() {
  const el = document.getElementById('ut-gad-reservations');
  if (!el) return;
  let list = _myGadgetRes;
  if (!Array.isArray(list)) {
    const {data} = await db.rpc('user_list_gadget_reservations', {p_user_id: currentUser.id});
    list = Array.isArray(data) ? data : [];
  }
  const active = list.filter(r => (r.status || '') !== 'annullato');
  if (!active.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-lbl" style="margin-top:16px">Le mie prenotazioni gadget</div>` +
    active.map(r => {
      const id   = _resId(r);
      const mod  = r.status === 'prenotato' || r.status === 'attesa_ordine';
      const done = r.status === 'consegnato';
      const tot  = r.payment_amount != null ? r.payment_amount : r.total_price;
      return `<div class="card" style="margin-bottom:8px;padding:12px">
        <div class="dlv-row">
          <div class="dlv-main">
            <div style="font-weight:600;font-size:15px">
              ${_esc(r.gadget_name)}${r.size ? ` · <span class="dlv-size">Taglia ${_esc(r.size)}</span>` : ''}
              <span style="color:var(--mut);font-weight:500"> · x${r.quantity}</span>
            </div>
            <div style="font-size:13px;color:var(--gold);font-weight:700;margin-top:2px">${eur(tot)}</div>
          </div>
          ${resBadge(r.status)}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px">
          ${payMethodPill(r.payment_method)}
          ${done
            ? `<span style="font-size:12px;color:var(--grn)">✅ Consegnato il ${r.fulfilled_at ? fdt(r.fulfilled_at).split(' ')[0] : '—'}</span>`
            : `<span style="font-size:11px;color:var(--mut)">Pagherai allo staff al ritiro</span>`}
        </div>
        ${mod ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button class="btn-sm" onclick="openGmod('${id}')">✏️ Modifica</button>
          <button class="btn-sm" style="color:var(--neg)" onclick="cancelGadgetReservation('${id}')">🗑 Annulla</button>
        </div>` : ''}
      </div>`;
    }).join('');
}
function _findMyRes(resId) {
  const list = Array.isArray(_myGadgetRes) ? _myGadgetRes : [];
  return list.find(r => _resId(r) === resId) || null;
}
let _gmodRes = null;
async function openGmod(resId) {
  let r = _findMyRes(resId);
  if (!r) {
    const {data} = await db.rpc('user_list_gadget_reservations', {p_user_id: currentUser.id});
    _myGadgetRes = Array.isArray(data) ? data : [];
    r = _findMyRes(resId);
  }
  if (!r) return toast('Prenotazione non trovata');
  _gmodRes = r;
  document.getElementById('gmod-name').textContent = `${r.gadget_name} · ${eur(_resUnit(r))} cad.`;
  const g = _gadgetsCache.find(x => x.id === r.gadget_id) || _gadgetsCache.find(x => x.name === r.gadget_name);
  const hasSizes = !!(r.has_sizes || (g && g.has_sizes) || r.size);
  const fg  = document.getElementById('gmod-size-fg');
  const sel = document.getElementById('gmod-size');
  if (hasSizes) {
    const sizes = _gadgetSizes(g).map(s => s.size);
    const opts  = sizes.length ? sizes : PRESET_SIZES;
    if (r.size && !opts.includes(r.size)) opts.unshift(r.size);
    sel.innerHTML = opts.map(s => `<option value="${_esc(s)}"${s === r.size ? ' selected' : ''}>${_esc(s)}</option>`).join('');
    fg.style.display = '';
  } else {
    sel.innerHTML = ''; fg.style.display = 'none';
  }
  document.getElementById('gmod-qty').value = r.quantity || 1;
  setGmodPay(r.payment_method || 'credito');
  document.getElementById('gmod-bg').classList.add('open');
}
let _gmodPay = 'credito';
function setGmodPay(method) {
  _gmodPay = method;
  document.getElementById('gmod-pay').innerHTML = _pmSegHtml(_gmodPay, 'setGmodPay');
  updateGmodDiff();
}
function closeGmod() { document.getElementById('gmod-bg').classList.remove('open'); _gmodRes = null; }
function _gmodDiff() {
  if (!_gmodRes) return 0;
  const qty = parseInt(document.getElementById('gmod-qty').value) || 0;
  return +(_resUnit(_gmodRes) * (qty - (Number(_gmodRes.quantity) || 0))).toFixed(2);
}
function updateGmodDiff() {
  const el = document.getElementById('gmod-diff');
  if (!el || !_gmodRes) return;
  const qty = parseInt(document.getElementById('gmod-qty').value) || 0;
  const tot = _resUnit(_gmodRes) * qty;
  const label = (_PM_PILL[_gmodPay] || ['—'])[0];
  el.innerHTML = `Nuovo totale: <strong>${eur(tot)}</strong> — ${label}` +
    `<div style="color:var(--mut);font-size:11px;margin-top:2px">Nessun addebito ora: paghi allo staff alla consegna.</div>`;
}
async function saveGmod() {
  if (!_gmodRes) return;
  const r    = _gmodRes;
  const qty  = parseInt(document.getElementById('gmod-qty').value) || 0;
  const size = document.getElementById('gmod-size-fg').style.display === 'none'
    ? null : (document.getElementById('gmod-size').value || null);
  if (qty < 1) return toast('Quantità non valida');
  const pay = _gmodPay;
  const unchanged = qty === (Number(r.quantity) || 0)
    && (size || null) === (r.size || null)
    && pay === (r.payment_method || 'credito');
  if (unchanged) { closeGmod(); return; }
  const run = async () => {
    const {data, error} = await db.rpc('user_modify_gadget_reservation', {
      p_user_id: currentUser.id, p_reservation_id: _resId(r),
      p_new_size: size, p_new_quantity: qty, p_new_payment_method: pay
    });
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore modifica');
    toast(data.message || '✅ Prenotazione aggiornata', 'ok');
    await refreshUser();
    await loadCatalog();
  };
  closeGmod();
  const dett = [
    size ? `Taglia: ${size}` : null,
    `Quantità: ${qty}`,
    `Metodo: ${(_PM_PILL[pay] || ['—'])[0]}`,
    `Totale: ${eur(_resUnit(r) * qty)}`
  ].filter(Boolean).join('\n');
  modalConfirm(`Confermi la modifica della prenotazione?\n\n${dett}\n\nPagherai allo staff al momento della consegna.`, run);
}
async function cancelGadgetReservation(reservationId) {
  modalConfirm('Sei sicuro di voler annullare?\n\nLa prenotazione verrà cancellata.', async () => {
    const {data, error} = await db.rpc('user_cancel_gadget_reservation', {p_user_id: currentUser.id, p_reservation_id: reservationId});
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore');
    let msg = data.message || 'Prenotazione annullata';
    if (data.method === 'credito') msg = `Rimborsato ${eur(data.refunded || 0)} sul credito`;
    else if (data.method === 'sumup') msg = 'Il rimborso sarà gestito dallo staff';
    toast(msg, 'ok');
    await refreshUser();
    await loadCatalog();
  });
}
function renderPromos(prs) {
  const el = document.getElementById('ut-promo');
  if (!prs.length) { el.innerHTML='<div class="empty">Nessuna promo attiva</div>'; return; }
  el.innerHTML = prs.map(p=>`
    <div class="promo-row">
      ${p.image_url ? `<div style="margin-bottom:12px">${_imgWrap16x9(p.image_url, p.code, '12px')}</div>` : ''}
      <div class="promo-code">${p.code}</div>
      <div class="promo-desc">${p.description||''}</div>
      <div class="promo-detail">${p.discount_type==='percent'?p.discount_value+'%':eur(p.discount_value)} di sconto${p.valid_until?' · fino al '+fdt(p.valid_until).split(' ')[0]:''}</div>
    </div>`).join('');
}
// "Ricarica tessera": SOLO ricariche del saldo (event_id NULL, attivi, per
// sort_order). I link legati a un evento sono quote di partecipazione e vivono
// esclusivamente nella schermata SumUp del dettaglio evento.
async function renderSumUp(links) {
  _sumupLinksCache = await _sumupWithEventIds(links || []);
  const generici = _sumupLinksCache
    .filter(l => !l.event_id && l.active !== false)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const el = document.getElementById('u-sumup');
  if (!el) return;
  el.innerHTML = generici.length
    ? generici.map(l => `<a href="${l.url}" target="_blank" rel="noopener" class="sumup-btn">${_esc(l.label)}</a>`).join('')
    : '<div class="empty" style="grid-column:1/-1">Nessun importo di ricarica disponibile</div>';
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
// Blocco "Da saldare" in home: solo un promemoria che porta al dettaglio evento,
// dove vivono tutti i pagamenti (uno per persona).
function renderPendingEvents(evs) {
  const el = document.getElementById('u-pending-events');
  if (!evs || !evs.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-title" style="margin-bottom:8px">Da saldare</div>` +
    evs.map(e => `<button class="ev-row" onclick="openEventDetail('${e.event_id}')">
      <span class="ev-row-date">${_evShortDate(e.event_date)}</span>
      <span class="ev-row-main">
        <span class="ev-row-ttl">${_esc(e.evento || 'Evento')}</span>
        <span class="ev-row-sub">Quota da saldare · ${eur(e.amount)}</span>
      </span>
      <span class="pb pb-wait">Da saldare</span>
      <span class="ev-row-chev">›</span>
    </button>`).join('');
}
async function userPayEventCredit(regId, eventName, amount) {
  modalConfirm(`Pagare "${eventName}" (${eur(amount)}) con il tuo credito?`, async () => {
    const promoBefore = _promoTxKeys();
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
    _promoBonusToast(promoBefore);
  });
}
// Segnale UI per il bonus promo. Nessun calcolo di soglie o percentuali lato client:
// si confronta l'elenco delle transazioni 'promo_bonus' prima e dopo il pagamento e
// si mostra l'importo che il backend ha effettivamente accreditato.
// _promoTxKeys() va chiamata PRIMA dell'RPC, _promoBonusToast() dopo await refreshUser().
function _promoTxKey(t) { return t.id != null ? String(t.id) : `${t.created_at}|${t.amount}`; }
function _promoTxKeys() {
  return new Set((_allTx || []).filter(t => t.type === 'promo_bonus').map(_promoTxKey));
}
function _promoBonusToast(keysBefore) {
  if (!keysBefore) return;
  const nuovi = (_allTx || []).filter(t =>
    t.type === 'promo_bonus' && Number(t.amount) > 0 && !keysBefore.has(_promoTxKey(t)));
  const bonus = nuovi.reduce((s, t) => s + Number(t.amount || 0), 0);
  if (!(bonus > 0.01)) return;
  setTimeout(() => {
    toast(`🌴 Bonus Promo accreditato! +${eur(bonus)}`, 'ok');
  }, 1500);
}
function _openSumup(link) {
  if (!link) return;
  const w = window.open(link, '_blank', 'noopener');
  if (!w) modalInfo(`📱 Completa il pagamento SumUp\n\nApri questo link dal tuo browser:\n${link}`);
}

// ── LE MIE ISCRIZIONI (legacy) ───────────────────────────────────────
// Vecchie card iscrizione del socio: non più disegnate (le sostituisce la lista
// compatta + openEventDetail). Restano solo le utility ancora usate altrove
// (payBadge, _refundRoute, _refundToast); il resto è da rimuovere a Fase 2 conclusa.
const _PAY_BADGE = {
  da_saldare:       ['🟡 Da saldare',        'pb-wait'],
  sumup_in_attesa:  ['🟠 In attesa conferma','pb-wait'],
  cassa_in_attesa:  ['🟠 Attende cassa',     'pb-cash'],
  saldato_cassa:    ['🟢 Pagato in cassa',   'pb-ok'],
  saldato_credito:  ['🟢 Pagato credito',    'pb-ok'],
  saldato_sumup:    ['🟢 Pagato SumUp',      'pb-ok'],
  saldato_contanti: ['🟢 Pagato in cassa',   'pb-ok'],
  gratuito:         ['🟢 Gratuito',          'pb-ok'],
  annullato:        ['⚪ Annullato',          'pb-off']
};
function payBadge(status) {
  const [label, cls] = _PAY_BADGE[status] || [status || '—', 'pb-off'];
  return `<span class="pb ${cls}">${label}</span>`;
}
function _regId(r) { return r.registration_id || r.id || ''; }
// Il socio partecipa ancora di persona?
function _selfIncluded(r) {
  if (r.self_included != null) return !!r.self_included;
  return (r.payment_status || '') !== 'annullato';
}
// Solo accompagnatori attivi (il backend li filtra già, difensivo)
function _activeComps(r) {
  return (r.companions || []).filter(c => (c.status || 'attivo') === 'attivo');
}
// Modifiche consentite solo prima della data evento
function _canEditReg(r) {
  if (r.can_edit != null) return !!r.can_edit;
  return r.event_date ? new Date(r.event_date) > new Date() : true;
}
function _regUnpaid(r) {
  const self = _selfIncluded(r) && (r.payment_status || '') === 'da_saldare';
  const comps = _activeComps(r).filter(c => (c.payment_status || 'da_saldare') === 'da_saldare');
  return {self, comps, count: (self ? 1 : 0) + comps.length};
}
// Metodo dichiarato per una quota evento (credito / sumup / cassa)
const _EV_PM = {
  credito: ['💳 Credito', 'pm-credito'],
  sumup:   ['🔗 SumUp',   'pm-sumup'],
  cassa:   ['💵 Cassa',   'pm-contanti']
};
function evMethodPill(method) {
  const cfg = _EV_PM[method];
  return cfg ? `<span class="pm-pill ${cfg[1]}">${cfg[0]}</span>` : '';
}
// Superata dalla lista compatta: "Le mie iscrizioni" è una sezione di
// renderUserEvents() e il dettaglio della singola iscrizione vive in
// openEventDetail(). Resta solo per svuotare il vecchio contenitore.
function renderMyRegistrations() {
  const el = document.getElementById('u-my-regs');
  if (el) el.innerHTML = '';
}
const _PAY_BLOCKS = {
  credito: {cls: 'pay-credito', title: '💳 Paga col credito', btn: 'Paga col credito'},
  sumup:   {cls: 'pay-sumup',   title: '🔗 Paga con SumUp',   btn: 'Vai a SumUp'},
  cassa:   {cls: 'pay-cassa',   title: '💵 Paga in cassa',    btn: 'Segnala alla cassa'}
};
function _payPickHtml(r, method) {
  const cfg = _PAY_BLOCKS[method];
  const id = _regId(r);
  const up = _regUnpaid(r);
  const rows = [];
  if (up.self) rows.push(`<label class="pr-row">
      <input type="checkbox" class="pr-chk" id="mrp-${method}-${id}-self">
      <span class="pr-name">${_esc(currentUser.display_name)}</span></label>`);
  up.comps.forEach(c => rows.push(`<label class="pr-row">
      <input type="checkbox" class="pr-chk" id="mrp-${method}-${id}-${c.id}">
      <span class="pr-name">${_esc(c.nome)} ${_esc(c.cognome)}</span></label>`));
  return `<div class="pay-blk ${cfg.cls}">
    <div class="pay-blk-t">${cfg.title}</div>
    ${rows.join('')}
    <button class="btn btn-p w100" style="margin-top:8px" onclick="myRegPay('${id}','${method}')">${cfg.btn}</button>
  </div>`;
}
// Popover inline per scegliere il metodo (usato da ✏️ e da "Ripartecipa")
function _pmPopHtml(popId, sumupLink, onpick) {
  const methods = ['credito'].concat(sumupLink ? ['sumup'] : []).concat(['cassa']);
  return `<div class="pm-pop" id="${popId}" style="display:none">
    ${methods.map(m => `<button class="pm-btn" onclick="(${onpick})('${m}')">${_EV_PM[m][0]}</button>`).join('')}
  </div>`;
}
function togglePmPop(popId) {
  const el = document.getElementById(popId);
  if (!el) return;
  document.querySelectorAll('.pm-pop').forEach(p => { if (p.id !== popId) p.style.display = 'none'; });
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}
function _regRowHtml(r, unit) {
  const id = _regId(r);
  const canEdit = _canEditReg(r);
  const status  = unit.status || 'da_saldare';
  const key     = unit.type === 'self' ? 'self' : unit.id;
  const popId   = `pmpop-${id}-${key}`;
  const sumupLink = r.event_sumup_link || r.sumup_link || '';
  const canChange = canEdit && status === 'da_saldare';
  return `<div class="pr-row">
      <span class="pr-name">${_esc(unit.name)}${unit.type === 'self' ? ' <span style="color:var(--mut);font-size:11px">(tu)</span>' : ''}</span>
      ${status === 'da_saldare' && unit.method ? evMethodPill(unit.method) : ''}
      ${payBadge(status)}
      ${canChange ? `<button class="row-act" title="Cambia metodo di pagamento" onclick="togglePmPop('${popId}')">✏️</button>` : ''}
      ${canEdit ? `<button class="row-act danger" title="Rimuovi dall'iscrizione" onclick="myRegRemove('${id}','${unit.type}','${key}')">🗑</button>` : ''}
    </div>
    ${canChange ? _pmPopHtml(popId, sumupLink, `(m)=>myRegChangeMethod('${id}','${unit.type}','${key}',m)`) : ''}`;
}
function _myRegCard(r) {
  const id = _regId(r);
  const title = r.event_title || r.evento || 'Evento';
  const date  = r.event_date ? fdt(r.event_date) : '—';
  const loc   = r.event_location || r.location || '';
  const up    = _regUnpaid(r);
  const selfIn  = _selfIncluded(r);
  const canEdit = _canEditReg(r);
  const comps = _activeComps(r);
  const sumupLink = r.event_sumup_link || r.sumup_link || '';
  const price = Number(r.event_price || r.amount || 0);
  const canCredit = price <= 0 || _userBalance >= price;
  const declared = (r.sumup_pending_count != null || r.cassa_pending_count != null)
    ? _num(r.sumup_pending_count) + _num(r.cassa_pending_count)
    : null;
  const statuses = (selfIn ? [r.payment_status] : []).concat(comps.map(c => c.payment_status || 'da_saldare'));
  const pend = declared != null ? declared : statuses.filter(s => String(s || '').endsWith('_in_attesa')).length;
  const rows = (selfIn
      ? [_regRowHtml(r, {type: 'self', name: currentUser.display_name, status: r.payment_status, method: r.payment_method})]
      : [])
    .concat(comps.map(c => _regRowHtml(r, {
      type: 'companion', id: c.id, name: `${c.nome} ${c.cognome}`,
      status: c.payment_status || 'da_saldare', method: c.payment_method
    })));
  return `<div class="card" style="margin-bottom:10px">
    <div style="font-weight:700;font-size:15px">${_esc(title)}</div>
    <div class="cat-sub">${date}${loc ? ' · ' + _esc(loc) : ''}</div>
    ${pend > 0 ? `<div style="font-size:12px;color:var(--gold);margin-bottom:6px">🟠 ${pend} pagament${pend === 1 ? 'o' : 'i'} in attesa di conferma dello staff</div>` : ''}
    ${!selfIn && canEdit ? `<div class="leave-banner">
        <span>🚪 Hai lasciato l'evento</span>
        <button class="btn-sm" onclick="togglePmPop('pmpop-${id}-rejoin')">Ripartecipa</button>
      </div>
      ${_pmPopHtml(`pmpop-${id}-rejoin`, sumupLink, `(m)=>myRegRejoin('${id}',m)`)}` : ''}
    ${!selfIn && !canEdit ? `<div class="pay-blk-hint">🚪 Non partecipi più a questo evento.</div>` : ''}
    <div style="margin:8px 0">${rows.join('')}</div>
    ${canEdit ? `<button class="btn-sm" onclick="openCompanionsModal('${id}')">➕ Aggiungi persone</button>` : ''}
    ${up.count > 0 ? `<div class="pay-blk-hint">Scegli come pagare: puoi usare metodi diversi per persone diverse.</div>` : ''}
    ${up.count > 0 && canCredit ? _payPickHtml(r, 'credito') : ''}
    ${up.count > 0 && !canCredit ? `<div class="pay-blk-hint">💳 Credito non sufficiente per pagare una quota (${eur(_userBalance)} disponibili).</div>` : ''}
    ${up.count > 0 && sumupLink ? _payPickHtml(r, 'sumup') : ''}
    ${up.count > 0 ? _payPickHtml(r, 'cassa') : ''}
    ${canEdit
      ? `<div style="margin-top:12px;text-align:right"><a href="#" class="link-danger" onclick="myRegCancelAll('${id}');return false">🗑 Annulla tutta l'iscrizione</a></div>`
      : `<div class="past-note">Evento passato — modifiche non disponibili</div>`}
  </div>`;
}
async function myRegPay(regId, method) {
  const r = _myRegs.find(x => _regId(x) === regId);
  if (!r) return toast('Iscrizione non trovata');
  const up = _regUnpaid(r);
  const self = document.getElementById(`mrp-${method}-${regId}-self`)?.checked || false;
  const companion_ids = up.comps.filter(c => document.getElementById(`mrp-${method}-${regId}-${c.id}`)?.checked).map(c => c.id);
  if (!self && !companion_ids.length) return toast('Seleziona almeno una persona');
  const n = (self ? 1 : 0) + companion_ids.length;
  const price = r.event_price || r.amount || 0;
  const tot = eur(price * n);
  const quote = `${n} ${n === 1 ? 'quota' : 'quote'}`;
  const msg = {
    credito: `Pagare ${quote} con il tuo credito?\n\nTotale addebitato: ${tot}`,
    sumup:   `Segnare ${quote} come pagate con SumUp?\n\nTotale: ${tot}\nLo staff dovrà confermare il pagamento.`,
    cassa:   `Segnalare alla cassa ${quote} da pagare in contanti?\n\nTotale: ${tot}\nIl cassiere dovrà confermare l'incasso.`
  }[method];
  const rpc = {credito: 'user_pay_event_people', sumup: 'user_pay_event_sumup', cassa: 'user_pay_event_cash'}[method];
  if (!rpc) return toast('Metodo di pagamento non valido');
  modalConfirm(msg, async () => {
    const promoBefore = _promoTxKeys();
    const {data, error} = await db.rpc(rpc, {p_user_id: currentUser.id, p_registration_id: regId, p_targets: {self, companion_ids}});
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore pagamento');
    if (method === 'sumup') { _openSumup(data.sumup_link); toast('Attende conferma dello staff', 'ok'); }
    else if (method === 'cassa') toast('Segnalato al cassiere. Attende conferma.', 'ok');
    else toast('✅ Pagamento effettuato!', 'ok');
    await refreshUser();
    await loadCatalog();
    _promoBonusToast(promoBefore);
  });
}

// ── MODIFICA / RIMOZIONE QUOTE ISCRIZIONE (socio) ────────────────────
function _findMyReg(regId) { return _myRegs.find(x => _regId(x) === regId) || null; }
function _unitName(r, targetType, targetId) {
  if (targetType === 'self') return currentUser.display_name;
  const c = _activeComps(r).find(x => String(x.id) === String(targetId));
  return c ? `${c.nome} ${c.cognome}` : 'questa persona';
}
function _unitStatus(r, targetType, targetId) {
  if (targetType === 'self') return r.payment_status || 'da_saldare';
  const c = _activeComps(r).find(x => String(x.id) === String(targetId));
  return (c && c.payment_status) || 'da_saldare';
}
// Come verrà gestito il rimborso in base allo stato di pagamento
function _refundRoute(status) {
  if (status === 'saldato_credito') return {refund: true, queued: false, txt: 'rimborso immediato sul credito'};
  if (status === 'saldato_sumup')   return {refund: true, queued: true,  txt: 'rimborso SumUp gestito dallo staff'};
  if (status === 'saldato_cassa' || status === 'saldato_contanti') return {refund: true, queued: true, txt: 'rimborso in contanti gestito dallo staff'};
  return {refund: false, queued: false, txt: 'nessun importo da rimborsare'};
}
function _refundToast(refund) {
  if (!refund) return '';
  const amt = _num(refund.amount, refund.refunded);
  if (!amt) return '';
  const queued = refund.queued || refund.method === 'sumup' || refund.method === 'cassa' || refund.method === 'contanti';
  return queued ? `Rimborso di ${eur(amt)} in carico allo staff` : `Rimborsato ${eur(amt)} sul credito`;
}
async function _afterRegChange(action) {
  await refreshUser();
  if (action === 'cancelled_full' || action === 'cancelled_after_removal') await loadCatalog();
  else renderMyRegistrations();
}
async function myRegChangeMethod(regId, targetType, targetId, method) {
  const r = _findMyReg(regId);
  if (!r) return toast('Iscrizione non trovata');
  const {data, error} = await db.rpc('user_change_event_payment_method', {
    p_user_id: currentUser.id,
    p_registration_id: regId,
    p_target_type: targetType,
    p_target_id: targetType === 'self' ? regId : targetId,
    p_new_method: method
  });
  if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Metodo non modificabile');
  toast(data.message || `Metodo aggiornato: ${(_EV_PM[method] || ['—'])[0]}`, 'ok');
  await refreshUser();
  renderMyRegistrations();
}
async function myRegRemove(regId, targetType, targetId) {
  const r = _findMyReg(regId);
  if (!r) return toast('Iscrizione non trovata');
  const name   = _unitName(r, targetType, targetId);
  const status = _unitStatus(r, targetType, targetId);
  const route  = _refundRoute(status);
  const price  = Number(r.event_price || r.amount || 0);
  const selfIn = _selfIncluded(r);
  const comps  = _activeComps(r);
  const restanti = (targetType === 'self' ? comps.length : (selfIn ? 1 : 0) + comps.length - 1);
  const msg = `Rimuovere ${targetType === 'self' ? 'te stesso' : name} da "${r.event_title || 'questo evento'}"?\n\n` +
    (route.refund ? `Quota pagata: ${eur(price)} — ${route.txt}\n` : `${route.txt}\n`) +
    (restanti <= 0 ? '\n⚠️ Non resta nessuno: l\'iscrizione verrà annullata.' : `\nRestano ${restanti} ${restanti === 1 ? 'persona iscritta' : 'persone iscritte'}.`);
  modalConfirm(msg, async () => {
    const rpc = targetType === 'self' ? 'user_remove_self_from_event' : 'user_remove_companion_from_event';
    const args = targetType === 'self'
      ? {p_user_id: currentUser.id, p_registration_id: regId}
      : {p_user_id: currentUser.id, p_registration_id: regId, p_companion_id: targetId};
    const {data, error} = await db.rpc(rpc, args);
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Rimozione non riuscita');
    const action = data.action || '';
    const rMsg = _refundToast(data.refund);
    const base = (action === 'cancelled_full' || action === 'cancelled_after_removal')
      ? 'Iscrizione annullata'
      : (targetType === 'self' ? 'Hai lasciato l\'evento' : `${name} non partecipa più`);
    toast(`${base}${rMsg ? ' · ' + rMsg : ''}`, 'ok');
    await _afterRegChange(action);
    if (data.refund && (data.refund.queued || ['sumup', 'cassa', 'contanti'].includes(data.refund.method))) {
      modalInfo('↩️ Rimborso in lavorazione\n\nIl rimborso in contanti/SumUp sarà gestito dallo staff: ti verrà consegnato in cassa.');
    }
  });
}
async function myRegCancelAll(regId) {
  const r = _findMyReg(regId);
  if (!r) return toast('Iscrizione non trovata');
  const price  = Number(r.event_price || r.amount || 0);
  const selfIn = _selfIncluded(r);
  const units  = (selfIn ? [{name: currentUser.display_name + ' (tu)', status: r.payment_status}] : [])
    .concat(_activeComps(r).map(c => ({name: `${c.nome} ${c.cognome}`, status: c.payment_status || 'da_saldare'})));
  const righe = units.map(u => `• ${u.name}: ${_refundRoute(u.status).txt}`).join('\n');
  const daRimborsare = units.filter(u => _refundRoute(u.status).refund).length;
  const msg = `Annullare tutta l'iscrizione a "${r.event_title || 'questo evento'}"?\n\n` +
    `${units.length === 1 ? '1 persona verrà rimossa' : units.length + ' persone verranno rimosse'}:\n${righe}\n\n` +
    (daRimborsare ? `Totale da rimborsare: ${eur(price * daRimborsare)}` : 'Nessun importo da rimborsare.');
  modalConfirm(msg, async () => {
    const {data, error} = await db.rpc('user_cancel_event_registration', {p_user_id: currentUser.id, p_registration_id: regId});
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Annullamento non riuscito');
    const refunds = Array.isArray(data.refunds) ? data.refunds : [];
    const imm = refunds.filter(x => _num(x.amount, x.refunded) > 0 && !(x.queued || ['sumup', 'cassa', 'contanti'].includes(x.method)));
    const qd  = refunds.filter(x => _num(x.amount, x.refunded) > 0 && (x.queued || ['sumup', 'cassa', 'contanti'].includes(x.method)));
    const sum = arr => arr.reduce((s, x) => s + _num(x.amount, x.refunded), 0);
    const parti = [];
    if (imm.length) parti.push(`rimborsati ${eur(sum(imm))} sul credito`);
    if (qd.length)  parti.push(`${eur(sum(qd))} in carico allo staff`);
    toast(`Iscrizione annullata${parti.length ? ' · ' + parti.join(' · ') : ''}`, 'ok');
    await _afterRegChange('cancelled_full');
    if (qd.length) {
      modalInfo(`↩️ Rimborso in lavorazione\n\nIl rimborso in contanti/SumUp (${eur(sum(qd))}) sarà gestito dallo staff: ti verrà consegnato in cassa.`);
    }
  });
}
async function myRegRejoin(regId, method) {
  const r = _findMyReg(regId);
  if (!r) return toast('Iscrizione non trovata');
  const price = Number(r.event_price || r.amount || 0);
  const label = (_EV_PM[method] || ['—'])[0];
  modalConfirm(`Ripartecipare a "${r.event_title || 'questo evento'}"?\n\nQuota: ${eur(price)}\nMetodo dichiarato: ${label}\nLa quota risulterà da saldare.`, async () => {
    const {data, error} = await db.rpc('user_rejoin_event', {
      p_user_id: currentUser.id, p_registration_id: regId, p_payment_method: method || 'credito'
    });
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Non è possibile ripartecipare');
    toast(data.message || 'Sei di nuovo iscritto: quota da saldare', 'ok');
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
  if (type === 'promo_bonus') return '<span title="Bonus promo">🌴</span>';
  if (type === 'purchase' || type === 'event_fee' || type === 'transfer_out') return '<span style="color:var(--neg);font-weight:700">↓</span>';
  if (type === 'transfer_in') return '<span style="color:var(--grn);font-weight:700">↑</span>';
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
// ── PRENOTAZIONI GADGET IN CASSA (staff/admin) ───────────────────────
let _cassaRes = [];
function _cassaFilterRes(rpcData, userId) {
  const all = (rpcData && (rpcData.reservations || (Array.isArray(rpcData) ? rpcData : []))) || [];
  const card = staffTarget && staffTarget.card_id;
  const list = all.filter(r => (card && r.card_id === card) || (userId && r.user_id === userId));
  _cassaRes = list;
  return list;
}
function _cassaResHtml(list, from) {
  return list.map(r => {
    const tot = _num(r.payment_amount, r.total_price);
    const sz  = (r.has_sizes && r.size) ? ` · <span class="dlv-size">taglia ${_esc(r.size)}</span>` : '';
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div class="dlv-row">
        <div class="dlv-main">
          <div style="font-weight:600">${_esc(r.gadget_name)}${sz} <span style="color:var(--mut)">· x${r.quantity}</span></div>
          <div style="font-size:12px;color:var(--mut);margin-top:2px">Prenotato ${r.created_at ? fdt(r.created_at).split(' ')[0] : '—'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:var(--gold)">${eur(tot)}</div>
          <div style="margin-top:3px">${payMethodPill(r.payment_method)}</div>
        </div>
      </div>
      <button class="btn btn-p w100" style="margin-top:10px" onclick="openDeliv('${_resId(r)}','${from}')">📦 Consegna</button>
    </div>`;
  }).join('');
}
async function loadStaffGadgetReservationsForUser(userId) {
  const wrap = document.getElementById('s-gadget-res-wrap');
  if (!wrap) return;
  const {data, error} = await db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id, p_status_filter: 'prenotato'});
  if (error) { wrap.style.display='none'; return; }
  const list = _cassaFilterRes(data, userId);
  if (!list.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  document.getElementById('s-gadget-res-list').innerHTML = _cassaResHtml(list, 'cassa-staff');
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
  const {data, error} = await db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id, p_status_filter: 'prenotato'});
  if (error) { wrap.style.display='none'; return; }
  const list = _cassaFilterRes(data, userId);
  if (!list.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  document.getElementById('ac-gadget-res-list').innerHTML = _cassaResHtml(list, 'cassa-admin');
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
function _tabBadge(tabId, count, label) {
  const el = document.getElementById(tabId);
  if (!el) return;
  el.innerHTML = _esc(label) + (Number(count) > 0 ? `<span class="tab-badge">${Number(count)}</span>` : '');
}
async function loadDash() {
  const {data} = await db.rpc('admin_dashboard');
  if (!data) return;
  loadChart(null);
  _tabBadge('a-sumup-tab',  data.pending_sumup_count,  '💳 Pagamenti da confermare');
  _tabBadge('a-refund-tab', data.pending_refund_count, '↩️ Rimborsi');
  _tabBadge('a-orders-tab', data.waitlist_count,       '📦 Consegne gadget');
  const soci = data.total_soci != null ? data.total_soci : data.total_users;
  const kpis = [
    {ic:'👥', v:soci, l:'Soci attivi'},
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
        <td style="font-size:12px;color:var(--mut);max-width:220px;white-space:normal;word-break:break-word">${_esc(t.description||'')}</td>
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
  const [{data: evData}, {data: catData}, {data: gadRes}] = await Promise.all([
    db.rpc('admin_list_events'),
    db.rpc('get_catalog'),
    db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id, p_status_filter: 'all'})
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
        <div class="fg"><label>Descrizione</label><textarea id="fe-desc" rows="5" placeholder="Descrizione&#10;A capo e **grassetto** supportati; link, email e numeri di telefono diventano cliccabili"></textarea></div>
        <div class="form-row">
          <div class="fg"><label>Data e ora</label><input id="fe-date" type="datetime-local"></div>
          <div class="fg"><label>Luogo</label><input id="fe-loc" type="text" placeholder="Luogo"></div>
        </div>
        <div class="form-row">
          <div class="fg"><label>Max posti (0=∞)</label><input id="fe-maxp" type="number" min="0" placeholder="0"></div>
          <div class="fg"><label>Prezzo €</label><input id="fe-price" type="number" min="0" step="0.50" placeholder="0.00"></div>
        </div>
        <div class="fg">
          <label>Gruppo promo</label>
          <select id="fe-promo"><option value="">Nessuno</option></select>
          <div class="promo-hint">Se selezionato, i soci ricevono un bonus a soglia sulle cene del gruppo (10% alla 2ª, 15% alla 4ª, 20% alla 6ª).</div>
        </div>
        <div class="fg">
          <label>Fasce di prezzo (opz.)</label>
          <div id="fe-tiers" class="tier-rows"></div>
          <button type="button" id="fe-tier-add" class="btn-sm tier-add-btn" onclick="tierAddRow('fe')">+ Aggiungi fascia</button>
          <div class="promo-hint">Se aggiunte, sostituiscono il prezzo unico nella card evento e nel dettaglio. Max ${TIER_MAX}.</div>
        </div>
        <div class="fg">
          <label>Menù (opz.)</label>
          <div id="fe-menu" class="menu-groups"></div>
          <div class="promo-hint">Le sezioni "comuni" valgono per tutte le fasce; quelle sotto una fascia si vedono solo a chi sceglie quella fascia. Salvate insieme all'evento.</div>
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
    _fillPromoSelect('fe-promo', '');
    loadTierDraft('fe', null);   // creazione: bozza fasce vuota
    loadMenuDraft('fe', null);   // creazione: bozza menù vuota
  }
  const evList  = document.getElementById('gs-ev-list');
  const gadList = document.getElementById('gs-gad-list');
  const proList = document.getElementById('gs-pro-list');
  const evs = evData||[];
  // etichette dei gruppi promo pronte prima di disegnare la lista
  if (evs.some(e => e.promo_group)) await loadPromoGroups();
  // fasce di tutti gli eventi admin (anche nascosti) in una sola query
  await _loadAdminTiers(evs.map(e => e.id));
  if (!evs.length) { evList.innerHTML='<div class="empty">Nessun evento</div>'; }
  else {
    evList.innerHTML = evs.map(e=>`
      <div class="card" style="margin-bottom:10px;opacity:${e.visible===false?0.55:1}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
          <span style="font-weight:700;flex:1;min-width:120px">${_esc(e.title)}</span>
          ${_promoBadgeHtml(e.promo_group)}
          <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${e.visible===false?'rgba(239,68,68,.15)':'rgba(34,197,94,.15)'};color:${e.visible===false?'var(--neg)':'var(--grn)'}">
            ${e.visible===false?'👁‍🗨 Nascosto':'👁 Visibile'}
          </span>
        </div>
        <div style="font-size:12px;color:var(--mut)">${e.event_date?fdt(e.event_date):'—'} · ${_esc(e.location||'—')}${_adminTiersOf(e.id).length?'':' · '+(e.price>0?eur(e.price):'Gratuito')} · ${e.max_participants||'∞'} posti</div>
        ${_adminTierLineHtml(_adminTiersOf(e.id))}
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
  _adminGadgets = gads;
  _adminEvents  = cat.events || evs || [];
  const resByGadget = _groupReservationsByGadget(gadRes);
  gadList.innerHTML = gads.length
    ? gads.map(g => {
        const gn = g.name.replace(/'/g,"\\'");
        const nRes = (resByGadget[g.id] || []).length;
        const szLine = g.has_sizes
          ? `<div style="font-size:11px;color:var(--mut);margin-top:4px">📏 ${(g.sizes||[]).map(s=>`${_esc(s.size)}: ${s.available != null ? s.available : s.stock}`).join(' · ') || 'nessuna taglia'}</div>`
          : '';
        return `<div class="card" style="margin-bottom:8px;padding:12px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:700;flex:1">${_esc(g.name)}</span>
            <span style="font-size:12px;color:var(--mut)">${g.has_sizes?'Taglie attive':'Stock: '+g.stock}</span>
            <span style="font-weight:700;color:var(--gold)">${eur(g.price)}</span>
          </div>
          ${g.description?`<div style="font-size:12px;color:var(--mut);margin-top:3px">${_esc(g.description)}</div>`:''}
          ${szLine}
          <div style="font-size:12px;margin-top:6px">${_gadgetCounters(g)}</div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
            ${nRes ? `<button class="btn-sm" onclick="toggleGadgetPren('${g.id}',this)">👥 Vedi prenotazioni (${nRes})</button>` : ''}
            <button class="btn-sm" onclick="openEditGadget('${g.id}')">✏️ Modifica</button>
            <button class="btn-sm" style="color:var(--neg)" onclick="adminDeleteGadget('${g.id}','${gn}')">🗑️ Elimina</button>
          </div>
          <div id="gpren-${g.id}" style="display:none;margin-top:8px"></div>
        </div>`;
      }).join('')
    : '<div class="empty">Nessun gadget</div>';
  Object.keys(resByGadget).forEach(gid => {
    const el = document.getElementById('gpren-' + gid);
    if (el) el.dataset.pren = JSON.stringify(resByGadget[gid]);
  });
  const prs = cat.promos||[];
  _promosAdminCache = {}; prs.forEach(p => _promosAdminCache[p.id] = p);
  renderPromoGroupsInfo();
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
// ── LINK SUMUP COLLEGATI A EVENTI ────────────────────────────────────
// sumup_links.event_id: NULL = ricarica generica, valorizzato = link di un evento.
let _sumupLinksCache = [], _sumupEventsCache = [];

// admin_add/update_sumup_link accettano p_event_id dal 03/08/2026: si passa sempre.
async function _rpcSumupLink(fn, args, eventId) {
  return db.rpc(fn, {...args, p_event_id: eventId || null});
}
function _sumupEventLabel(ev) {
  if (!ev) return 'Evento';
  const d = ev.event_date
    ? new Date(ev.event_date).toLocaleDateString('it-IT', {day:'numeric', month:'short', year:'numeric'})
    : null;
  return ev.title + (d ? ` — ${d}` : '');
}
async function _loadSumupEvents() {
  const {data} = await db.rpc('admin_list_events');
  _sumupEventsCache = (data || []).slice().sort((a, b) =>
    new Date(b.event_date || 0) - new Date(a.event_date || 0));   // più recenti in alto
  return _sumupEventsCache;
}
async function _fillSumupEventSelect(selectId, current) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const evs = _sumupEventsCache.length ? _sumupEventsCache : await _loadSumupEvents();
  sel.innerHTML = ['<option value="">— Nessuno (ricarica generica) —</option>']
    .concat(evs.map(e => `<option value="${e.id}">${_esc(_sumupEventLabel(e))}</option>`))
    .join('');
  sel.value = current || '';
}
// Link SumUp attivi di un evento, ordinati per sort_order.
// Finché get_catalog non espone event_id l'array resta vuoto e vale il fallback.
function _sumupLinksForEvent(eventId) {
  if (!eventId) return [];
  return (_sumupLinksCache || [])
    .filter(l => l.event_id === eventId && l.active !== false)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}
async function _loadSumupLinks(force) {
  if (_sumupLinksCache.length && !force) return _sumupLinksCache;
  if (force) _sumupOwner = null;      // l'admin può aver cambiato l'evento di un link
  const {data: cat} = await db.rpc('get_catalog');
  _sumupLinksCache = await _sumupWithEventIds(cat?.sumup_links || []);
  return _sumupLinksCache;
}
// get_catalog proietta solo (id,label,amount,url,sort_order): SENZA event_id i link
// di un evento sembrano generici e finiscono in "Ricarica tessera". Qui l'event_id
// viene ricostruito: prima dalla tabella (unica fonte completa), altrimenti
// chiedendo a list_event_sumup_links i link di ogni evento noto.
let _sumupOwner = null;   // { [link_id]: event_id|null } risolto una volta per sessione
async function _sumupWithEventIds(links) {
  const list = (links || []).map(l => ({...l}));
  if (!list.length) return list;
  if (!_sumupOwner || list.some(l => !(l.id in _sumupOwner))) _sumupOwner = await _resolveSumupOwners(list);
  return list.map(l => ({...l, event_id: l.event_id || _sumupOwner[l.id] || null}));
}
// → { [link_id]: event_id|null }. Ogni id della lista compare sempre nella mappa,
// anche con valore null: così la cache non viene ricalcolata a ogni catalogo.
async function _resolveSumupOwners(list) {
  const owner = {};
  list.forEach(l => { owner[l.id] = l.event_id || null; });
  try {
    const {data, error} = await db.from('sumup_links').select('id,event_id');
    if (!error && Array.isArray(data) && data.length) {
      data.forEach(r => { owner[r.id] = r.event_id || null; });
      return owner;
    }
  } catch (e) { console.warn('sumup_links select:', e.message || e); }
  // RLS chiusa sulla tabella: si risale ai link di evento chiedendoli evento per evento
  const ids = _sumupKnownEventIds();
  if (!ids.length) return owner;
  const res = await Promise.all(ids.map(id => db.rpc('list_event_sumup_links', {p_event_id: id})));
  res.forEach((r, i) => (Array.isArray(r.data) ? r.data : []).forEach(l => { owner[l.id] = ids[i]; }));
  return owner;
}
function _sumupKnownEventIds() {
  const ids = new Set();
  (_evList || []).forEach(e => e.id && ids.add(e.id));
  (_sumupEventsCache || []).forEach(e => e.id && ids.add(e.id));
  Object.keys(_eventsAdminCache || {}).forEach(id => ids.add(id));
  return [...ids];
}
// Sezione "Paga con SumUp" per la pagina evento (vetrina pubblica).
// Fallback retrocompatibile su events.sumup_link se l'evento non ha link dedicati.
function _sumupEventSectionHtml(eventId, legacyLink) {
  const links = _sumupLinksForEvent(eventId);
  let bottoni = '';
  if (links.length) {
    bottoni = links.map(l =>
      `<button class="btn btn-g sumup-ev-btn" onclick="window.open('${_esc(l.url)}','_blank','noopener')">💳 ${_esc(l.label)}${l.amount!=null?` — ${eur(l.amount)}`:''}</button>`
    ).join('');
  } else if (legacyLink) {
    bottoni = `<button class="btn btn-g sumup-ev-btn" onclick="window.open('${_esc(legacyLink)}','_blank','noopener')">💳 Paga con SumUp</button>`;
  } else {
    return '';
  }
  return `<div class="sumup-ev-sec">
    <div class="sec-lbl" style="margin-bottom:8px">💳 Paga con SumUp</div>
    <div class="sumup-ev-grid">${bottoni}</div>
  </div>`;
}

async function loadAdminSumupLinks() {
  const el = document.getElementById('gs-sumup-list');
  if (!el) return;
  el.innerHTML = '<div class="empty">⏳ Carico…</div>';
  const [links] = await Promise.all([_loadSumupLinks(true), _loadSumupEvents()]);
  _fillSumupEventSelect('sl-event', '');
  if (!links.length) { el.innerHTML='<div class="empty">Nessun link SumUp</div>'; return; }

  const generici = links.filter(l => !l.event_id);
  const perEvento = links.filter(l => l.event_id);
  let html = '';

  html += `<div class="sec-lbl" style="margin-bottom:8px">🔁 Link ricariche</div>`;
  html += generici.length ? generici.map(_sumupLinkCardHtml).join('')
                          : '<div class="empty">Nessun link di ricarica</div>';

  if (perEvento.length) {
    // raggruppati per evento, eventi più recenti in alto
    const perId = {};
    perEvento.forEach(l => { (perId[l.event_id] = perId[l.event_id] || []).push(l); });
    const ordinati = _sumupEventsCache.filter(e => perId[e.id]);
    Object.keys(perId).forEach(id => {           // link di eventi non più in elenco
      if (!ordinati.some(e => e.id === id)) ordinati.push({id, title: 'Evento non trovato', event_date: null});
    });
    html += `<div class="sec-lbl" style="margin:18px 0 8px">🎫 Link per eventi</div>`;
    html += ordinati.map(e => `
      <div class="sumup-ev-group">${_esc(_sumupEventLabel(e))}</div>
      ${perId[e.id].map(_sumupLinkCardHtml).join('')}`).join('');
  }
  el.innerHTML = html;
}
function _sumupLinkCardHtml(l) {
  return `
    <div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:600;flex:1">${_esc(l.label)}</span>
        ${l.amount!=null?`<span style="color:var(--gold);font-weight:700">${eur(l.amount)}</span>`:''}
      </div>
      <div style="font-size:11px;color:var(--mut);word-break:break-all;margin:4px 0">${_esc(l.url)}</div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <a href="${l.url}" target="_blank" rel="noopener" class="btn-sm" style="text-decoration:none">🔗 Apri</a>
        <button class="btn-sm" onclick="openEditSumupLink('${l.id}','${_esc(l.label.replace(/'/g,"\\'"))}','${_esc(l.url.replace(/'/g,"\\'"))}',${l.amount!=null?l.amount:'null'},'${l.event_id||''}')">✏️ Modifica</button>
        <button class="btn-sm" style="color:var(--neg)" onclick="adminDeleteSumupLink('${l.id}','${_esc(l.label)}')">🗑️ Elimina</button>
      </div>
    </div>`;
}
async function adminAddSumupLink() {
  const label  = document.getElementById('sl-label').value.trim();
  const url    = document.getElementById('sl-url').value.trim();
  const amount = parseFloat(document.getElementById('sl-amount').value) || null;
  const evId   = document.getElementById('sl-event')?.value || '';
  if (!label || !url) return toast('Etichetta e URL obbligatori');
  const res = await _rpcSumupLink('admin_add_sumup_link',
    {p_admin_id: currentUser.id, p_label: label, p_url: url, p_amount: amount}, evId);
  const {data, error} = res;
  if (error||!data.ok) return toast((error&&error.message)||data.error);
  toast('Link aggiunto!', 'ok');
  ['sl-label','sl-url','sl-amount'].forEach(id => document.getElementById(id).value='');
  const sel = document.getElementById('sl-event'); if (sel) sel.value = '';
  loadAdminSumupLinks();
}
function openEditSumupLink(id, label, url, amount, eventId) {
  document.getElementById('sle-id').value     = id;
  document.getElementById('sle-label').value  = label;
  document.getElementById('sle-url').value    = url;
  document.getElementById('sle-amount').value = (amount != null && amount !== 'null') ? amount : '';
  _fillSumupEventSelect('sle-event', eventId || '');
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
  const evId   = document.getElementById('sle-event')?.value || '';
  if (!label || !url) return toast('Etichetta e URL obbligatori');
  const res = await _rpcSumupLink('admin_update_sumup_link',
    {p_admin_id: currentUser.id, p_link_id: id, p_label: label, p_url: url, p_amount: amount}, evId);
  const {data, error} = res;
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
// ── FASCE DI PREZZO EVENTO (event_price_tiers) ───────────────────────
// events.price resta il prezzo unico di default. Se un evento ha almeno una fascia
// attiva, le fasce SOSTITUISCONO il prezzo nella vetrina socio (card home + dettaglio).
// Pagamenti, totali iscrizione e bonus promo restano su events.price (Fase 2).
const TIER_MAX = 8;
// Bozza righe in editing nei form admin, per prefisso DOM: 'fe' = crea, 'eve' = modifica.
// Riga: { id: uuid|null, label, price, sort_order, _dirty, _deleted }
let _tierDraft = { fe: [], eve: [] };
// Fasce attive per evento, riempita da _loadTiersForEvents(): { [event_id]: tiers[] }
let _tiersByEvent = {};
// Idem per la lista admin, che vede anche gli eventi nascosti.
let _adminTiersByEvent = {};

function _tierPriceLabel(price) {
  const n = Number(price || 0);
  return n > 0 ? eur(n) : 'Gratuito';
}
// _esc non protegge gli apici: serve per i value="" degli input della bozza.
function _escAttr(s) {
  return _esc(s == null ? '' : s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _tierSort(rows) {
  return (rows || []).slice().sort((a, b) =>
    (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
    String(a.label || '').localeCompare(String(b.label || '')));
}
// Fasce attive di un evento. Se la SELECT diretta è negata si ripiega sulla RPC.
async function _fetchEventTiers(eventId) {
  if (!eventId) return [];
  try {
    const { data, error } = await db.from('event_price_tiers')
      .select('*').eq('event_id', eventId).eq('active', true)
      .order('sort_order').order('label');
    if (!error) return data || [];
    console.warn('event_price_tiers select:', error);
    const r = await db.rpc('list_event_tiers', {p_event_id: eventId});
    if (r.error) { console.warn('list_event_tiers:', r.error); return []; }
    return Array.isArray(r.data) ? r.data : [];
  } catch (e) { console.warn('_fetchEventTiers:', e); return []; }
}
// Fasce di più eventi in UNA sola query → { [event_id]: tiers[] }. In caso di errore
// ritorna {} e i chiamanti tornano al prezzo unico (nessuna regressione).
async function _fetchTiersMap(eventIds) {
  const ids = (eventIds || []).filter(Boolean);
  if (!ids.length) return {};
  try {
    const { data, error } = await db.from('event_price_tiers')
      .select('event_id, label, price, sort_order')
      .in('event_id', ids).eq('active', true).order('sort_order');
    if (error) { console.warn('event_price_tiers batch:', error); return {}; }
    return (data || []).reduce((acc, t) =>
      ({...acc, [t.event_id]: (acc[t.event_id] || []).concat([t])}), {});
  } catch (e) { console.warn('_fetchTiersMap:', e); return {}; }
}
// Vetrina socio: solo eventi visibili in catalogo.
async function _loadTiersForEvents(eventIds) {
  _tiersByEvent = await _fetchTiersMap(eventIds);
  return _tiersByEvent;
}
// Lista admin: cache separata, perché include anche gli eventi nascosti e non deve
// essere sovrascritta dal ricarico del catalogo socio.
async function _loadAdminTiers(eventIds) {
  _adminTiersByEvent = await _fetchTiersMap(eventIds);
  return _adminTiersByEvent;
}
function _tiersOf(eventId) { return _tiersByEvent[eventId] || []; }
function _adminTiersOf(eventId) { return _adminTiersByEvent[eventId] || []; }
// Riga fasce compatta per la card admin: sostituisce il prezzo unico quando presenti.
function _adminTierLineHtml(tiers) {
  if (!tiers || !tiers.length) return '';
  const parts = tiers.map(t => `${_esc(t.label || '')} ${_tierPriceLabel(t.price)}`);
  return `<div style="font-size:12px;color:var(--mut);margin-top:2px">💶 ${parts.join(' · ')}</div>`;
}
// Prezzo mostrato nella card home: "da € X" con le fasce, prezzo unico senza.
function _eventPriceLabel(e) {
  const tiers = _tiersOf(e.id);
  if (!tiers.length) return (!e.price || e.price == 0) ? 'Gratuito' : eur(e.price);
  const min = Math.min(...tiers.map(t => Number(t.price || 0)));
  return min > 0 ? 'da ' + eur(min) : 'Fasce da Gratuito';
}
// Blocco fasce per il dettaglio evento. Stringa vuota se l'evento non ha fasce.
function _tierListHtml(tiers) {
  if (!tiers || !tiers.length) return '';
  return `<div class="tier-list">
    <div class="tier-list-lbl">💶 Fasce di prezzo</div>
    ${tiers.map(t => `<div class="tier-list-row">
      <span class="tier-list-name">${_esc(t.label || '')}</span>
      <span class="tier-list-price">${_tierPriceLabel(t.price)}</span>
    </div>`).join('')}
  </div>`;
}

// ── EDITOR FASCE NEI FORM ADMIN ──────────────────────────────────────
function _tierVisible(prefix) { return (_tierDraft[prefix] || []).filter(r => !r._deleted); }
function _tierSetDraft(prefix, rows) { _tierDraft = {..._tierDraft, [prefix]: rows}; }

function renderTierEditor(prefix) {
  const list = document.getElementById(prefix + '-tiers');
  if (!list) return;
  const rows = _tierDraft[prefix] || [];
  const visible = rows.map((r, i) => ({r, i})).filter(x => !x.r._deleted);
  list.innerHTML = visible.length
    ? visible.map(({r, i}) => `<div class="tier-row">
        <input type="text" class="tier-lbl" placeholder="Etichetta (es. Adulto)"
          value="${_escAttr(r.label)}" oninput="tierSetField('${prefix}',${i},'label',this.value)">
        <input type="number" class="tier-price" min="0" step="0.50" placeholder="€"
          value="${_escAttr(r.price)}" oninput="tierSetField('${prefix}',${i},'price',this.value)">
        <button type="button" class="btn-ico tier-del" title="Rimuovi fascia"
          onclick="tierRemoveRow('${prefix}',${i})">🗑️</button>
      </div>`).join('')
    : `<div class="tier-empty">Nessuna fascia: vale il prezzo unico qui sopra.</div>`;
  const btn = document.getElementById(prefix + '-tier-add');
  if (btn) {
    const full = visible.length >= TIER_MAX;
    btn.disabled = full;
    btn.style.opacity = full ? '.55' : '';
    btn.textContent = full ? `Massimo ${TIER_MAX} fasce` : '+ Aggiungi fascia';
  }
  renderMenuEditor(prefix);   // i gruppi del menù seguono le fasce
}
function tierAddRow(prefix) {
  const rows = _tierDraft[prefix] || [];
  if (_tierVisible(prefix).length >= TIER_MAX) return toast(`Massimo ${TIER_MAX} fasce per evento`);
  _tierSetDraft(prefix, rows.concat([
    {id: null, label: '', price: '', sort_order: rows.length, _dirty: false, _deleted: false}
  ]));
  renderTierEditor(prefix);
}
// Nessun re-render sull'input: gli elementi mantengono focus e posizione del cursore.
function tierSetField(prefix, idx, field, value) {
  const rows = _tierDraft[prefix] || [];
  if (!rows[idx]) return;
  _tierSetDraft(prefix, rows.map((r, i) => i === idx ? {...r, [field]: value, _dirty: true} : r));
}
// La riga viene solo nascosta, mai rimossa dall'array: così gli indici restano stabili.
// Al salvataggio: riga già salvata → DELETE, riga nuova → semplicemente ignorata.
function tierRemoveRow(prefix, idx) {
  const rows = _tierDraft[prefix] || [];
  if (!rows[idx]) return;
  _tierSetDraft(prefix, rows.map((r, i) => i === idx ? {...r, _deleted: true} : r));
  renderTierEditor(prefix);
}
// Progressivo per prefisso: se si riapre il form su un altro evento mentre la fetch
// precedente è ancora in volo, il risultato vecchio viene scartato.
let _tierLoadSeq = { fe: 0, eve: 0 };
// Precarica la bozza: eventId assente = modalità creazione (lista vuota).
async function loadTierDraft(prefix, eventId) {
  const seq = (_tierLoadSeq[prefix] || 0) + 1;
  _tierLoadSeq = {..._tierLoadSeq, [prefix]: seq};
  _tierSetDraft(prefix, []);
  renderTierEditor(prefix);
  if (!eventId) return;
  const tiers = await _fetchEventTiers(eventId);
  if (_tierLoadSeq[prefix] !== seq) return;   // form riaperto altrove: risultato obsoleto
  _tierSetDraft(prefix, _tierSort(tiers).map(t => ({
    id:         t.id,
    label:      t.label || '',
    price:      t.price != null ? String(t.price) : '',
    sort_order: Number(t.sort_order || 0),
    _dirty:     false,
    _deleted:   false
  })));
  renderTierEditor(prefix);
}
// Valida la bozza e la traduce in operazioni. { ok:false } = riga incompleta.
function collectTierDraft(prefix) {
  const ops = [];
  let order = 0;
  for (const r of (_tierDraft[prefix] || [])) {
    if (r._deleted) { if (r.id) ops.push({op: 'delete', id: r.id}); continue; }
    const label = String(r.label || '').trim();
    const raw   = String(r.price == null ? '' : r.price).trim().replace(',', '.');
    const price = raw === '' ? NaN : Number(raw);
    if (!label || !isFinite(price) || price < 0) return {ok: false};
    const sort_order = order++;
    if (!r.id)         ops.push({op: 'add', label, price, sort_order});
    else if (r._dirty) ops.push({op: 'update', id: r.id, label, price, sort_order});
  }
  return {ok: true, ops};
}
// Applica le operazioni DOPO il salvataggio dell'evento: un errore su una fascia
// viene segnalato ma non annulla il salvataggio dell'evento.
async function applyTierOps(eventId, ops) {
  if (!eventId || !ops || !ops.length) return {changed: 0, errors: []};
  const errors = [];
  let changed = 0;
  for (const op of ops) {
    try {
      let res;
      if (op.op === 'delete') {
        res = await db.rpc('admin_delete_event_tier',
          {p_admin_id: currentUser.id, p_tier_id: op.id});
      } else if (op.op === 'add') {
        res = await db.rpc('admin_add_event_tier',
          {p_admin_id: currentUser.id, p_event_id: eventId,
           p_label: op.label, p_price: op.price, p_sort_order: op.sort_order});
      } else {
        res = await db.rpc('admin_update_event_tier',
          {p_admin_id: currentUser.id, p_tier_id: op.id,
           p_label: op.label, p_price: op.price, p_sort_order: op.sort_order});
      }
      if (res.error) errors.push(res.error.message);
      else if (res.data && res.data.ok === false) errors.push(res.data.error || 'errore fascia');
      else changed++;
    } catch (e) { errors.push(e.message || String(e)); }
  }
  return {changed, errors};
}
function _tierOpsToast(res) {
  if (!res) return;
  if (res.errors.length) toast(`Fasce: ${res.errors.length} non salvate — ${res.errors[0]}`);
  else if (res.changed)  toast(`Fasce di prezzo aggiornate (${res.changed})`, 'ok');
}
const TIER_INVALID_MSG = 'Compila etichetta e prezzo di ogni fascia, oppure rimuovi la riga';

// ── EDITOR MENÙ NEI FORM ADMIN ───────────────────────────────────────
// Stessa impostazione delle fasce: bozza locale applicata al salvataggio
// dell'evento. In creazione né l'evento né le fasce hanno ancora un id, quindi
// le scritture non possono partire prima del salvataggio.
// Riga: {uid, id|null, group, label, detail, _dirty, _deleted}
// group: 'common' | 't:<tier_id>' (fascia già salvata) | 'd:<indice bozza fascia>'
// I suggerimenti di sezione stanno nel <datalist id="menu-sec-suggest"> di index.html:
// l'input resta libero, l'admin può scrivere qualsiasi titolo.
let _menuDraft = { fe: [], eve: [] };
let _menuUid = 0;
let _menuLoadSeq = { fe: 0, eve: 0 };

// Le RPC del menù sono recenti: se PostgREST non trova la firma con i parametri
// p_*, si riprova con i nomi senza prefisso invece di fallire in silenzio.
function _isMissingFn(err) {
  const s = `${(err && err.code) || ''} ${(err && err.message) || ''} ${(err && err.hint) || ''}`;
  return /PGRST202|Could not find the function|schema cache/i.test(s);
}
async function _menuRpc(fn, args) {
  const pref = {};
  Object.keys(args).forEach(k => { pref['p_' + k] = args[k]; });
  const res = await db.rpc(fn, pref);
  if (res.error && _isMissingFn(res.error)) {
    const alt = await db.rpc(fn, args);
    if (!alt.error || !_isMissingFn(alt.error)) return alt;
  }
  return res;
}
function _menuSort(items) {
  return (items || []).slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}
async function _fetchEventMenu(eventId) {
  const vuoto = {common: [], by_tier: []};
  if (!eventId) return vuoto;
  const {data, error} = await _menuRpc('list_event_menu', {event_id: eventId});
  if (error) { console.warn('list_event_menu:', error.message); return vuoto; }
  const m = data || {};
  return {
    common:  _menuSort(Array.isArray(m.common) ? m.common : []),
    by_tier: (Array.isArray(m.by_tier) ? m.by_tier : [])
      .slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map(t => ({...t, items: _menuSort(t.items)}))
  };
}
function _menuHasItems(menu) {
  if (!menu) return false;
  return (menu.common || []).length > 0 || (menu.by_tier || []).some(t => (t.items || []).length > 0);
}
// Gruppi mostrati nell'editor: comune + una fascia per ogni riga viva della bozza fasce.
function _menuGroups(prefix) {
  const groups = [{key: 'common', label: 'Comune a tutte le fasce'}];
  (_tierDraft[prefix] || []).forEach((t, i) => {
    if (t._deleted) return;
    groups.push({
      key:   t.id ? 't:' + t.id : 'd:' + i,
      label: String(t.label || '').trim() || `Fascia ${i + 1}`
    });
  });
  return groups;
}
function _menuRows(prefix, key) {
  return (_menuDraft[prefix] || []).filter(r => !r._deleted && r.group === key);
}
function _menuSetDraft(prefix, rows) { _menuDraft = {..._menuDraft, [prefix]: rows}; }
function renderMenuEditor(prefix) {
  const host = document.getElementById(prefix + '-menu');
  if (!host) return;
  const groups = _menuGroups(prefix);
  host.innerHTML = groups.map((g, gi) => {
    const rows = _menuRows(prefix, g.key);
    return `<div class="menu-grp">
      <div class="menu-grp-t">${_esc(g.label)}</div>
      ${rows.length
        ? rows.map((r, i) => _menuRowHtml(prefix, r, i, rows.length, groups)).join('')
        : '<div class="tier-empty">Nessuna sezione.</div>'}
      <div class="menu-add">
        <input type="text" id="${prefix}-menu-new-${gi}" list="menu-sec-suggest" placeholder="Titolo sezione (es. Antipasto)">
        <button type="button" class="btn-sm" onclick="menuAddRow('${prefix}','${g.key}','${prefix}-menu-new-${gi}')">+ Aggiungi</button>
      </div>
    </div>`;
  }).join('');
}
function _menuRowHtml(prefix, r, i, n, groups) {
  const opts = groups.map(g =>
    `<option value="${g.key}"${g.key === r.group ? ' selected' : ''}>${_esc(g.label)}</option>`).join('');
  return `<div class="menu-row">
    <div class="menu-row-top">
      <input type="text" class="menu-lbl" list="menu-sec-suggest" placeholder="Titolo sezione"
        value="${_escAttr(r.label)}" oninput="menuSetField('${prefix}','${r.uid}','label',this.value)">
      <button type="button" class="btn-ico menu-act" title="Sposta su" ${i === 0 ? 'disabled' : ''}
        onclick="menuMove('${prefix}','${r.uid}',-1)">↑</button>
      <button type="button" class="btn-ico menu-act" title="Sposta giù" ${i === n - 1 ? 'disabled' : ''}
        onclick="menuMove('${prefix}','${r.uid}',1)">↓</button>
      <button type="button" class="btn-ico menu-act" title="Elimina sezione"
        onclick="menuRemoveRow('${prefix}','${r.uid}')">🗑️</button>
    </div>
    <textarea class="menu-det" rows="2" placeholder="Dettaglio (es. Bruschette al pomodoro, taglieri…)"
      oninput="menuSetField('${prefix}','${r.uid}','detail',this.value)">${_esc(r.detail || '')}</textarea>
    <div class="menu-move-row">
      <span class="menu-move-lbl">Sposta in</span>
      <select onchange="menuSetGroup('${prefix}','${r.uid}',this.value)">${opts}</select>
    </div>
  </div>`;
}
function menuAddRow(prefix, group, inputId) {
  const el = document.getElementById(inputId);
  const label = el ? el.value.trim() : '';
  if (!label) return toast('Scrivi il titolo della sezione (es. Antipasto)');
  _menuSetDraft(prefix, (_menuDraft[prefix] || []).concat([{
    uid: 'm' + (++_menuUid), id: null, group, label, detail: '', _dirty: true, _deleted: false
  }]));
  if (el) el.value = '';
  renderMenuEditor(prefix);
}
// Nessun re-render sull'input: il campo mantiene focus e cursore.
function menuSetField(prefix, uid, field, value) {
  _menuSetDraft(prefix, (_menuDraft[prefix] || [])
    .map(r => r.uid === uid ? {...r, [field]: value, _dirty: true} : r));
}
function menuRemoveRow(prefix, uid) {
  _menuSetDraft(prefix, (_menuDraft[prefix] || [])
    .map(r => r.uid === uid ? {...r, _deleted: true, _dirty: true} : r));
  renderMenuEditor(prefix);
}
function menuSetGroup(prefix, uid, group) {
  _menuSetDraft(prefix, (_menuDraft[prefix] || [])
    .map(r => r.uid === uid ? {...r, group, _dirty: true} : r));
  renderMenuEditor(prefix);
}
// Sposta la riga rispetto alle altre dello stesso gruppo (l'ordine è quello dell'array).
function menuMove(prefix, uid, delta) {
  const rows = (_menuDraft[prefix] || []).slice();
  const r = rows.find(x => x.uid === uid);
  if (!r) return;
  const gruppo = rows.filter(x => !x._deleted && x.group === r.group);
  const target = gruppo[gruppo.indexOf(r) + delta];
  if (!target) return;
  const i = rows.indexOf(r), j = rows.indexOf(target);
  rows[i] = target; rows[j] = r;
  _menuSetDraft(prefix, rows);
  renderMenuEditor(prefix);
}
async function loadMenuDraft(prefix, eventId) {
  const seq = (_menuLoadSeq[prefix] || 0) + 1;
  _menuLoadSeq = {..._menuLoadSeq, [prefix]: seq};
  _menuSetDraft(prefix, []);
  renderMenuEditor(prefix);
  if (!eventId) return;
  const menu = await _fetchEventMenu(eventId);
  if (_menuLoadSeq[prefix] !== seq) return;   // form riaperto altrove
  const rows = [];
  const push = (it, group) => rows.push({
    uid: 'm' + (++_menuUid), id: it.id, group,
    label: it.section_label || '', detail: it.item_detail || '',
    _dirty: false, _deleted: false
  });
  menu.common.forEach(it => push(it, 'common'));
  menu.by_tier.forEach(t => (t.items || []).forEach(it => push(it, 't:' + t.tier_id)));
  _menuSetDraft(prefix, rows);
  renderMenuEditor(prefix);
}
// Applica la bozza DOPO il salvataggio dell'evento e delle fasce: solo qui i
// tier_id esistono davvero. Le fasce nuove si risolvono per etichetta.
async function applyMenuOps(prefix, eventId) {
  const rows = _menuDraft[prefix] || [];
  if (!eventId || !rows.length) return {changed: 0, errors: []};
  const errors = [];
  let changed = 0;
  const tiers = await _fetchEventTiers(eventId);
  const ids = new Set(tiers.map(t => String(t.id)));
  const perLabel = {};
  tiers.forEach(t => { perLabel[String(t.label || '').trim().toLowerCase()] = t.id; });
  const resolve = (group) => {
    if (!group || group === 'common') return {ok: true, tier_id: null};
    if (group.indexOf('t:') === 0) {
      const id = group.slice(2);
      return ids.has(String(id)) ? {ok: true, tier_id: id} : {ok: false};
    }
    const t = (_tierDraft[prefix] || [])[Number(group.slice(2))];
    const id = t ? perLabel[String(t.label || '').trim().toLowerCase()] : null;
    return id ? {ok: true, tier_id: id} : {ok: false};
  };
  const del = async (id) => {
    const res = await _menuRpc('admin_delete_event_menu_item', {admin_id: currentUser.id, item_id: id});
    if (res.error) errors.push(res.error.message);
    else if (res.data && res.data.ok === false) errors.push(res.data.error || 'errore menù');
    else changed++;
  };
  const ordine = {};      // tier_id ('' = comune) → ids nell'ordine finale
  for (const r of rows) {
    const g = resolve(r.group);
    // riga cancellata, o fascia sparita dalla bozza: la sezione non esiste più
    if (r._deleted || !g.ok) { if (r.id) await del(r.id); continue; }
    const label  = String(r.label || '').trim();
    const detail = String(r.detail || '').trim();
    if (!label) { errors.push('Titolo sezione obbligatorio'); continue; }
    const key = g.tier_id || '';
    ordine[key] = ordine[key] || [];
    const sort_order = (ordine[key].length + 1) * 10;
    if (!r.id) {
      const res = await _menuRpc('admin_add_event_menu_item', {
        admin_id: currentUser.id, event_id: eventId, tier_id: g.tier_id,
        section_label: label, item_detail: detail || null, sort_order
      });
      if (res.error) { errors.push(res.error.message); continue; }
      if (res.data && res.data.ok === false) { errors.push(res.data.error || 'errore menù'); continue; }
      r.id = (res.data && res.data.id) || null;
      r._dirty = false;
      changed++;
    } else if (r._dirty) {
      const res = await _menuRpc('admin_update_event_menu_item', {
        admin_id: currentUser.id, item_id: r.id,
        section_label: label, item_detail: detail || null, sort_order, active: null,
        tier_id: g.tier_id, clear_tier: !g.tier_id
      });
      if (res.error) { errors.push(res.error.message); continue; }
      if (res.data && res.data.ok === false) { errors.push(res.data.error || 'errore menù'); continue; }
      r._dirty = false;
      changed++;
    }
    if (r.id) ordine[key].push(r.id);
  }
  // ordine definitivo di ogni gruppo
  for (const key of Object.keys(ordine)) {
    if (ordine[key].length < 2) continue;
    const res = await _menuRpc('admin_reorder_event_menu', {admin_id: currentUser.id, ordered_ids: ordine[key]});
    if (res.error) errors.push(res.error.message);
    else if (res.data && res.data.ok === false) errors.push(res.data.error || 'errore ordinamento menù');
  }
  return {changed, errors};
}
function _menuOpsToast(res) {
  if (!res) return;
  if (res.errors.length) toast(`Menù: ${res.errors.length} modifiche non salvate — ${res.errors[0]}`);
  else if (res.changed)  toast(`Menù aggiornato (${res.changed})`, 'ok');
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
    // Fasce validate PRIMA di creare l'evento: se una riga è incompleta non si procede.
    const tiers = collectTierDraft('fe');
    if (!tiers.ok) { toast(TIER_INVALID_MSG); return; }
    if (pub && !slug) slug = _slugify(title);

    const imgUrl = (document.getElementById('fe-img')?.value || '').trim();
    const promoGroup = (document.getElementById('fe-promo')?.value || '').trim();

    const { data, error } = await db.rpc('admin_create_event', {
      p_admin_id:            currentUser.id,
      p_title:               title,
      p_description:         desc || null,
      p_event_date:          _localInputToIso(date),
      p_location:            loc || null,
      p_max_participants:    maxp,
      p_price:               price,
      p_sumup_link:          sumup || null,
      p_slug:                slug || null,
      p_public_registration: pub,
      // sempre presente: risolve l'overload di admin_create_event lato PostgREST
      p_promo_group:         promoGroup || null
    });

    console.log('adminCreateEvent RPC:', { data, error });

    if (error) throw new Error('Errore RPC: ' + error.message);
    if (!data || data.ok === false) throw new Error('RPC ko: ' + (data?.error || JSON.stringify(data)));

    if (imgUrl && data.event_id) {
      await db.rpc('admin_update_event', {
        p_admin_id: currentUser.id,
        p_event_id: data.event_id,
        p_image_url: imgUrl,
        // sempre presenti: risolvono l'overload; false+null = lascia il gruppo invariato
        p_promo_group: null,
        p_clear_promo_group: false
      });
    }

    // Fasce di prezzo: dopo la creazione, sull'event_id restituito dalla RPC
    if (data.event_id) {
      _tierOpsToast(await applyTierOps(data.event_id, tiers.ops));
      // il menù dopo le fasce: i tier_id esistono solo ora
      _menuOpsToast(await applyMenuOps('fe', data.event_id));
    }

    // Reset form
    ['fe-title','fe-desc','fe-date','fe-loc','fe-maxp','fe-price','fe-sumup','fe-slug','fe-img']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const promoSel = document.getElementById('fe-promo');
    if (promoSel) promoSel.value = '';
    loadTierDraft('fe', null);
    loadMenuDraft('fe', null);
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
// Contatori reali dal catalogo: prenotati / consegnati / in attesa d'ordine
function _gadgetCounters(g) {
  const res  = _num(g.reserved_total);
  const del  = _num(g.delivered_total);
  const wait = _num(g.waitlist_total);
  return `<span style="color:var(--gold)">📌 ${res} prenotat${res === 1 ? 'o' : 'i'}</span>` +
         ` · <span style="color:var(--grn)">✅ ${del} consegnat${del === 1 ? 'o' : 'i'}</span>` +
         (wait > 0 ? ` · <span style="color:var(--mut)">⏳ ${wait} in attesa</span>` : '');
}
function _groupReservationsByGadget(rpcData) {
  const list = (rpcData && (rpcData.reservations || (Array.isArray(rpcData) ? rpcData : []))) || [];
  const map = {};
  list.forEach(r => {
    const k = r.gadget_id;
    if (!k) return;
    map[k] = (map[k] || []).concat([r]);
  });
  return map;
}
function _prenTableHtml(list) {
  if (!list.length) return '<div class="empty" style="font-size:12px">Nessuna prenotazione</div>';
  return `<div class="tbl-wrap"><table style="font-size:12px"><thead><tr>
      <th>Tessera</th><th>Nome</th><th>Taglia</th><th>Qtà</th><th>Metodo</th><th>Stato</th>
    </tr></thead><tbody>`
    + list.map(r => `<tr>
        <td class="mono">${_esc(r.card_id || '')}</td>
        <td>${_esc(r.user_name || r.display_name || '—')}</td>
        <td>${r.size ? _esc(r.size) : '—'}</td>
        <td style="text-align:center">${r.quantity}</td>
        <td>${payMethodPill(r.payment_method)}</td>
        <td>${resBadge(r.status || 'prenotato')}</td>
      </tr>`).join('')
    + '</tbody></table></div>';
}
function toggleGadgetPren(gadgetId, btn) {
  const el = document.getElementById('gpren-' + gadgetId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.innerHTML = _prenTableHtml(JSON.parse(el.dataset.pren || '[]'));
  el.style.display = 'block';
}
function toggleGadgetSizes() {
  const on = document.getElementById('gae-has-sizes').checked;
  document.getElementById('gae-sizes-wrap').style.display = on ? '' : 'none';
  document.getElementById('gae-stock-fg').style.opacity   = on ? '.5' : '';
}
function _renderSizeRows(sizes) {
  const map = {};
  (sizes || []).forEach(s => { map[s.size] = s.stock; });
  document.getElementById('gae-sizes-body').innerHTML = PRESET_SIZES.map(sz => `
    <label class="size-cell">
      <span class="size-cell-lbl">${sz}</span>
      <input type="number" min="0" step="1" class="gae-size-in" data-size="${sz}"
             value="${map[sz] != null ? map[sz] : ''}" placeholder="—" inputmode="numeric">
    </label>`).join('');
}
function openEditGadget(id, name, price, desc, stock) {
  const g = (typeof _gadgetsAdminCache !== 'undefined' && _gadgetsAdminCache[id]) || {};
  document.getElementById('gae-id').value    = id;
  document.getElementById('gae-name').value  = name  != null ? name  : (g.name || '');
  document.getElementById('gae-price').value = price != null ? price : (g.price != null ? g.price : '');
  document.getElementById('gae-desc').value  = desc  != null ? desc  : (g.description || '');
  document.getElementById('gae-stock').value = stock != null ? stock : (g.stock != null ? g.stock : 0);
  const curImg = g.image_url || '';
  document.getElementById('gae-img').value = curImg;
  setImageUploaderPreview('gae-img-mount', curImg);
  document.getElementById('gae-has-sizes').checked = !!g.has_sizes;
  _renderSizeRows(g.sizes);
  toggleGadgetSizes();
  document.getElementById('gad-edit-bg').style.display = 'flex';
}
function closeEditGadget() { document.getElementById('gad-edit-bg').style.display = 'none'; }
async function saveEditGadget() {
  const id    = document.getElementById('gae-id').value;
  const name  = document.getElementById('gae-name').value.trim();
  const price = parseFloat(document.getElementById('gae-price').value);
  const desc  = document.getElementById('gae-desc').value.trim();
  const stock = parseInt(document.getElementById('gae-stock').value)||0;
  const hasSizes = document.getElementById('gae-has-sizes').checked;
  const img   = document.getElementById('gae-img').value.trim();
  if (!name || !price) return toast('Nome e prezzo obbligatori');
  const sizes = hasSizes
    ? Array.from(document.querySelectorAll('.gae-size-in')).map(i => ({size: i.dataset.size, stock: parseInt(i.value) || 0}))
    : [];
  const {data, error} = await db.rpc('admin_update_gadget', {p_admin_id: currentUser.id, p_gadget_id: id, p_name: name, p_price: price, p_description: desc||null, p_stock: stock});
  if (error||!data||!data.ok) return toast((error&&error.message)||(data&&data.error)||'Errore');
  const cachedImg = ((typeof _gadgetsAdminCache !== 'undefined' && _gadgetsAdminCache[id]) || {}).image_url || '';
  if (img !== cachedImg) {
    const {data: imgRes, error: imgErr} = await db.rpc('admin_set_gadget_image', {p_admin_id: currentUser.id, p_gadget_id: id, p_image_url: img || null});
    if (imgErr || !imgRes || !imgRes.ok) { toast('Salvato ma immagine non aggiornata'); }
  }
  const {data: sd, error: se} = await db.rpc('admin_set_gadget_sizes', {p_admin_id: currentUser.id, p_gadget_id: id, p_sizes: sizes});
  if (se || (sd && sd.ok === false)) return toast((se&&se.message)||(sd&&sd.error)||'Errore salvataggio taglie');
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
  const [{data: cat}, {data: res}] = await Promise.all([
    db.rpc('get_catalog'),
    db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id, p_status_filter: 'all'})
  ]);
  const gads = (cat && cat.gadgets) || [];
  if (!gads.length) { el.innerHTML='<div class="empty">Nessun gadget</div>'; return; }
  const resByGadget = _groupReservationsByGadget(res);
  el.innerHTML = gads.map(g => {
    const nRes = (resByGadget[g.id] || []).length;
    const szLine = g.has_sizes
      ? `<div style="font-size:11px;color:var(--mut);margin-top:4px">📏 ${(g.sizes||[]).map(s=>`${_esc(s.size)}: ${s.available != null ? s.available : s.stock}`).join(' · ') || 'nessuna taglia'}</div>`
      : '';
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:700;flex:1">${_esc(g.name)}</span>
        <span style="font-size:12px;color:var(--mut)">${g.has_sizes?'Taglie attive':'Stock: '+g.stock}</span>
        <span style="font-weight:700;color:var(--gold)">${eur(g.price)}</span>
      </div>
      ${g.description?`<div style="font-size:12px;color:var(--mut);margin-top:3px">${_esc(g.description)}</div>`:''}
      ${szLine}
      <div style="font-size:12px;margin-top:6px">${_gadgetCounters(g)}</div>
      ${nRes ? `<div style="margin-top:8px"><button class="btn-sm" onclick="toggleStaffGadgetPren('${g.id}',this)">👥 Vedi prenotazioni (${nRes})</button></div>` : ''}
      <div id="sgpren-${g.id}" style="display:none;margin-top:8px"></div>
    </div>`;
  }).join('');
  Object.keys(resByGadget).forEach(gid => {
    const box = document.getElementById('sgpren-' + gid);
    if (box) box.dataset.pren = JSON.stringify(resByGadget[gid]);
  });
}
function toggleStaffGadgetPren(gadgetId, btn) {
  const el = document.getElementById('sgpren-' + gadgetId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.innerHTML = _prenTableHtml(JSON.parse(el.dataset.pren || '[]'));
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
  await _loadSumupLinks();          // per i link SumUp collegati a questo evento
  const tiers = await _fetchEventTiers(_publicEvent.id);
  document.getElementById('ev-title').textContent = _publicEvent.title;
  const dateStr = _publicEvent.event_date ? new Date(_publicEvent.event_date).toLocaleString('it-IT',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}) : '—';
  const spotsHtml = _publicEvent.spots_left !== null
    ? `<div style="margin-top:8px"><span class="badge ${_publicEvent.spots_left>0?'bg':'br'}">${_publicEvent.spots_left>0?_publicEvent.spots_left+' posti disponibili':'Sold out'}</span></div>`
    : '';
  document.getElementById('ev-info').innerHTML = `
    ${_publicEvent.image_url ? `<div style="margin-bottom:12px">${_imgWrap16x9(_publicEvent.image_url, _publicEvent.title, '12px')}</div>` : ''}
    <div style="font-size:15px;font-weight:700;margin-bottom:6px">${_publicEvent.title}</div>
    ${_publicEvent.description?`<div class="evd-desc" style="font-size:13px;color:var(--mut);margin-bottom:8px">${_richText(_publicEvent.description)}</div>`:''}
    <div style="font-size:13px;margin-bottom:3px">📅 ${dateStr}</div>
    ${_publicEvent.location?`<div style="font-size:13px;margin-bottom:3px">📍 ${_publicEvent.location}</div>`:''}
    ${_tierListHtml(tiers)}
    ${!tiers.length && !(_publicEvent.price > 0)
      ? `<div style="font-size:15px;font-weight:700;color:var(--gold);margin-top:10px">Evento gratuito</div>`
      : ''}
    ${spotsHtml}
    ${_sumupEventSectionHtml(_publicEvent.id, _publicEvent.sumup_link)}
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
    // il link SumUp è già nella sezione "💳 Paga con SumUp" sopra: qui solo il totale
    el.innerHTML = `Totale per ${n} ${n===1?'persona':'persone'}: <strong style="color:var(--gold)">${eur(_publicEvent.price * n)}</strong>`;
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
  prefillCardInput();
}
// Il campo tessera parte da "SH-" con il cursore subito dopo il trattino: il socio
// digita solo le cifre. Se lo svuota resta vuoto, non lo riscriviamo.
function prefillCardInput(focus) {
  const el = document.getElementById('l-card');
  if (!el) return;
  if (!el.value.trim()) el.value = 'SH-';
  if (focus === false) return;
  setTimeout(() => {
    try { el.focus(); const n = el.value.length; el.setSelectionRange(n, n); } catch (e) {}
  }, 60);
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
  // L'annullamento iscrizione passa da admin_cancel_registration, che accetta solo
  // admin: lo staff non vede il pulsante (la RPC risponderebbe "Accesso negato").
  const isAdmin = context === 'admin';
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
    html += `<div class="tbl-wrap"><table><thead><tr><th>Tessera</th><th>Nome</th><th>€</th><th>Stato</th><th>Gruppo</th><th>Check-in</th>${isAdmin?'<th></th>':''}</tr></thead><tbody>`
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
              ${isAdmin?'<td></td>':''}
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
            ${isAdmin ? `<td style="white-space:nowrap">
              <button class="btn-sm" style="font-size:10px;padding:2px 6px;color:var(--neg)" title="Annulla iscrizione"
                onclick="adminCancelRegistration('${r.registration_id}','${dn}','${_esc(String(r.card_id||'')).replace(/'/g,"\\'")}',${companions.length},'${eventId}')">🗑️</button>
            </td>` : ''}
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
// Somma rimborsata restituita da admin_cancel_registration. La forma di `refunds`
// non è garantita (numero, array di righe o oggetto con totale): si prova a leggerla
// in modo difensivo e, se non si capisce, si tace invece di mostrare un importo falso.
function _refundTotal(refunds) {
  if (refunds == null) return 0;
  if (typeof refunds === 'number') return refunds;
  if (Array.isArray(refunds)) {
    return refunds.reduce((s, x) => s + Number(
      (x && (x.amount ?? x.importo ?? x.refunded ?? x.total)) || 0), 0);
  }
  if (typeof refunds === 'object') return Number(refunds.total ?? refunds.amount ?? 0) || 0;
  return 0;
}
// Annulla l'iscrizione di un socio: rimborsi (credito/contanti/SumUp), annullamento
// degli accompagnatori attivi e ritiro del bonus promo sono gestiti lato RPC.
async function adminCancelRegistration(regId, displayName, cardId, companionCount, eventId) {
  const comps = Number(companionCount || 0);
  const extra = comps > 0 ? `\nAccompagnatori attivi coinvolti: ${comps}.` : '';
  modalConfirm(
    `Annullare l'iscrizione?\n\n` +
    `Verrà annullata l'iscrizione di ${displayName} (${cardId}) all'evento.${extra}\n` +
    `Se il pagamento era stato saldato, il credito verrà rimborsato al socio.\n` +
    `Eventuali accompagnatori attivi vengono anch'essi annullati e rimborsati.\n` +
    `Il bonus promo, se applicato, viene ritirato.\n` +
    `L'azione non è reversibile.`,
    async () => {
      const {data, error} = await db.rpc('admin_cancel_registration', {
        p_admin_id: currentUser.id,
        p_registration_id: regId
      });
      if (error || !data || data.ok === false) {
        return toast((error && error.message) || (data && data.error) || 'Errore');
      }
      const tot = _refundTotal(data.refunds);
      toast('Iscrizione annullata' + (tot > 0 ? ` · rimborsati ${eur(tot)}` : ''), 'ok');
      await _reloadAdminEventGuests(eventId);
    }
  );
  document.getElementById('modal-ok').textContent = 'Sì, annulla iscrizione';
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
• In Catalogo → Eventi trovi due elenchi: <strong>Le mie iscrizioni</strong> e <strong>Prossimi eventi</strong><br>
• Tocca una riga per aprire l'evento: locandina, data, luogo, descrizione e fasce di prezzo<br>
• "Iscriviti" apre la composizione del gruppo: scegli la <strong>fascia</strong> per te e aggiungi le persone che vengono con te (nome, cognome e fascia di ognuna)<br>
• Le fasce sono i prezzi per età decisi dal Rione (es. Adulto, Ragazz*, 0-3 gratuito): chi rientra in una fascia gratuita non paga nulla<br>
• Il totale si aggiorna mentre scegli le fasce</p>
<p><strong>🍽️ MENÙ</strong><br>
• Se l'evento ha un menù lo trovi nel dettaglio, sopra le fasce di prezzo<br>
• Le portate "comuni" valgono per tutti; ogni fascia può avere le sue<br>
• Durante l'iscrizione, sotto la fascia di ogni persona vedi il menù che le tocca</p>
<p><strong>🎟️ PAGARE LE QUOTE (una persona alla volta)</strong><br>
• Dentro l'evento vedi la quota di ogni persona con il suo stato: 🟡 Da saldare · 🟠 In attesa conferma staff · 🟢 Saldato / Gratuito<br>
• Spunta chi vuoi pagare tu (o "Pago io per tutti") e scegli il metodo:<br>
&nbsp;&nbsp;- 💳 Credito: addebito immediato sul saldo della card<br>
&nbsp;&nbsp;- 💵 Cassa: paghi di persona, il cassiere conferma<br>
&nbsp;&nbsp;- 📱 SumUp: apri il link dell'importo giusto, poi segnala allo staff<br>
• Chi non selezioni resta "Da saldare" e potrà pagare per conto suo più avanti<br>
• "➕ Aggiungi persone" per allargare il gruppo in qualsiasi momento<br>
• 🗑 accanto a una persona non ancora saldata: la togli dall'iscrizione<br>
• "🗑 Annulla tutta l'iscrizione" rimuove tutti e avvia i rimborsi<br>
• Dopo la data dell'evento le modifiche non sono più possibili</p>
<p><strong>🛍️ GADGET</strong><br>
• Se il gadget ha le taglie, scegli prima la taglia poi la quantità [−][N][+]<br>
• Dichiara come intendi pagare: 💳 Credito · 💵 Contanti · 🔗 SumUp<br>
• <strong>Non paghi nulla al momento della prenotazione</strong>: paghi allo staff quando ritiri il gadget<br>
• Taglia esaurita? Puoi comunque prenotare: finisci in lista d'attesa e verrai avvisato quando arriva l'ordine<br>
• In "Le mie prenotazioni gadget" puoi ✏️ modificare taglia, quantità e metodo di pagamento, oppure 🗑 annullare<br>
• Alla consegna vedrai la riga con ✅ Consegnato e la taglia effettivamente ritirata</p>
<p><strong>💳 RICARICA TESSERA (SumUp)</strong><br>
• In fondo al Catalogo trovi i link SumUp per <strong>ricaricare il saldo</strong> della tessera<br>
• Dopo il pagamento online, segnala allo staff per l'accredito<br>
• Le quote degli eventi non si pagano da qui: si pagano dentro l'evento, persona per persona</p>
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
<p><strong>📦 CONSEGNE GADGET</strong><br>
• Elenco delle prenotazioni gadget dei soci, filtrabili per stato<br>
• 📦 Consegna: scegli la taglia effettiva e il metodo di pagamento, poi conferma<br>
• Con 💳 Credito il saldo del socio viene addebitato in quel momento (se non basta, l'operazione viene rifiutata)<br>
• Con 💵 Contanti o 🔗 SumUp incassi tu e la consegna viene registrata senza toccare il credito<br>
• Lo stock della taglia si scala solo qui, alla consegna</p>
<p><strong>📱 SUMUP DA CONFERMARE</strong><br>
• Elenco delle quote che i soci hanno segnato come pagate con SumUp<br>
• Per ogni riga: evento, persona, tessera, importo e quando è stata segnata<br>
• ✅ Conferma se il pagamento è arrivato · ❌ Rifiuta per riportarla a "da saldare"</p>
<p><strong>🏷️ PROMO</strong><br>
• Vedi le promo attive — le promo si applicano automaticamente sugli addebiti<br>
• Solo l'admin può creare/modificare/eliminare promo</p>
<p><strong>📤 INVITA NUOVI SOCI</strong><br>
• Link app per passaparola e volantini: <a href="https://bit.ly/shanghai-card" target="_blank" rel="noopener" style="color:var(--gold)">bit.ly/shanghai-card</a></p>`,

  admin: `<h3 style="color:var(--gold);margin:0 0 16px">⚙️ GUIDA AMMINISTRAZIONE</h3>
<p><strong>📊 DASHBOARD</strong><br>
• Panoramica: soci attivi (con il numero di staff incluso), saldo totale, transazioni del periodo<br>
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
• <strong>Descrizione</strong>: puoi andare a capo, usare **grassetto** e incollare link/email/telefoni — nel dettaglio evento diventano cliccabili<br>
• <strong>Fasce di prezzo</strong>: i prezzi per età (es. Adulto € 15 · Ragazz* € 10 · 0-3 gratis)<br>
• <strong>Menù</strong>: sotto le fasce. Le sezioni in "Comune a tutte le fasce" le vedono tutti; quelle sotto una fascia solo chi sceglie quella fascia. ↑↓ per l'ordine, "Sposta in" per cambiare gruppo. Si salva insieme all'evento<br>
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
• Crea e gestisci i gadget del Rione (nome, prezzo, stock, descrizione)<br>
• ✏️ Modifica → "Ha taglie?": imposta lo stock per XS/S/M/L/XL/XXL<br>
• Stock 0 su una taglia = esaurita: i soci possono comunque prenotare finendo in lista d'attesa<br>
• Su ogni gadget vedi i contatori reali: 📌 prenotati · ✅ consegnati · ⏳ in attesa</p>
<p><strong>📱 SUMUP DA CONFERMARE</strong><br>
• Quote segnate dai soci come pagate con SumUp, in attesa di verifica<br>
• ✅ Conferma o ❌ Rifiuta; il contatore sulla tab mostra quante sono in sospeso</p>
<p><strong>📦 CONSEGNE GADGET</strong><br>
• Filtri di stato: Da consegnare · Consegnati · In attesa d'ordine · Annullati · Tutti<br>
• 📦 Consegna apre il modale: puoi correggere <strong>taglia</strong> e <strong>metodo di pagamento</strong> al momento del ritiro<br>
• Con 💳 Credito vedi il saldo del socio (in rosso se non basta) e la consegna lo addebita<br>
• Con 💵 Contanti o 🔗 SumUp incassi tu: nessun addebito sul credito<br>
• <strong>Stock e credito si scalano solo alla consegna</strong>, mai alla prenotazione<br>
• Sezione Waitlist: pezzi in attesa raggruppati per gadget e taglia<br>
• Sezione Statistiche: consegnati per taglia, incassi per gadget e stock residuo</p>
<p><strong>🎟️ ISCRITTI ESTERNI</strong><br>
• Aggiungi partecipanti non soci a un evento (nome, cognome, contatti, importo)<br>
• ✏️ Modifica i dati · ✅ Conferma il pagamento (credito/SumUp/contanti) · 🗑️ Elimina (solo admin)</p>
<p><strong>↩️ RIMBORSI</strong><br>
• Coda dei rimborsi da erogare a mano (annullamenti pagati con SumUp)<br>
• Aggiungi una nota e segna il rimborso come completato</p>
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
  // datetime-local vuole "YYYY-MM-DDTHH:MM" in ora LOCALE, non UTC
  document.getElementById('eve-date').value  = _isoToLocalInput(e.event_date);
  document.getElementById('eve-loc').value   = e.location || '';
  document.getElementById('eve-maxp').value  = e.max_participants || 0;
  document.getElementById('eve-price').value = e.price || 0;
  document.getElementById('eve-sumup').value = e.sumup_link || '';
  document.getElementById('eve-slug').value  = e.slug || '';
  document.getElementById('eve-public').checked = !!e.public_registration;
  const curImg = e.image_url || '';
  document.getElementById('eve-img').value = curImg;
  setImageUploaderPreview('eve-img-mount', curImg);
  // valore corrente da admin_list_events; null/undefined → "Nessuno"
  _evePromoOrig = e.promo_group || '';
  _fillPromoSelect('eve-promo', _evePromoOrig);
  loadTierDraft('eve', e.id);   // async: la lista si popola appena arrivano le fasce
  loadMenuDraft('eve', e.id);   // idem per il menù (gruppi = fasce)
  document.getElementById('ev-edit-bg').style.display = 'block';
}
function closeEditEvent() {
  document.getElementById('ev-edit-bg').style.display = 'none';
}
async function saveEditEvent() {
  const id = document.getElementById('eve-id').value;
  if (!id) return;
  // Fasce validate PRIMA dell'update: se una riga è incompleta non si procede.
  const tiers = collectTierDraft('eve');
  if (!tiers.ok) return toast(TIER_INVALID_MSG);
  const dateVal = document.getElementById('eve-date').value;
  const payload = {
    p_admin_id:            currentUser.id,
    p_event_id:            id,
    p_title:               document.getElementById('eve-title').value.trim() || null,
    p_description:         document.getElementById('eve-desc').value.trim() || null,
    p_event_date:          _localInputToIso(dateVal),
    p_location:            document.getElementById('eve-loc').value.trim() || null,
    p_max_participants:    parseInt(document.getElementById('eve-maxp').value) || 0,
    p_price:               parseFloat(document.getElementById('eve-price').value) || 0,
    p_sumup_link:          document.getElementById('eve-sumup').value.trim() || null,
    p_slug:                document.getElementById('eve-slug').value.trim() || null,
    p_public_registration: document.getElementById('eve-public').checked,
    p_image_url:           document.getElementById('eve-img').value.trim() || null
  };
  // Gruppo promo: le due chiavi vanno SEMPRE inviate, altrimenti PostgREST non riesce
  // a scegliere tra i due overload di admin_update_event (errore PGRST203).
  // "Nessuno" su un evento che aveva un gruppo → clear; se non l'aveva → nessuna modifica.
  const promoVal = document.getElementById('eve-promo')?.value || '';
  if (promoVal) { payload.p_promo_group = promoVal; payload.p_clear_promo_group = false; }
  else          { payload.p_promo_group = null;     payload.p_clear_promo_group = !!_evePromoOrig; }

  const { data, error } = await db.rpc('admin_update_event', payload);
  if (error) return toast(error.message);
  if (!data || !data.ok) return toast(data?.error || 'Errore');
  toast('Evento aggiornato', 'ok');
  // Fasce di prezzo: dopo l'update dell'evento, errori segnalati senza rollback
  const tierRes = await applyTierOps(id, tiers.ops);
  if (tierRes.errors.length || tierRes.changed) _tierOpsToast(tierRes);
  const menuRes = await applyMenuOps('eve', id);
  if (menuRes.errors.length || menuRes.changed) _menuOpsToast(menuRes);
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
  document.getElementById('evp-desc').innerHTML = _richText(ev.description || '');
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

// ═══════════════════════════════════════════════════════════════════════
// PAGAMENTI DA CONFERMARE — coda unificata SumUp + Cassa (admin + staff)
// ═══════════════════════════════════════════════════════════════════════
let _sumupPending = [];
const _PM_BADGE = {
  sumup: ['🔗 SumUp', 'pb-sumup'],
  cassa: ['💵 Cassa', 'pb-cash']
};
function payMethodBadge(method) {
  const [label, cls] = _PM_BADGE[method] || ['—', 'pb-off'];
  return `<span class="pb ${cls}">${label}</span>`;
}
async function loadPendingSumup(ctx) {
  const listId = ctx === 'admin' ? 'a-sumup-list' : 's-sumup-list';
  const tabId  = ctx === 'admin' ? 'a-sumup-tab'  : 's-sumup-tab';
  const el = document.getElementById(listId);
  if (!el) return;
  el.innerHTML = '<div class="empty">⏳ Carico…</div>';
  const {data, error} = await db.rpc('admin_list_pending_payments', {p_operator_id: currentUser.id});
  if (error || !data || !data.ok) {
    el.innerHTML = `<div class="empty">${_esc((error && error.message) || (data && data.error) || 'Errore caricamento')}</div>`;
    return;
  }
  _sumupPending = data.pending || data.items || [];
  _tabBadge(tabId, _sumupPending.length, '💳 Pagamenti da confermare');
  if (!_sumupPending.length) { el.innerHTML = '<div class="empty">Nessun pagamento in attesa</div>'; return; }
  el.innerHTML = _sumupPending.map(p => `
    <div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:700;flex:1;min-width:120px">${_esc(p.event_title || '—')}</span>
        <span style="font-weight:700;color:var(--gold)">${eur(p.amount)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--mut);margin-top:4px">
        <span>👤 ${_esc(p.person_name || '—')}</span>
        ${payMethodBadge(p.payment_method)}
        ${p.card_id ? '<span class="mono">' + _esc(p.card_id) + '</span>' : ''}
        ${p.target_type === 'companion' ? '<span>· accompagnatore</span>' : ''}
      </div>
      <div style="font-size:11px;color:var(--mut);margin-top:2px">
        ${p.event_date ? '📅 ' + fdt(p.event_date) : ''}${p.marked_at ? ' · segnato ' + fdt(p.marked_at) : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-p" style="flex:1;min-width:110px"
          onclick="sumupDecide('${ctx}','confirm','${p.target_type}','${p.target_id}')">✅ Conferma</button>
        <button class="btn btn-q" style="flex:1;min-width:110px"
          onclick="sumupDecide('${ctx}','reject','${p.target_type}','${p.target_id}')">❌ Rifiuta</button>
      </div>
    </div>`).join('');
}
async function sumupDecide(ctx, action, targetType, targetId) {
  const p = _sumupPending.find(x => String(x.target_id) === String(targetId) && x.target_type === targetType);
  const personName = (p && p.person_name) || 'questa persona';
  const amount = p ? _num(p.amount) : 0;
  const metodo = p && p.payment_method === 'cassa' ? 'in cassa' : 'con SumUp';
  const isOk = action === 'confirm';
  const msg = isOk
    ? `Confermare il pagamento ${metodo} di ${personName} (${eur(amount)})?\n\nLa quota risulterà saldata.`
    : `Rifiutare il pagamento ${metodo} di ${personName} (${eur(amount)})?\n\nLa quota tornerà "da saldare".`;
  modalConfirm(msg, async () => {
    const rpc = isOk ? 'admin_confirm_payment' : 'admin_reject_payment';
    const {data, error} = await db.rpc(rpc, {p_operator_id: currentUser.id, p_target_type: targetType, p_target_id: targetId});
    if (error || !data || !data.ok) return toast((error && error.message) || (data && data.error) || 'Errore');
    toast(data.message || (isOk ? '✅ Pagamento confermato' : '❌ Pagamento rifiutato'), 'ok');
    await loadPendingSumup(ctx);
    if (ctx === 'admin') loadDash();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ORDINI GADGET (admin) — lista + waitlist + statistiche
// ═══════════════════════════════════════════════════════════════════════
let _goAll = [], _goStats = null, _delivCtx = 'admin', _delivStatus = 'prenotato', _delivCatalog = {};
function _num(...vals) { for (const v of vals) if (v != null && v !== '') return Number(v) || 0; return 0; }
function _pick(o, ...keys) { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return null; }

const _DELIV_IDS = {
  admin: {list: 'go-list', name: 'go-f-name', size: 'go-f-size', filters: 'go-filters'},
  staff: {list: 'sd-list', name: 'sd-f-name', size: 'sd-f-size', filters: 'sd-filters'}
};
const _DELIV_FILTERS = [
  {v: 'prenotato',     l: 'Da consegnare'},
  {v: 'consegnato',    l: 'Consegnati'},
  {v: 'attesa_ordine', l: "In attesa d'ordine"},
  {v: 'annullato',     l: 'Annullati'},
  {v: 'all',           l: 'Tutti'}
];
function _delivIds() { return _DELIV_IDS[_delivCtx] || _DELIV_IDS.admin; }
function setDelivFilter(status) {
  _delivStatus = status;
  loadDeliveries(_delivCtx, status);
}
async function loadDeliveries(ctx, status) {
  _delivCtx = ctx || _delivCtx;
  _delivStatus = status || _delivStatus || 'prenotato';
  const ids = _delivIds();
  const el = document.getElementById(ids.list);
  if (!el) return;
  const fEl = document.getElementById(ids.filters);
  if (fEl) fEl.innerHTML = _DELIV_FILTERS.map(f =>
    `<button class="fbtn ${f.v === _delivStatus ? 'active' : ''}" onclick="setDelivFilter('${f.v}')">${f.l}</button>`).join('');
  el.innerHTML = '<div class="empty">⏳ Carico…</div>';
  const calls = [
    db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id, p_status_filter: _delivStatus}),
    db.rpc('get_catalog')
  ];
  if (_delivCtx === 'admin') calls.push(db.rpc('admin_gadget_sales_stats', {p_operator_id: currentUser.id}));
  const [res, cat, stats] = await Promise.all(calls);
  if (res.error || (res.data && res.data.ok === false)) {
    el.innerHTML = `<div class="empty">${_esc((res.error && res.error.message) || (res.data && res.data.error) || 'Errore caricamento')}</div>`;
    return;
  }
  _goAll = (res.data && (res.data.reservations || (Array.isArray(res.data) ? res.data : []))) || [];
  _delivCatalog = {};
  ((cat.data && cat.data.gadgets) || []).forEach(g => { _delivCatalog[g.id] = g; });
  const sizes = Array.from(new Set(_goAll.map(r => r.size).filter(Boolean))).sort();
  const sel = document.getElementById(ids.size);
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Tutte le taglie</option>' + sizes.map(s => `<option value="${_esc(s)}">${_esc(s)}</option>`).join('');
    sel.value = sizes.includes(cur) ? cur : '';
  }
  renderDeliveries();
  if (_delivCtx === 'admin') {
    _goStats = (stats && stats.data) || null;
    await renderWaitlist();
    renderGadgetStats();
  }
}
function renderDeliveries() {
  const ids = _delivIds();
  const el = document.getElementById(ids.list);
  if (!el) return;
  const fName = (document.getElementById(ids.name)?.value || '').toLowerCase().trim();
  const fSize = document.getElementById(ids.size)?.value || '';
  const list = _goAll.filter(r =>
    (!fName || String(r.gadget_name || '').toLowerCase().includes(fName)) &&
    (!fSize || r.size === fSize));
  if (!list.length) { el.innerHTML = '<div class="empty">Nessuna prenotazione in questo stato</div>'; return; }
  el.innerHTML = list.map(r => {
    const id  = _resId(r);
    const tot = _num(r.payment_amount, r.total_price);
    const sz  = (r.has_sizes && r.size) ? ` · <span class="dlv-size">taglia ${_esc(r.size)}</span>` : '';
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div class="dlv-row">
        <div class="dlv-main">
          <div style="font-weight:700">${_esc(r.user_name || '—')} <span class="mono" style="font-size:11px;color:var(--mut)">${_esc(r.card_id || '')}</span></div>
          <div style="font-size:13px;margin-top:2px">${_esc(r.gadget_name || '—')}${sz} <span style="color:var(--mut)">· x${r.quantity}</span></div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:var(--gold)">${eur(tot)}</div>
          <div style="margin-top:3px">${payMethodPill(r.payment_method)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
        ${resBadge(r.status || 'prenotato')}
        <span style="font-size:11px;color:var(--mut)">
          ${r.status === 'consegnato' && r.fulfilled_at ? 'Consegnato il ' + fdt(r.fulfilled_at).split(' ')[0] : (r.created_at ? 'Prenotato il ' + fdt(r.created_at).split(' ')[0] : '')}
        </span>
        ${r.status === 'prenotato' ? `<button class="btn btn-p" style="margin-left:auto" onclick="openDeliv('${id}')">📦 Consegna</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── MODALE CONSEGNA ──────────────────────────────────────────────────
let _delivRes = null, _delivPay = 'credito', _delivFrom = 'tab';
function openDeliv(resId, from) {
  const r = _goAll.find(x => _resId(x) === resId) || _cassaRes.find(x => _resId(x) === resId);
  if (!r) return toast('Prenotazione non trovata');
  _delivRes = r;
  _delivFrom = from || 'tab';
  document.getElementById('deliv-title').textContent = `Consegna a ${r.user_name || '—'}`;
  document.getElementById('deliv-gadget').textContent =
    `${r.gadget_name} · x${r.quantity} · ${eur(_num(r.gadget_price, _resUnit(r)))} cad.`;
  const g   = _delivCatalog[r.gadget_id];
  const fg  = document.getElementById('deliv-size-fg');
  const sel = document.getElementById('deliv-size');
  if (r.has_sizes) {
    const opts = _gadgetSizes(g).map(s => s.size);
    if (!opts.length) opts.push(...PRESET_SIZES);
    if (r.size && !opts.includes(r.size)) opts.unshift(r.size);
    sel.innerHTML = opts.map(s => {
      const info = _gadgetSizes(g).find(x => x.size === s);
      const av   = info ? _num(info.available != null ? info.available : info.stock) : null;
      return `<option value="${_esc(s)}"${s === r.size ? ' selected' : ''}>${_esc(s)}${av != null ? ` (disp. ${av})` : ''}</option>`;
    }).join('');
    fg.style.display = '';
  } else {
    sel.innerHTML = ''; fg.style.display = 'none';
  }
  setDelivPay(r.payment_method || 'credito');
  document.getElementById('deliv-bg').classList.add('open');
}
function closeDeliv() { document.getElementById('deliv-bg').classList.remove('open'); _delivRes = null; }
function setDelivPay(method) {
  _delivPay = method;
  document.getElementById('deliv-pay').innerHTML = _pmSegHtml(_delivPay, 'setDelivPay');
  updateDelivSummary();
}
function updateDelivSummary() {
  const r = _delivRes;
  if (!r) return;
  const tot = _num(r.payment_amount, r.total_price);
  const bal = _num(r.user_balance);
  const short = _delivPay === 'credito' && bal < tot;
  document.getElementById('deliv-summary').innerHTML =
    `Totale: <strong style="color:var(--gold)">${eur(tot)}</strong>` +
    (_delivPay === 'credito'
      ? `<div style="color:${short ? 'var(--neg)' : 'var(--mut)'}">Saldo attuale socio: <strong>${eur(bal)}</strong>${short ? ' — insufficiente' : ''}</div>`
      : `<div style="color:var(--mut)">Incasso ${_delivPay === 'contanti' ? 'in contanti' : 'con SumUp'}: nessun addebito sul credito.</div>`);
  document.getElementById('deliv-ok').textContent = _delivPay === 'credito' ? 'Consegna e addebita' : 'Consegna';
}
async function confirmDeliv() {
  const r = _delivRes;
  if (!r) return;
  const size = document.getElementById('deliv-size-fg').style.display === 'none'
    ? null : (document.getElementById('deliv-size').value || null);
  const pay = _delivPay;
  const tot = _num(r.payment_amount, r.total_price);
  const label = (_PM_PILL[pay] || ['—'])[0];
  const ctx = _delivCtx;
  const from = _delivFrom;
  const resId = _resId(r);
  const userId = r.user_id;
  const nome = r.user_name || '—';
  const gadget = r.gadget_name || 'gadget';
  closeDeliv();
  const dett = [
    `${gadget}${size ? ' · taglia ' + size : ''} · x${r.quantity}`,
    `Metodo: ${label}`,
    `Totale: ${eur(tot)}`,
    pay === 'credito' ? `Verrà addebitato sul credito di ${nome} (saldo ${eur(_num(r.user_balance))})` : 'Incasso registrato senza toccare il credito'
  ].join('\n');
  modalConfirm(`Confermi la consegna a ${nome}?\n\n${dett}`, async () => {
    const {data, error} = await db.rpc('staff_deliver_gadget', {
      p_operator_id: currentUser.id, p_reservation_id: resId,
      p_final_size: size, p_final_payment_method: pay
    });
    if (error || !data || !data.ok) {
      return modalInfo('❌ Consegna non riuscita\n\n' + ((error && error.message) || (data && data.error) || 'Errore sconosciuto'));
    }
    toast(data.message || `✅ Consegnato a ${nome}`, 'ok');
    if (staffTarget && staffTarget.card_id) {
      const {data: u} = await db.rpc('staff_lookup', {p_card_id: staffTarget.card_id});
      const nu = u && (u.user || u);
      if (nu && nu.balance != null) {
        staffTarget = nu;
        const b1 = document.getElementById('s-res-bal'); if (b1) b1.textContent = eur(nu.balance);
        const b2 = document.getElementById('ac-res-bal'); if (b2) b2.textContent = eur(nu.balance);
      }
    }
    if (from === 'cassa-staff')      await loadStaffGadgetReservationsForUser(userId);
    else if (from === 'cassa-admin') await loadAcGadgetReservationsForUser(userId);
    else                             await loadDeliveries(ctx);
  });
}
async function renderWaitlist() {
  const el = document.getElementById('go-waitlist');
  if (!el) return;
  let items = _goAll.filter(r => (r.status || '') === 'attesa_ordine');
  if (_delivStatus !== 'all' && _delivStatus !== 'attesa_ordine') {
    const {data} = await db.rpc('staff_list_gadget_reservations', {p_operator_id: currentUser.id, p_status_filter: 'attesa_ordine'});
    items = (data && (data.reservations || (Array.isArray(data) ? data : []))) || [];
  }
  if (!items.length) { el.innerHTML = '<div class="empty">Nessuna richiesta in lista d\'attesa</div>'; return; }
  const groups = {};
  items.forEach(i => {
    const g = i.gadget_name || '—';
    const s = i.size || '—';
    const q = _num(i.quantity, 1);
    const k = g + ' | ' + s;
    groups[k] = groups[k] ? {...groups[k], qty: groups[k].qty + q, n: groups[k].n + 1} : {gadget: g, size: s, qty: q, n: 1};
  });
  const rows = Object.values(groups).sort((a, b) => b.qty - a.qty);
  const tot = rows.reduce((s, r) => s + r.qty, 0);
  el.innerHTML = `<div style="font-size:12px;color:var(--mut);margin-bottom:6px">${tot} pezzi in attesa su ${rows.length} combinazioni gadget/taglia</div>
    <div class="tbl-wrap"><table><thead><tr><th>Gadget</th><th>Taglia</th><th>Pezzi</th><th>Richieste</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${_esc(r.gadget)}</td><td>${_esc(r.size)}</td><td style="text-align:center;font-weight:700;color:var(--gold)">${r.qty}</td><td style="text-align:center">${r.n}</td></tr>`).join('') +
    '</tbody></table></div>';
}
function _barChart(rows, title) {
  if (!rows.length) return '<div class="empty">Nessun dato</div>';
  const max = Math.max(...rows.map(r => r.v), 1);
  const bw = 46, gap = 14, h = 130;
  const w = rows.length * (bw + gap) + gap;
  return `<svg class="bar-chart" viewBox="0 -18 ${w} ${h + 54}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="${_esc(title)}">
    ${rows.map((r, i) => {
      const bh = Math.max(2, Math.round(r.v / max * h));
      const x  = gap + i * (bw + gap);
      return `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="4" fill="#FFD60A" opacity=".85"></rect>
        <text x="${x + bw / 2}" y="${h - bh - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">${r.v}</text>
        <text x="${x + bw / 2}" y="${h + 18}" text-anchor="middle" font-size="12" fill="currentColor" opacity=".7">${_esc(r.k)}</text>`;
    }).join('')}
  </svg>`;
}
function renderGadgetStats() {
  const el = document.getElementById('go-stats');
  if (!el) return;
  if (!_goStats || _goStats.ok === false) { el.innerHTML = '<div class="empty">Statistiche non disponibili</div>'; return; }
  const bySize = (_goStats.by_size || []).map(s => ({
    k: _pick(s, 'size', 'taglia') || '—',
    v: _num(s.quantity, s.qty, s.total, s.venduti, s.count)
  })).filter(s => s.v >= 0);
  const byGadget = (_goStats.by_gadget || []).map(g => ({
    name: _pick(g, 'gadget_name', 'name', 'gadget') || '—',
    qty:  _num(g.quantity, g.qty, g.total, g.venduti, g.count),
    amount: _num(g.amount, g.incasso, g.revenue, g.total_amount)
  }));
  const stock = (_goStats.stock_levels || []).map(s => ({
    name: _pick(s, 'gadget_name', 'name', 'gadget') || '—',
    size: _pick(s, 'size', 'taglia') || '—',
    v:    _num(s.stock, s.disponibili, s.available)
  }));
  el.innerHTML =
    `<div class="card" style="padding:14px;margin-bottom:10px">
      <div class="sec-lbl">Consegnati per taglia</div>
      ${_barChart(bySize, 'Consegnati per taglia')}
    </div>` +
    (byGadget.length ? `<div class="tbl-wrap" style="margin-bottom:10px"><table><thead><tr><th>Gadget</th><th>Pezzi</th><th>Incasso</th></tr></thead><tbody>` +
      byGadget.map(g => `<tr><td>${_esc(g.name)}</td><td style="text-align:center">${g.qty}</td><td>${eur(g.amount)}</td></tr>`).join('') +
      '</tbody></table></div>' : '') +
    (stock.length ? `<div class="sec-lbl">Stock residuo</div><div class="tbl-wrap"><table><thead><tr><th>Gadget</th><th>Taglia</th><th>Stock</th></tr></thead><tbody>` +
      stock.map(s => `<tr><td>${_esc(s.name)}</td><td>${_esc(s.size)}</td><td style="text-align:center;color:${s.v > 0 ? 'var(--grn)' : 'var(--neg)'}">${s.v}</td></tr>`).join('') +
      '</tbody></table></div>' : '');
}

// ═══════════════════════════════════════════════════════════════════════
// ISCRITTI ESTERNI (admin/staff)
// ═══════════════════════════════════════════════════════════════════════
let _extGuests = [];
async function _ensureAdminEvents() {
  if (_adminEvents.length) return _adminEvents;
  const {data} = await db.rpc('get_catalog');
  _adminEvents = (data && data.events) || [];
  return _adminEvents;
}
function _eventOptions(selected) {
  return _adminEvents.map(e =>
    `<option value="${e.id}"${e.id === selected ? ' selected' : ''}>${_esc(e.title)}${e.event_date ? ' — ' + fdt(e.event_date).split(' ')[0] : ''}</option>`).join('');
}
async function loadExternalGuests() {
  const el = document.getElementById('eg-list');
  if (!el) return;
  await _ensureAdminEvents();
  const sel = document.getElementById('eg-filter-event');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tutti gli eventi</option>' + _eventOptions(cur);
  sel.value = cur;
  el.innerHTML = '<div class="empty">⏳ Carico…</div>';
  const {data, error} = await db.rpc('admin_list_external_guests', {p_operator_id: currentUser.id, p_event_id: cur || null});
  if (error || !data || data.ok === false) {
    el.innerHTML = `<div class="empty">${_esc((error && error.message) || (data && data.error) || 'Errore caricamento')}</div>`;
    return;
  }
  _extGuests = Array.isArray(data) ? data : (data.guests || data.items || []);
  if (!_extGuests.length) { el.innerHTML = '<div class="empty">Nessun iscritto esterno</div>'; return; }
  const isAdmin = currentUser.role === 'admin';
  el.innerHTML = `<div class="tbl-wrap"><table><thead><tr>
      <th>Nome</th><th>Evento</th><th>Contatti</th><th>Importo</th><th>Stato</th><th>Data</th><th></th>
    </tr></thead><tbody>` + _extGuests.map(g => {
      const id = _pick(g, 'guest_id', 'id');
      const st = g.payment_status || 'da_saldare';
      return `<tr>
        <td>${_esc(g.nome || '')} ${_esc(g.cognome || '')}</td>
        <td style="font-size:12px">${_esc(g.event_title || '—')}</td>
        <td style="font-size:11px;color:var(--mut)">${_esc(g.telefono || '—')}<br>${_esc(g.email || '')}</td>
        <td>${eur(g.amount)}</td>
        <td>${payBadge(st)}
          ${st === 'da_saldare' ? `<div style="display:flex;gap:3px;margin-top:4px">
            <button class="btn-sm" style="font-size:10px;padding:2px 6px" title="Conferma pagamento con credito" onclick="extGuestConfirm('${id}','credito')">💳</button>
            <button class="btn-sm" style="font-size:10px;padding:2px 6px" title="Conferma pagamento SumUp" onclick="extGuestConfirm('${id}','sumup')">📱</button>
            <button class="btn-sm" style="font-size:10px;padding:2px 6px" title="Conferma pagamento contanti" onclick="extGuestConfirm('${id}','contanti')">💵</button>
          </div>` : ''}
        </td>
        <td class="dt-cell">${g.created_at ? fdt(g.created_at).split(' ')[0] : '—'}</td>
        <td style="white-space:nowrap">
          <button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="openExtGuestModal('${id}')">✏️</button>
          ${isAdmin ? `<button class="btn-sm" style="font-size:10px;padding:2px 6px;color:var(--neg)" onclick="extGuestDelete('${id}')">🗑️</button>` : ''}
        </td>
      </tr>`;
    }).join('') + '</tbody></table></div>';
}
function extgEventChanged() {
  const ev = _adminEvents.find(e => e.id === document.getElementById('extg-event').value);
  if (ev) document.getElementById('extg-amount').value = ev.price != null ? ev.price : '';
}
async function openExtGuestModal(guestId) {
  await _ensureAdminEvents();
  const g = guestId ? _extGuests.find(x => String(_pick(x, 'guest_id', 'id')) === String(guestId)) : null;
  document.getElementById('extg-title').textContent = g ? '✏️ Modifica iscritto esterno' : '➕ Nuovo iscritto esterno';
  document.getElementById('extg-id').value      = g ? _pick(g, 'guest_id', 'id') : '';
  document.getElementById('extg-nome').value    = g ? (g.nome || '') : '';
  document.getElementById('extg-cognome').value = g ? (g.cognome || '') : '';
  document.getElementById('extg-email').value   = g ? (g.email || '') : '';
  document.getElementById('extg-tel').value     = g ? (g.telefono || '') : '';
  const evSel = document.getElementById('extg-event');
  const preset = (g && g.event_id) || document.getElementById('eg-filter-event').value || (_adminEvents[0] && _adminEvents[0].id) || '';
  evSel.innerHTML = _eventOptions(preset);
  evSel.value = preset;
  document.getElementById('extg-event-fg').style.display  = g ? 'none' : '';
  document.getElementById('extg-status-fg').style.display = g ? 'none' : '';
  document.getElementById('extg-status').value = 'da_saldare';
  if (g) document.getElementById('extg-amount').value = g.amount != null ? g.amount : '';
  else extgEventChanged();
  document.getElementById('extg-bg').classList.add('open');
}
function closeExtGuestModal() { document.getElementById('extg-bg').classList.remove('open'); }
async function saveExtGuest() {
  const id      = document.getElementById('extg-id').value;
  const nome    = document.getElementById('extg-nome').value.trim();
  const cognome = document.getElementById('extg-cognome').value.trim();
  const email   = document.getElementById('extg-email').value.trim();
  const tel     = document.getElementById('extg-tel').value.trim();
  const amount  = parseFloat(document.getElementById('extg-amount').value) || 0;
  const eventId = document.getElementById('extg-event').value;
  const status  = document.getElementById('extg-status').value;
  if (!nome || !cognome) return toast('Nome e cognome obbligatori');
  if (!id && !eventId)   return toast('Seleziona un evento');
  const run = async () => {
    const call = id
      ? db.rpc('admin_update_external_guest', {p_operator_id: currentUser.id, p_guest_id: id, p_nome: nome, p_cognome: cognome, p_email: email || null, p_telefono: tel || null, p_amount: amount})
      : db.rpc('admin_create_external_guest', {p_operator_id: currentUser.id, p_event_id: eventId, p_nome: nome, p_cognome: cognome, p_email: email || null, p_telefono: tel || null, p_amount: amount, p_payment_status: status});
    const {data, error} = await call;
    if (error || !data || data.ok === false) return toast((error && error.message) || (data && data.error) || 'Errore salvataggio');
    toast(id ? '✅ Iscritto aggiornato' : '✅ Iscritto esterno aggiunto', 'ok');
    loadExternalGuests();
  };
  closeExtGuestModal();
  const financial = !id && status !== 'da_saldare';
  if (financial) {
    const lbl = {saldato_credito:'credito', saldato_sumup:'SumUp', saldato_contanti:'contanti'}[status] || status;
    modalConfirm(`Registrare ${nome} ${cognome} come già saldato (${lbl}) per ${eur(amount)}?`, run);
  } else if (id && amount) {
    modalConfirm(`Salvare le modifiche di ${nome} ${cognome}?\n\nImporto: ${eur(amount)}`, run);
  } else {
    await run();
  }
}
async function extGuestConfirm(guestId, method) {
  const g = _extGuests.find(x => String(_pick(x, 'guest_id', 'id')) === String(guestId));
  const label = {credito:'credito', sumup:'SumUp', contanti:'contanti'}[method] || method;
  const who = g ? `${g.nome} ${g.cognome}` : 'questo iscritto';
  const amt = g ? _num(g.amount) : 0;
  modalConfirm(`Confermare il pagamento di ${who} (${eur(amt)}) — ${label}?`, async () => {
    const {data, error} = await db.rpc('admin_confirm_external_guest', {p_operator_id: currentUser.id, p_guest_id: guestId, p_payment_method: method});
    if (error || !data || data.ok === false) return toast((error && error.message) || (data && data.error) || 'Errore');
    toast(data.message || '✅ Pagamento confermato', 'ok');
    loadExternalGuests();
  });
}
async function extGuestDelete(guestId) {
  const g = _extGuests.find(x => String(_pick(x, 'guest_id', 'id')) === String(guestId));
  const who = g ? `${g.nome} ${g.cognome}` : 'questo iscritto';
  modalConfirm(`Eliminare ${who}?\n\nL'operazione non è reversibile.`, async () => {
    const {data, error} = await db.rpc('admin_delete_external_guest', {p_operator_id: currentUser.id, p_guest_id: guestId});
    if (error || !data || data.ok === false) return toast((error && error.message) || (data && data.error) || 'Errore');
    toast('Iscritto eliminato', 'ok');
    loadExternalGuests();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CODA RIMBORSI (admin/staff)
// ═══════════════════════════════════════════════════════════════════════
let _refunds = [];
async function loadRefundQueue() {
  const el = document.getElementById('rf-list');
  if (!el) return;
  el.innerHTML = '<div class="empty">⏳ Carico…</div>';
  const {data, error} = await db.rpc('admin_list_refund_queue', {p_operator_id: currentUser.id});
  if (error || !data || data.ok === false) {
    el.innerHTML = `<div class="empty">${_esc((error && error.message) || (data && data.error) || 'Errore caricamento')}</div>`;
    return;
  }
  _refunds = Array.isArray(data) ? data : (data.items || []);
  _tabBadge('a-refund-tab', _refunds.length, '↩️ Rimborsi');
  if (!_refunds.length) { el.innerHTML = '<div class="empty">Nessun rimborso in attesa</div>'; return; }
  el.innerHTML = _refunds.map(r => {
    const id = _pick(r, 'refund_id', 'id');
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:130px">
          <div style="font-weight:600">${_esc(_pick(r, 'display_name', 'user_name', 'socio') || '—')}</div>
          <div class="mono" style="font-size:11px;color:var(--mut)">${_esc(r.card_id || '')}</div>
        </div>
        <span style="font-weight:700;color:var(--gold)">${eur(r.amount)}</span>
      </div>
      <div style="font-size:12px;color:var(--mut);margin-top:4px">
        ${_esc(_pick(r, 'reason', 'motivo', 'description') || 'Rimborso')} ·
        metodo originale: ${_esc(_pick(r, 'original_method', 'payment_method', 'method') || '—')} ·
        ${r.created_at ? fdt(r.created_at) : '—'}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <input type="text" id="rf-note-${id}" placeholder="Nota (es. rimborsato in contanti)" style="flex:1;min-width:140px;font-size:13px;padding:8px 10px">
        <button class="btn btn-p" style="flex-shrink:0" onclick="completeRefund('${id}')">✅ Segna completato</button>
      </div>
    </div>`;
  }).join('');
}
async function completeRefund(refundId) {
  const r = _refunds.find(x => String(_pick(x, 'refund_id', 'id')) === String(refundId));
  const note = (document.getElementById('rf-note-' + refundId)?.value || '').trim();
  const amt = r ? _num(r.amount) : 0;
  modalConfirm(`Segnare come completato il rimborso di ${eur(amt)}?${note ? '\n\nNota: ' + note : '\n\nNessuna nota inserita.'}`, async () => {
    const {data, error} = await db.rpc('admin_complete_refund', {p_operator_id: currentUser.id, p_refund_id: refundId, p_notes: note || null});
    if (error || !data || data.ok === false) return toast((error && error.message) || (data && data.error) || 'Errore');
    toast(data.message || '✅ Rimborso completato', 'ok');
    await loadRefundQueue();
    loadDash();
  });
}
