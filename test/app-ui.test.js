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

async function boot({ tourist = true, fetchImpl, preset = {}, spies = {}, qsaFalha = false, flushFalha = null } = {}) {
  const els = {};
  const initial = {};
  for (const m of html.matchAll(/<input[^>]*id="([^"]+)"[^>]*value="([^"]*)"/g)) initial[m[1]] = m[2];
  const doc = {
    body: { style: {} },
    getElementById(id) { return els[id] || (els[id] = makeEl(id, id === 'vet-iof' ? 'especie' : initial[id])); },
    createElement: () => makeEl('x'), createElementNS: () => makeEl('x'), createDocumentFragment: () => makeEl('frag'),
    querySelectorAll: () => { if (qsaFalha) throw new Error('falha de teste'); return []; }, querySelector: () => null, addEventListener() {}
  };
  const store = Object.assign({}, preset);
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
    console: spies.console || console, setTimeout, clearTimeout, setInterval: () => 0, AbortController, Date, Math, Number, JSON, Promise, Object, Array, String,
    document: doc, fetch: fakeFetch, alert: (m) => { throw new Error(m); },
    FinancIcons: { svg: () => '' }, crypto: require('node:crypto').webcrypto, TextEncoder, TextDecoder,
    localStorage: {}
  };
  ctx.window = ctx;
  ctx.vaultReady = Promise.resolve();
  ctx.lockVault = spies.lockVault || (() => {});
  ctx.vaultSettings = spies.vaultSettings || (() => {});
  ctx.secureStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; }, flush: async () => { if (flushFalha && flushFalha()) throw new Error('QuotaExceededError'); } };
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
  return { $, selectCurrency, tick, store };
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

