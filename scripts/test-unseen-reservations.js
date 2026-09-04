// Check del badge "prenotazioni gadget non viste" per staff e admin.
// Uso: node scripts/test-unseen-reservations.js
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');

const noop = () => {};
const els = {};
// L'elemento finto sa ritrovare il badge gold dentro il proprio innerHTML: serve a
// verificare che il ridisegno non lo perda.
const mkEl = () => {
  const el = {innerHTML: '', textContent: '', value: '', style: {},
              classList: {add: noop, remove: noop}, addEventListener: noop, appendChild: noop};
  el.querySelector = sel => {
    if (sel !== '.tab-badge') return null;
    const m = /<span class="tab-badge">.*?<\/span>/.exec(el.innerHTML);
    return m ? {outerHTML: m[0]} : null;
  };
  return el;
};
let timers = 0;
const sandbox = {
  console, JSON, Math, Date, Number, String, Object, Array, Promise,
  setTimeout: noop, clearTimeout: noop,
  setInterval: (fn, ms) => { sandbox._intervals.push(ms); return ++timers; },
  clearInterval: id => { sandbox._cleared.push(id); },
  _intervals: [], _cleared: [],
  navigator: {serviceWorker: {register: () => Promise.resolve()}},
  sessionStorage: {getItem: () => null, setItem: noop, removeItem: noop},
  localStorage:   {getItem: () => null, setItem: noop, removeItem: noop},
  document: {addEventListener: noop, createElement: mkEl, querySelectorAll: () => [],
             querySelector: () => mkEl(), body: mkEl(), documentElement: mkEl(),
             getElementById: id => (els[id] = els[id] || mkEl())},
  addEventListener: noop,
  matchMedia: () => ({matches: false, addEventListener: noop}),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), sandbox);
const run = expr => vm.runInContext(expr, sandbox);
const html = id => els[id] ? els[id].innerHTML : '(elemento assente)';

run(`
  _spy = [];
  _unseenData = {ok: true, unseen_count: 0};
  db = {rpc: (fn, args) => { _spy.push(fn); return Promise.resolve({data: _unseenData}); }};
`);
const spy = () => JSON.parse(run('JSON.stringify(_spy)'));
const asOperator = () => run(`currentUser = {id: 'op1', is_staff: true}; _spy = [];`);

(async () => {
  // 1. senza conteggio nessun badge, e mai su tab estranei
  asOperator();
  run(`_unseenData = {ok: true, unseen_count: 0}`);
  await run('refreshUnseenReservations()');
  assert.strictEqual(run(`_unseenBadgeHtml('s-deliv-tab')`), '', 'zero: non deve esserci badge');
  assert(!html('s-deliv-tab').includes('tab-badge-new'), 'zero: badge presente nel DOM');

  // 2. con conteggio: badge rosso su entrambi i tab, staff e admin
  run(`_unseenData = {ok: true, unseen_count: 3}`);
  await run('refreshUnseenReservations()');
  assert(html('s-deliv-tab').includes('<span class="tab-badge-new">3</span>'), 'staff: badge mancante');
  assert(html('a-orders-tab').includes('<span class="tab-badge-new">3</span>'), 'admin: badge mancante');
  assert.strictEqual(run(`_unseenBadgeHtml('a-sumup-tab')`), '', 'il badge non va su altri tab');

  // 3. il ridisegno della label (loadDash) non deve cancellare il badge rosso
  run(`_tabBadge('a-orders-tab', 12, '📦 Consegne gadget')`);
  assert(html('a-orders-tab').includes('<span class="tab-badge">12</span>'), 'conteggio gold perso');
  assert(html('a-orders-tab').includes('<span class="tab-badge-new">3</span>'), 'badge rosso cancellato da _tabBadge');

  // 4. e il ridisegno del badge rosso non deve cancellare il conteggio gold
  run(`_unseenData = {ok: true, unseen_count: 5}`);
  await run('refreshUnseenReservations()');
  assert(html('a-orders-tab').includes('<span class="tab-badge">12</span>'), 'conteggio gold perso al refresh');
  assert(html('a-orders-tab').includes('<span class="tab-badge-new">5</span>'), 'badge rosso non aggiornato');

  // 5. apertura lista: segna viste una volta sola, il badge sparisce
  run('_spy = []');
  await run('markReservationsSeen()');
  assert.deepStrictEqual(spy(), ['staff_mark_reservations_seen'], 'mark: RPC non chiamata');
  assert(!html('a-orders-tab').includes('tab-badge-new'), 'mark: il badge deve sparire');
  assert(html('a-orders-tab').includes('<span class="tab-badge">12</span>'), 'mark: il gold non va toccato');
  run('_spy = []');
  await run('markReservationsSeen()');
  assert.deepStrictEqual(spy(), [], 'mark: non deve richiamare la RPC se non c\'è nulla di nuovo');

  // 6. socio semplice: nessuna chiamata
  run(`currentUser = {id: 'u1', is_staff: false, role: 'user'}; _spy = [];`);
  await run('refreshUnseenReservations()');
  assert.deepStrictEqual(spy(), [], 'socio: non deve interrogare le prenotazioni');

  // 7. polling ogni 60s, fermato al logout
  asOperator();
  run('_intervals = []; _cleared = []; startUnseenReservationsWatch();');
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(_intervals)')), [60000], 'polling non a 60s');
  run('logout()');
  assert.strictEqual(JSON.parse(run('JSON.stringify(_cleared)')).length, 1, 'logout non ferma il polling');
  assert.strictEqual(run('_unseenRes'), 0, 'logout deve azzerare il conteggio');

  console.log('OK — 7 controlli passati');
})().catch(e => { console.error(e.message); process.exit(1); });
