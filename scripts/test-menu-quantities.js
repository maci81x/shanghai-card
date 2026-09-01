// Check della modalità menù di gruppo: carica app.js con stub DOM minimi e
// verifica che l'UI cambi solo quando menu_mode = 'group_quantities'.
// Uso: node scripts/test-menu-quantities.js
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');

const noop = () => {};
const el = () => ({innerHTML: '', textContent: '', style: {}, classList: {add: noop, remove: noop},
                   addEventListener: noop, appendChild: noop});
const sandbox = {
  console, setTimeout, clearTimeout, JSON, Math, Date, Number, String, Object, Array, Promise,
  navigator: {serviceWorker: {register: () => Promise.resolve()}},
  sessionStorage: {getItem: () => null, setItem: noop},
  localStorage:   {getItem: () => null, setItem: noop, removeItem: noop},
  document: {addEventListener: noop, getElementById: () => el(), createElement: el,
             querySelectorAll: () => [], querySelector: () => null, body: el(), documentElement: el()},
  addEventListener: noop,
  matchMedia: () => ({matches: false, addEventListener: noop}),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), sandbox);
// Le variabili di app.js sono `let` di modulo: si leggono e scrivono solo dentro il contesto.
const run = expr => vm.runInContext(expr, sandbox);

const TIERS = JSON.stringify([
  {id: 't1', label: 'Trippa al piatto', price: 7, sort_order: 1},
  {id: 't2', label: 'Fagioli',          price: 3, sort_order: 2},
]);
const setEvd = (mode, reg) => run(`
  _evd = {
    ev: {id:'e1', title:'Street Food', price:0, event_date:'2099-01-01T18:00:00Z', menu_mode:'${mode}'},
    tiers: ${TIERS},
    reg: ${JSON.stringify(reg || {ok: true, registered: false})},
    sumup: [], menu: {common: [], by_tier: []}, prefs: {}
  };
  _evdRows = []; _evdSelfTier = ''; _evdQty = {}; _evdSel = {};`);

// 0. il prezzo si legge da tier.price, non dal label
assert.strictEqual(run('eur(7)'), '\u20ac\u00a07,00', 'formato prezzo errato');

// 1. per_person: comportamento invariato (fascia per me e lista fasce nell'intestazione)
setEvd('per_person');
run(`_evdMode = 'compose'`);
let html = run('_evdComposeHtml()');
assert(html.includes('La tua fascia'), 'per_person: manca la scelta fascia');
assert(!html.includes('Preferenze menù'), 'per_person: non deve mostrare le quantità');
assert(run('_evdTiersHtml()').includes('Fasce di prezzo'), 'per_person: manca la lista fasce');

// 2. group_quantities: niente fasce, contatori a 0 e "−" disabilitato
setEvd('group_quantities');
run(`_evdMode = 'compose'`);
html = run('_evdComposeHtml()');
assert(!html.includes('La tua fascia'), 'gruppo: la fascia non va mostrata');
assert(html.includes('Preferenze menù'), 'gruppo: manca il blocco quantità');
assert(html.includes('Trippa al piatto — \u20ac\u00a07,00'), 'gruppo: prezzo voce menù mancante o non formattato');
assert(html.includes('Fagioli — \u20ac\u00a03,00'), 'gruppo: prezzo voce menù mancante o non formattato');
assert.strictEqual((html.match(/qty-btn" disabled/g) || []).length, 2, 'gruppo: "−" va disabilitato a 0');
assert.strictEqual(run('_evdTiersHtml()'), '', 'gruppo: la lista fasce va nascosta');

// 3. contatori: incremento, decremento, mai sotto zero
run(`evdQty('t1', 1); evdQty('t1', 1); evdQty('t2', -1);`);
assert.strictEqual(run('_evdQty.t1'), 2, 'incremento errato');
assert.strictEqual(run('_evdQty.t2'), 0, 'il minimo è 0');

// 4. accompagnatori senza fascia: validazione passa e tier_id non viene inviato
run(`_evdRows = [{key:'p1', nome:'Anna', cognome:'Rossi', tier_id:''}]`);
assert.deepStrictEqual(JSON.parse(run('JSON.stringify(_evdCollectCompanions())')),
  [{nome: 'Anna', cognome: 'Rossi'}], 'gruppo: companion senza fascia');
setEvd('per_person');
run(`_evdRows = [{key:'p1', nome:'Anna', cognome:'Rossi', tier_id:''}]`);
assert.strictEqual(run('_evdCollectCompanions()'), null, 'per_person: la fascia resta obbligatoria');

// 5. riepilogo nel pannello iscritti: solo le voci con quantità > 0
setEvd('group_quantities', {ok: true, registered: true, registration: {id: 'r1'}, companions: []});
run(`_evd.prefs = {t1: 3, t2: 0}`);
const panel = run('_evdPrefsPanelHtml()');
assert(panel.includes('Trippa al piatto — \u20ac\u00a07,00'), 'riepilogo: prezzo voce mancante');
assert(panel.includes('>×3<'), 'riepilogo: quantità mancante');
assert(!panel.includes('Fagioli'), 'riepilogo: le voci a 0 non si mostrano');
assert(panel.includes('Modifica preferenze menù'), 'riepilogo: manca il pulsante di modifica');

// 6. le preferenze salvate pre-popolano i contatori della modifica
run('evdStartMenuPrefs()');
assert.deepStrictEqual(JSON.parse(run('JSON.stringify(_evdQty)')), {t1: 3, t2: 0},
  'modifica: contatori non pre-popolati');

console.log('OK — 7 controlli passati');
