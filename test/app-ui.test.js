/**
 * Teste de integração da interface (src/js/app.js) com um DOM falso: valida o que o usuário vê
 * no conversor e no simulador VET (achados A4, A5, B14, M6, M9 da auditoria financeira).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function makeEl(id, value) {
  const handlers = {};
  const classes = new Set();
  const el = {
    id, value: value === undefined ? '' : value, textContent: '', innerHTML: '', disabled: false, style: {},
    children: [], attrs: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); return want; },
      contains: (c) => classes.has(c)
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); },
    get firstChild() { return el.children[0] || null; },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); },
    setAttribute(k, v) { el.attrs[k] = v; }, getAttribute(k) { return el.attrs[k]; },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    fire(t, e) { (handlers[t] || []).forEach((fn) => fn(Object.assign({ target: el }, e))); },
    querySelectorAll: () => [], closest: () => null, getBoundingClientRect: () => ({ left: 0, width: 400 })
  };
  return el;
}

async function boot({ tourist = true, fetchImpl } = {}) {
  const els = {};
  const initial = {};
  for (const m of html.matchAll(/<input[^>]*id="([^"]+)"[^>]*value="([^"]*)"/g)) initial[m[1]] = m[2];
  const doc = {
    body: { style: {} },
    getElementById(id) { return els[id] || (els[id] = makeEl(id, id === 'vet-iof' ? 'especie' : initial[id])); },
    createElement: () => makeEl('x'), createElementNS: () => makeEl('x'), createDocumentFragment: () => makeEl('frag'),
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
  };
  const store = {};
  const commercial = (code, bid, ask) => ({ code, codein: 'BRL', name: code + '/BRL', bid: String(bid), ask: String(ask), high: String(ask), low: String(bid), pctChange: '0.1', timestamp: '1790777144' });
  const lastPayload = {
    USDBRL: commercial('USD', 5.18, 5.183), EURBRL: commercial('EUR', 5.84, 5.85), BTCBRL: commercial('BTC', 400000, 400100),
    GBPBRL: commercial('GBP', 6.9, 6.91), CADBRL: commercial('CAD', 3.7, 3.71), ARSBRL: commercial('ARS', 0.0041, 0.0042)
  };
  const touristPayload = {
    USDBRLT: { code: 'USD', codein: 'BRLT', name: 'Dólar Turismo', bid: '5.14438', ask: '5.5469', pctChange: '0', timestamp: '1790777366' },
    EURBRLT: { code: 'EUR', codein: 'BRLT', name: 'Euro Turismo', bid: '5.84175', ask: '6.2991', pctChange: '0', timestamp: '1790774941' }
  };
  const fakeFetch = fetchImpl || (async (url) => {
    let body;
    if (url.includes('BRLT')) { if (!tourist) return { ok: false, status: 500 }; body = touristPayload; }
    else if (url.includes('json/last')) body = lastPayload;
    else body = [{ bid: '5.1', timestamp: '1790000000' }, { bid: '5.2', timestamp: '1790086400' }];
    return { ok: true, status: 200, json: async () => body };
  });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, AbortController, Date, Math, Number, JSON, Promise, Object, Array, String,
    document: doc, fetch: fakeFetch, alert: (m) => { throw new Error(m); },
    FinancIcons: { svg: () => '' },
    localStorage: {}
  };
  ctx.window = ctx;
  ctx.vaultReady = Promise.resolve();
  ctx.lockVault = () => {};
  ctx.secureStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; }, flush: async () => {} };
  vm.createContext(ctx);
  for (const f of ['js/cambio-engine.js', 'js/quote-sources.js', 'js/app.js']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  await tick(60);
  const $ = (id) => doc.getElementById(id);
  const selectCurrency = (cur) => {
    const tabs = $('currency-tabs');
    tabs.fire('click', { target: { closest: () => ({ getAttribute: () => cur }) } });
  };
  return { $, selectCurrency, tick };
}

const warningsText = ($) => $('vet-warnings').children.map((c) => c.textContent).join(' | ');

test('UI conversor (M6): estrangeira->BRL usa compra e BRL->estrangeira usa venda, R$ com 2 casas', async () => {
  const { $ } = await boot();
  $('conv-input').value = '3,333';
  $('conv-input').fire('input');
  assert.equal($('conv-output').value, '17,26'); // 3,333 x 5,18 (bid) = 17,26494
  $('conv-input').value = '1,005';
  $('conv-input').fire('input');
  assert.equal($('conv-output').value, '5,21'); // 5,2059
  $('conv-invert').fire('click');
  $('conv-input').value = '518,30';
  $('conv-input').fire('input');
  assert.equal($('conv-output').value, '100,00'); // 518,30 / 5,183 (ask)
  $('conv-input').value = '5.18';
  $('conv-input').fire('input');
  assert.equal($('conv-output').value, '0,9994'); // ponto decimal (C1): 5,18 / 5,183
  $('conv-input').value = '12abc';
  $('conv-input').fire('input');
  assert.equal($('conv-output').value, '—');
});

test('UI VET (B14): espécie usa a cotação turismo, com spread adicional 0 e aviso', async () => {
  const { $ } = await boot();
  assert.equal($('vet-spread').value, '0,00');
  assert.equal($('vet-base').textContent, 'R$ 5.546,90');
  assert.equal($('vet-iof-cost').textContent, 'R$ 194,14');
  assert.equal($('vet-total').textContent, 'R$ 5.741,04');
  assert.equal($('vet-rate').textContent, 'R$ 5,741');
  assert.match(warningsText($), /turismo/);
  assert.equal($('vet-error').classList.contains('show'), false);
});

test('UI VET (B14): sem turismo, cai no comercial + spread de espécie e avisa', async () => {
  const { $ } = await boot({ tourist: false });
  assert.equal($('vet-spread').value, '5,50');
  assert.equal($('vet-base').textContent, 'R$ 5.183,00');
  assert.match(warningsText($), /turismo indisponível para USD/);
});

test('UI VET (A2/B13): cartão volta ao spread de 4% e avisa sobre a fatura; trocar de modalidade reaplica o padrão', async () => {
  const { $ } = await boot();
  $('vet-iof').value = 'cartao';
  $('vet-iof').fire('change');
  assert.equal($('vet-spread').value, '4,00');
  assert.match(warningsText($), /fechamento\/pagamento da fatura/);
  assert.equal($('vet-base').textContent, 'R$ 5.183,00');
  assert.equal($('vet-total').textContent, 'R$ 5.578,98');
  $('vet-iof').value = 'remessa_investimento';
  $('vet-iof').fire('change');
  assert.equal($('vet-spread').value, '1,50');
  assert.match(warningsText($), /recursos próprios/);
});

test('UI VET (A3): tarifas entram no total', async () => {
  const { $ } = await boot();
  $('vet-iof').value = 'remessa_mesma_titularidade';
  $('vet-iof').fire('change');
  $('vet-spread').value = '0';
  $('vet-spread').fire('input');
  $('vet-amount').value = '1.000,00';
  $('vet-fee-fixed').value = '25';
  $('vet-fee-fixed').fire('input');
  $('vet-fee-pct').value = '1,0';
  $('vet-fee-pct').fire('input');
  // subtotal 5183,00; IOF 181,41 (181,405); tarifas 25 + 51,83
  assert.equal($('vet-iof-cost').textContent, 'R$ 181,41');
  assert.equal($('vet-fee-cost').textContent, 'R$ 76,83');
  assert.equal($('vet-total').textContent, 'R$ 5.441,24');
  assert.equal($('vet-rate').textContent, 'R$ 5,4412');
});

test('UI VET (M9): entradas inválidas mostram erro e não calculam', async () => {
  const { $ } = await boot();
  const errorFor = (id, v) => {
    $(id).value = v;
    $(id).fire('input');
    const shown = $('vet-error').classList.contains('show');
    const total = $('vet-total').textContent;
    const msg = $('vet-error').textContent;
    $(id).value = id === 'vet-amount' ? '1.000,00' : id === 'vet-spread' ? '1,50' : '0';
    $(id).fire('input');
    return { shown, total, msg };
  };
  for (const [id, v] of [['vet-amount', ''], ['vet-amount', '0'], ['vet-amount', 'abc'], ['vet-spread', ''], ['vet-spread', 'abc'], ['vet-spread', '-1'], ['vet-spread', '25'], ['vet-fee-fixed', '-5'], ['vet-fee-pct', '50']]) {
    const r = errorFor(id, v);
    assert.equal(r.shown, true, id + '=' + v);
    assert.equal(r.total, '—', id + '=' + v);
    assert.ok(r.msg.length > 10);
  }
  assert.equal($('vet-error').classList.contains('show'), false);
  assert.notEqual($('vet-total').textContent, '—');
});

test('UI VET (A4): com BTC o simulador fica bloqueado, sem calcular', async () => {
  const { $, selectCurrency, tick } = await boot();
  assert.notEqual($('vet-total').textContent, '—');
  selectCurrency('BTC');
  await tick();
  assert.equal($('vet-total').textContent, '—');
  assert.equal($('vet-rate').textContent, '—');
  assert.equal($('vet-amount').disabled, true);
  assert.equal($('vet-iof').disabled, true);
  assert.match(warningsText($), /Bitcoin.*tributarista/s);
  selectCurrency('EUR');
  await tick();
  assert.equal($('vet-amount').disabled, false);
  assert.notEqual($('vet-total').textContent, '—');
});

test('UI VET (A5): cotação de fonte reserva mostra o aviso dentro do modal VET', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('economia.awesomeapi')) return { ok: false, status: 503 };
    const brl = { usd: 1 / 5.2, eur: 1 / 5.9, gbp: 1 / 6.9, cad: 1 / 3.7, ars: 1 / 0.0034, btc: 1 / 430000 };
    if (url.includes('cdn.jsdelivr')) return { ok: true, status: 200, json: async () => ({ date: '2026-09-29', brl }) };
    if (url.includes('api.binance')) return { ok: true, status: 200, json: async () => ({ bidPrice: '434788', askPrice: '435000', highPrice: '440000', lowPrice: '430000', priceChangePercent: '0', closeTime: Date.now() }) };
    return { ok: false, status: 503 };
  };
  const { $ } = await boot({ fetchImpl });
  $('vet-iof').value = 'remessa_mesma_titularidade';
  $('vet-iof').fire('change');
  assert.match(warningsText($), /fonte reserva/i);
  assert.notEqual($('vet-total').textContent, '—');
});
