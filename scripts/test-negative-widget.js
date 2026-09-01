// Check del widget "Saldi negativi": carica app.js con stub DOM minimi e verifica
// la tile nei due stati e la lista dei soci in negativo.
// Uso: node scripts/test-negative-widget.js
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

// 1. nessun negativo: tile neutra, non cliccabile
let tile = run('_negTileHtml({negative_count: 0, negative_total: 0})');
assert(tile.includes('kpi-ok'), 'zero: la tile deve essere in stato neutro');
assert(tile.includes('Nessun socio in negativo'), 'zero: testo errato');
assert(!tile.includes('onclick'), 'zero: la tile non deve aprire nulla');
assert(!tile.includes('Totale da recuperare'), 'zero: nessun totale da mostrare');

// 2. con negativi: rossa, cliccabile, totale in valore assoluto
tile = run('_negTileHtml({negative_count: 3, negative_total: -12.5})');
assert(tile.includes('kpi-neg'), 'negativi: la tile deve essere evidenziata');
assert(tile.includes('openNegativeBalances()'), 'negativi: la tile deve essere cliccabile');
assert(tile.includes('>3<'), 'negativi: conteggio errato');
assert(tile.includes('Totale da recuperare: € 12,50'), 'negativi: totale non in valore assoluto');
assert(tile.includes('Soci in negativo'), 'negativi: plurale errato');
assert(run('_negTileHtml({negative_count: 1, negative_total: -3})').includes('Socio in negativo'),
  'negativi: singolare errato');

// 3. lista ordinata dal più negativo, saldi mostrati col segno
const rows = [
  {card_id: 'SH-012', display_name: 'Anna Verdi',   balance: -1.5},
  {card_id: 'SH-045', display_name: 'Mattia Fusai', balance: -3},
  {card_id: 'SH-090', nome: 'Luca', cognome: 'Bini', balance: -8},
];
const html = run(`_negListHtml(${JSON.stringify(rows)})`);
const ordine = ['SH-090', 'SH-045', 'SH-012'].map(c => html.indexOf(c));
assert(ordine[0] < ordine[1] && ordine[1] < ordine[2], 'lista: non ordinata dal più negativo');
assert(html.includes('€ -8,00'), 'lista: saldo non formattato');
assert(html.includes('neg-row-bal'), 'lista: saldo senza la classe rossa');
assert(html.includes('Luca Bini'), 'lista: fallback nome/cognome mancante');
assert(html.includes(`negOpenUser('SH-045')`), 'lista: riga non cliccabile verso la cassa');

// 4. lista vuota
assert(run('_negListHtml([])').includes('Nessun socio in negativo'), 'lista vuota: messaggio mancante');

// 5. click su una riga: precarica la tessera e riusa il lookup admin esistente
run(`_spy = []; adminLookup = () => { _spy.push(document.getElementById('a-lookup').value); };
     negOpenUser('SH-045');`);
assert.deepStrictEqual(JSON.parse(run('JSON.stringify(_spy)')), ['SH-045'],
  'click: la cassa non riceve la tessera giusta');

console.log('OK — 5 controlli passati');