test('UI histórico: cada registro mostra data e hora no formato dd/mm/aaaa hh:mm', async () => {
  const { $, tick } = await boot();
  $('conv-input').value = '10,00';
  $('conv-input').fire('input');
  $('btn-add-log').fire('click');
  await tick();
  const frag = $('log-list').children.find((c) => c.children && c.children.length);
  const item = frag.children[0];
  const when = item.children[1].children[1];
  assert.equal(when.className, 'when');
  assert.match(when.textContent, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});

// ---------- Dados que não abrem: mensagem na própria tela, sem alert, sem apagar nem sobrescrever ----------
const LOG_KEY = 'cambio_conversions_v3';

test('histórico ilegível: mostra o aviso na tela, sem alert, sem voltar ao PIN e só com mensagem fixa no console', async () => {
  const erros = []; let travou = 0;
  const { $, store } = await boot({ preset: { [LOG_KEY]: '{quebrado' }, spies: { console: { error: (...a) => erros.push(a.join(' ')), log() {}, warn() {} }, lockVault: () => { travou++; } } });
  assert.equal($('data-error').classList.contains('show'), true);
  assert.equal(travou, 0, 'não pode voltar à tela do PIN');
  assert.deepEqual(erros, ['Câmbio: não foi possível abrir o histórico guardado.']);
  assert.equal(store[LOG_KEY], '{quebrado', 'dado guardado intacto');
  assert.ok($('rate-value'), 'o resto do app continua abrindo');
});

test('histórico ilegível: limpar e adicionar não sobrescrevem o que ficou no aparelho', async () => {
  const { $, store } = await boot({ preset: { [LOG_KEY]: '{"nao":"lista"}' } });
  assert.equal($('data-error').classList.contains('show'), true);
  $('clear-log').fire('click');
  $('btn-add-log').fire('click');
  await tick();
  assert.equal(store[LOG_KEY], '{"nao":"lista"}');
});

test('histórico ilegível: o botão Restaurar backup abre as Configurações do cofre', async () => {
  let aberto = 0;
  const { $ } = await boot({ preset: { [LOG_KEY]: 'x' }, spies: { vaultSettings: () => { aberto++; } } });
  $('data-error-restore').fire('click');
  assert.equal(aberto, 1);
});

test('histórico válido: nenhum aviso aparece', async () => {
  const log = JSON.stringify([{ from: 'USD', to: 'BRL', inputStr: '1', outputStr: '5', ts: 1 }]);
  const { $ } = await boot({ preset: { [LOG_KEY]: log } });
  assert.equal($('data-error').classList.contains('show'), false);
});

test('Engine.readConversionLog: válido, JSON quebrado e não-lista', () => {
  const Engine = require('../src/js/cambio-engine.js');
  assert.equal(Engine.readConversionLog('[]').ok, true);
  assert.equal(Engine.readConversionLog('[{"from":"USD","to":"BRL","inputStr":"1","outputStr":"5","ts":1}]').log.length, 1);
  assert.equal(Engine.readConversionLog('{x').ok, false);
  assert.equal(Engine.readConversionLog('{"a":1}').ok, false);
  assert.equal(Engine.readConversionLog('null').ok, false);
});

test('app.js: sem alert nativo, mensagem em português simples no HTML e app.js = Program.js', () => {
  const app = fs.readFileSync(path.join(SRC, 'js', 'app.js'), 'utf8');
  assert.doesNotMatch(app.replace(/alert\('Notificações não são suportadas[^\n]*/, ''), /\balert\(/);
  assert.doesNotMatch(app, /error\.message/);
  assert.match(html, /Não conseguimos abrir seus dados neste aparelho\. Nada foi apagado\. Restaure um backup nas Configurações \(Seus dados\) ou feche e abra o app de novo\./);
  assert.equal(app, fs.readFileSync(path.join(SRC, 'js', 'Program.js'), 'utf8'));
});

// ---------- Correções do QA: salvar sinaliza se gravou; falha genérica não é "dado ilegível" ----------
const adicionar = async ($) => { $('conv-input').value = '10'; $('conv-input').fire('input'); $('btn-add-log').fire('click'); await tick(); };

test('BUG-2: com dados ilegíveis, "Adicionar ao histórico" não adiciona, não confirma e reexibe o aviso', async () => {
  const { $, store } = await boot({ preset: { [LOG_KEY]: '{"nao":"lista"}' } });
  $('data-error').classList.remove('show'); // só o clique pode reexibir
  await adicionar($);
  assert.equal($('log-list').children.length, 0, 'nenhuma entrada na tela');
  assert.doesNotMatch($('btn-add-log').innerHTML, /Adicionado/);
  assert.equal($('data-error').classList.contains('show'), true, 'aviso reexibido');
  assert.equal(store[LOG_KEY], '{"nao":"lista"}');
});

test('adicionar com dados bons continua funcionando (controle)', async () => {
  const { $, store } = await boot();
  await adicionar($);
  assert.equal($('log-list').children.length, 1);
  assert.match($('btn-add-log').innerHTML, /Adicionado ao histórico/);
  assert.equal(JSON.parse(store[LOG_KEY]).length, 1);
});

test('falha de gravação ao adicionar: não confirma, não deixa a entrada na tela e avisa', async () => {
  let falha = false;
  const { $ } = await boot({ flushFalha: () => falha });
  const antes = $('log-list').children.length;
  falha = true;
  await adicionar($);
  assert.equal($('log-list').children.length, antes, 'a entrada não ficou na tela');
  assert.doesNotMatch($('btn-add-log').innerHTML, /Adicionado/);
  assert.equal($('status').textContent, 'Não foi possível salvar no histórico. Tente de novo.');
  assert.equal($('data-error').classList.contains('show'), false, 'não é dado ilegível');
});

test('falha de abertura sem relação com dados: mensagem genérica, sem aviso de dados e sem travar a gravação', async () => {
  const erros = [];
  const log = JSON.stringify([{ from: 'USD', to: 'BRL', inputStr: '1', outputStr: '5', ts: 1 }]);
  const { $, store } = await boot({ qsaFalha: true, preset: { [LOG_KEY]: log }, spies: { console: { error: (...a) => erros.push(a.join(' ')), log() {}, warn() {} } } });
  assert.equal($('app-error').classList.contains('show'), true);
  assert.equal($('data-error').classList.contains('show'), false);
  assert.deepEqual(erros, ['Câmbio: falha ao abrir o aplicativo.']);
  $('clear-log').fire('click');
  assert.equal(store[LOG_KEY], undefined, 'apagar/gravar seguem liberados (o dado estava bom)');
  assert.equal($('data-error').classList.contains('show'), false);
});

test('HTML: mensagem genérica exata e espelho idêntico', () => {
  assert.match(html, /id="app-error"[^>]*>\s*<p>Algo deu errado ao abrir o app\. Feche e abra de novo\.<\/p>/);
  assert.equal(fs.readFileSync(path.join(SRC, 'cambio-app.html'), 'utf8'), html);
});

// ---------- Ressalvas do re-teste: desfazer o setItem e mensagem certa na migração ----------
test('falha de flush: o setItem é desfeito (cofre volta ao que estava) e um flush posterior não persiste a entrada', async () => {
  let falha = false;
  const log = JSON.stringify([{ from: 'USD', to: 'BRL', inputStr: '1', outputStr: '5', ts: 1 }]);
  const { $, store } = await boot({ preset: { [LOG_KEY]: log }, flushFalha: () => falha });
  falha = true;
  await adicionar($);
  assert.equal(store[LOG_KEY], log, 'cofre intacto após a falha');
  falha = false;
  await adicionar($); // próxima gravação boa: persiste 2 itens (o antigo + o novo), nunca o que falhou
  assert.equal(JSON.parse(store[LOG_KEY]).length, 2);
});

test('falha de flush sem histórico anterior: a chave não fica no cofre', async () => {
  let falha = false;
  const { $, store } = await boot({ flushFalha: () => falha });
  falha = true;
  await adicionar($);
  assert.equal(LOG_KEY in store, false);
});

test('migração do histórico antigo: falha ao gravar mostra a mensagem de gravação (não a de dados) e preserva o antigo', async () => {
  const wc = require('node:crypto').webcrypto;
  const key = await wc.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const jwk = JSON.stringify(await wc.subtle.exportKey('jwk', key));
  const iv = wc.getRandomValues(new Uint8Array(12));
  const plain = JSON.stringify([{ from: 'USD', to: 'BRL', inputStr: '1', outputStr: '5', ts: 1 }]);
  const cipher = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const legacy = JSON.stringify({ iv: Array.from(iv), cipher: Array.from(cipher) });
  const preset = { cambio_conversions_enc_v2: legacy, cambio_device_key_v2: jwk };
  const { $, store } = await boot({ preset, flushFalha: () => true });
  assert.equal($('save-error').classList.contains('show'), true);
  assert.equal($('data-error').classList.contains('show'), false);
  assert.equal(store.cambio_conversions_enc_v2, legacy, 'histórico antigo preservado');
  assert.equal(store.cambio_device_key_v2, jwk, 'chave antiga preservada');
  assert.equal(LOG_KEY in store, false, 'nada novo ficou no cofre');
});

test('migração com gravação boa: converte, remove o antigo e não mostra aviso', async () => {
  const wc = require('node:crypto').webcrypto;
  const key = await wc.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = wc.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify([{ from: 'USD', to: 'BRL', inputStr: '1', outputStr: '5', ts: 1 }]))));
  const preset = { cambio_conversions_enc_v2: JSON.stringify({ iv: Array.from(iv), cipher: Array.from(cipher) }), cambio_device_key_v2: JSON.stringify(await wc.subtle.exportKey('jwk', key)) };
  const { $, store } = await boot({ preset });
  assert.equal($('save-error').classList.contains('show'), false);
  assert.equal(JSON.parse(store[LOG_KEY]).length, 1);
  assert.equal('cambio_conversions_enc_v2' in store, false);
});

test('HTML: mensagem de falha de gravação exata', () => {
  assert.match(html, /id="save-error"[^>]*>\s*<p>Não foi possível salvar no histórico\. Tente de novo\. Seus registros antigos continuam guardados\.<\/p>/);
});
