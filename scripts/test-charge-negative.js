// Check dell'addebito con saldo negativo autorizzato: carica app.js con stub DOM
// minimi e guida _chargeOrAskNegative nei quattro esiti possibili.
// Uso: node scripts/test-charge-negative.js
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');

const noop = () => {};
const els = {};
const mkEl = () => ({innerHTML: '', textContent: '', value: '', style: {},
                     classList: {add: noop, remove: noop}, addEventListener: noop, appendChild: noop});
const sandbox = {
  console, setTimeout, clearTimeout, JSON, Math, Date, Number, String, Object, Array, Promise,
  navigator: {serviceWorker: {register: () => Promise.resolve()}},
  sessionStorage: {getItem: () => null, setItem: noop},
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

// Strumentazione: RPC, toast e modale finiscono in liste ispezionabili.
run(`
  _spy = {rpc: [], toast: [], modal: [], ok: []};
  _rpcQueue = [];
  db = {rpc: (fn, args) => { _spy.rpc.push({fn, args}); return Promise.resolve(_rpcQueue.shift()); }};
  toast = (m, t) => _spy.toast.push(m);
  modalConfirm = (msg, cb, okLabel) => _spy.modal.push({msg, cb, okLabel});
  currentUser = {id: 'op1'};
`);
const spy = () => JSON.parse(run('JSON.stringify({rpc: _spy.rpc, toast: _spy.toast, ok: _spy.ok, modal: _spy.modal.map(m => ({msg: m.msg, okLabel: m.okLabel}))})'));
const reset = queue => run(`_spy = {rpc: [], toast: [], modal: [], ok: []}; _rpcQueue = ${JSON.stringify(queue)};`);
const charge = () => run(`_chargeOrAskNegative('staff_charge', {p_operator_id:'op1', p_card_id:'SH-1', p_amount:12},
                          'Mario Rossi', d => _spy.ok.push(d))`);

const OK_NORMALE  = {data: {ok: true, charged: 12, old_balance: 30, new_balance: 18}};
const INSUFF      = {data: {ok: false, error: 'insufficient_balance', balance: 5, required: 12}};
const OK_NEGATIVO = {data: {ok: true, charged: 12, new_balance: -7, went_negative: true}};

(async () => {
  // 1. saldo capiente: nessun dialogo, nessun p_allow_negative, una sola chiamata
  reset([OK_NORMALE]);
  await charge();
  let s = spy();
  assert.strictEqual(s.rpc.length, 1, 'capiente: una sola chiamata RPC');
  assert.strictEqual(s.rpc[0].args.p_allow_negative, undefined, 'capiente: non deve passare p_allow_negative');
  assert.strictEqual(s.modal.length, 0, 'capiente: nessun dialogo');
  assert.strictEqual(s.ok.length, 1, 'capiente: onOk non chiamato');

  // 2. saldo insufficiente: dialogo con importi corretti, nessun addebito ancora
  reset([INSUFF, OK_NEGATIVO]);
  await charge();
  s = spy();
  assert.strictEqual(s.rpc.length, 1, 'insufficiente: non deve riprovare da solo');
  assert.strictEqual(s.ok.length, 0, 'insufficiente: nessun addebito prima della conferma');
  assert.strictEqual(s.modal.length, 1, 'insufficiente: manca il dialogo');
  assert(s.modal[0].msg.includes('Saldo insufficiente'), 'dialogo: titolo errato');
  assert(s.modal[0].msg.includes('Mario Rossi'), 'dialogo: manca il nome del socio');
  assert(s.modal[0].msg.includes('€ 5,00'), 'dialogo: balance errato');
  assert(s.modal[0].msg.includes('€ 12,00'), 'dialogo: required errato');
  assert.strictEqual(s.modal[0].okLabel, 'Addebita comunque', 'dialogo: etichetta bottone errata');

  // 3. "Addebita comunque": stessa RPC, stessi parametri, p_allow_negative = true
  await run('_spy.modal[0].cb()');
  s = spy();
  assert.strictEqual(s.rpc.length, 2, 'conferma: manca la seconda chiamata');
  assert.strictEqual(s.rpc[1].fn, 'staff_charge', 'conferma: RPC diversa');
  assert.strictEqual(s.rpc[1].args.p_allow_negative, true, 'conferma: p_allow_negative non impostato');
  assert.strictEqual(s.rpc[1].args.p_amount, 12, 'conferma: parametri alterati');
  assert.strictEqual(s.ok.length, 1, 'conferma: onOk non chiamato');
  assert.strictEqual(s.ok[0].went_negative, true, 'conferma: went_negative non propagato');

  // 4. "Annulla": il callback non parte, nessun secondo addebito
  reset([INSUFF, OK_NEGATIVO]);
  await charge();
  assert.strictEqual(spy().rpc.length, 1, 'annulla: non deve partire un secondo addebito');

  // 5. errore diverso: toast e stop, nessun dialogo
  reset([{data: {ok: false, error: 'card_not_found'}}]);
  await charge();
  s = spy();
  assert.strictEqual(s.modal.length, 0, 'altro errore: nessun dialogo di negativo');
  assert.deepStrictEqual(s.toast, ['card_not_found'], 'altro errore: toast mancante');

  // 6. saldo negativo in rosso, positivo com'era
  run(`_setBal('s-res-bal', -7)`);
  assert.strictEqual(run(`document.getElementById('s-res-bal').style.color`), 'var(--neg)',
    'saldo negativo non evidenziato');
  run(`_setBal('s-res-bal', 18)`);
  assert.strictEqual(run(`document.getElementById('s-res-bal').style.color`), '',
    'saldo positivo non deve restare rosso');
  assert.strictEqual(run(`document.getElementById('s-res-bal').textContent`), '€ 18,00',
    'saldo non formattato');

  console.log('OK — 6 controlli passati');
})().catch(e => { console.error(e.message); process.exit(1); });
