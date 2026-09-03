// Check degli iscritti evento e dell'export CSV.
// Il bug: il titolo evento veniva interpolato dentro onclick="…", e un titolo che
// contiene una virgoletta doppia (es. "Trippa e Lampredotto" & Street Food)
// chiudeva l'attributo a metà, lasciando il pulsante senza handler valido.
// Uso: node scripts/test-event-guests-csv.js
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');

const APP = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

// 1. nessun attributo onclick deve più contenere il titolo dell'evento
const dentroOnclick = /onclick="[^"]*\.title/.exec(src);
assert.strictEqual(dentroOnclick, null,
  'un titolo evento è interpolato in un onclick: una virgoletta doppia lo spezza\n  → ' + (dentroOnclick && dentroOnclick[0]));

// 2. gli attributi che portano il titolo usano _escAttr, che le virgolette le copre
const titoloInAttributo = /data-event-title="\$\{_esc\(/.exec(src);
assert.strictEqual(titoloInAttributo, null, 'data-event-title deve usare _escAttr, non _esc');

const noop = () => {};
const mkEl = () => ({innerHTML: '', textContent: '', value: '', style: {},
                     classList: {add: noop, remove: noop}, addEventListener: noop, appendChild: noop});
const sandbox = {
  console, setTimeout, clearTimeout, JSON, Math, Date, Number, String, Object, Array, Promise,
  navigator: {serviceWorker: {register: () => Promise.resolve()}},
  sessionStorage: {getItem: () => null, setItem: noop},
  localStorage:   {getItem: () => null, setItem: noop, removeItem: noop},
  document: {addEventListener: noop, createElement: mkEl, querySelectorAll: () => [],
             querySelector: () => mkEl(), body: mkEl(), documentElement: mkEl(),
             getElementById: () => mkEl()},
  addEventListener: noop,
  matchMedia: () => ({matches: false, addEventListener: noop}),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const run = expr => vm.runInContext(expr, sandbox);

// 3. _escAttr neutralizza la virgoletta doppia del titolo reale
const titolo = '"Trippa e Lampredotto" & Street Food - 3 settembre 2026';
const attr = run(`_escAttr(${JSON.stringify(titolo)})`);
assert(!attr.includes('"'), 'il titolo non deve contenere virgolette doppie grezze');
assert(attr.includes('&amp;'), 'la e commerciale va escapata');

// 4. preferenze menù in colonna testuale, le quantità a 0 fuori
assert.strictEqual(
  run(`_prefsCsvText([{label:'Trippa al piatto',quantity:2},{label:'Fagioli',quantity:0},{label:'Panino hamburger',quantity:1}])`),
  'Trippa al piatto ×2, Panino hamburger ×1', 'preferenze: formato o filtro errato');
assert.strictEqual(run('_prefsCsvText([])'), '', 'preferenze: vuote devono dare stringa vuota');
assert.strictEqual(run('_prefsCsvText(null)'), '', 'preferenze: null non deve rompere');

// 5. CSV: strumenta la RPC e downloadCSV per ispezionare righe e nome file
run(`
  _csv = null;
  downloadCSV = (rows, filename) => { _csv = {rows, filename}; };
  toast = noop => noop;
  _rpcData = null;
  db = {rpc: () => Promise.resolve({data: _rpcData})};
`);
const ISCRITTI = [
  {tipo: 'socio', card_id: 'SH-010', display_name: 'Niccoló Golini', nome: '', cognome: '',
   amount: 0, payment_status: 'da_saldare', checked_in: false,
   menu_preferences: [{label: 'Trippa al piatto', price: 7, quantity: 2}]},
  {tipo: 'ospite', card_id: '', display_name: '', nome: 'Anna', cognome: 'Verdi',
   amount: 5, payment_status: 'saldato_contanti', checked_in: true, menu_preferences: []},
];
const esporta = (menu_mode) => run(`
  _csv = null;
  _rpcData = {evento: ${JSON.stringify(titolo)}, menu_mode: '${menu_mode}',
              iscritti: ${JSON.stringify(ISCRITTI)}};
  exportEventCSV('e1');`);

(async () => {
  // evento group_quantities: colonna preferenze presente e popolata
  await esporta('group_quantities');
  let csv = JSON.parse(run('JSON.stringify(_csv)'));
  assert(csv, 'CSV non generato');
  assert.deepStrictEqual(Object.keys(csv.rows[0]), ['tipo','tessera','nominativo','telefono','email',
    'importo','stato_pagamento','presenza','operatore','preferenze_menu'], 'colonne CSV inattese');
  assert.strictEqual(csv.rows[0].nominativo, 'Niccoló Golini', 'socio: nominativo da display_name');
  assert.strictEqual(csv.rows[1].nominativo, 'Anna Verdi', 'ospite: nominativo da nome + cognome');
  assert.strictEqual(csv.rows[0].preferenze_menu, 'Trippa al piatto ×2', 'preferenze non riportate');
  assert.strictEqual(csv.rows[1].preferenze_menu, '', 'preferenze assenti = colonna vuota');
  assert.strictEqual(csv.rows[1].presenza, 'Sì', 'presenza errata');
  // il nome file esce dal titolo restituito dalla RPC, senza caratteri strani
  assert(/^iscritti_trippa_e_lampredotto_street_food_3_settembre_2026_\d{4}-\d\d-\d\d\.csv$/.test(csv.filename),
    'nome file inatteso: ' + csv.filename);

  // evento per_person: nessuna colonna in più
  await esporta('per_person');
  csv = JSON.parse(run('JSON.stringify(_csv)'));
  assert(!('preferenze_menu' in csv.rows[0]), 'per_person: non deve comparire la colonna preferenze');
  assert.strictEqual(Object.keys(csv.rows[0]).length, 9, 'per_person: numero colonne cambiato');

  console.log('OK — 5 controlli passati');
})().catch(e => { console.error(e.message); process.exit(1); });
