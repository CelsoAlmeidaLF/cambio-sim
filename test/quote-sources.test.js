const test = require('node:test');
const assert = require('node:assert/strict');
const QuoteSources = require('../src/js/quote-sources.js');
const { validateApiQuote } = require('../src/js/cambio-engine.js');

const NOW = Date.parse('2026-09-29T15:00:00Z');
function fakeApi(routes) {
  return async url => {
    const hit = Object.keys(routes).find(k => url.includes(k));
    if (!hit) throw new Error('HTTP 503 ' + url);
    return routes[hit];
  };
}

test('Fonte reserva - cotação atual no formato da AwesomeAPI, com variação e BTC da Binance', async () => {
  const get = fakeApi({
    '@latest/': { date: '2026-09-29', brl: { usd: 1 / 5.2, eur: 1 / 5.9, gbp: 1 / 6.9, cad: 1 / 3.7, ars: 1 / 0.0034, btc: 1 / 430000 } },
    '@2026-09-28/': { date: '2026-09-28', brl: { usd: 1 / 5.1, eur: 1 / 5.9, gbp: 1 / 6.9, cad: 1 / 3.7, ars: 1 / 0.0034, btc: 1 / 420000 } },
    'ticker/24hr': { bidPrice: '434788', askPrice: '435000', highPrice: '440000', lowPrice: '430000', priceChangePercent: '-0.279', closeTime: NOW },
  });
  const out = await QuoteSources.fetchLast(get, ['USD', 'EUR', 'BTC', 'GBP', 'CAD', 'ARS'], NOW);
  for (const key of ['USDBRL', 'EURBRL', 'BTCBRL', 'GBPBRL', 'CADBRL', 'ARSBRL']) assert.ok(validateApiQuote(out[key]), key);
  const usd = validateApiQuote(out.USDBRL);
  assert.ok(Math.abs(usd.bid - 5.2) < 1e-9);
  assert.ok(Math.abs(usd.pctChange - (5.2 / 5.1 - 1) * 100) < 1e-9);
  const btc = validateApiQuote(out.BTCBRL);
  assert.equal(btc.bid, 434788); assert.equal(btc.ask, 435000); assert.equal(btc.pctChange, -0.279);
});

test('Fonte reserva - BTC continua vindo da Binance mesmo com a currency-api fora', async () => {
  const get = fakeApi({ 'ticker/24hr': { bidPrice: '1', askPrice: '2', highPrice: '3', lowPrice: '1', priceChangePercent: '0', closeTime: NOW } });
  const out = await QuoteSources.fetchLast(get, ['USD', 'BTC'], NOW);
  assert.deepEqual(Object.keys(out), ['BTCBRL']);
});

test('Fonte reserva - erro quando nenhuma fonte responde', async () => {
  await assert.rejects(QuoteSources.fetchLast(fakeApi({}), ['USD', 'BTC'], NOW));
});

test('Fonte reserva - histórico BCE e Binance do mais recente para o mais antigo', async () => {
  const fx = await QuoteSources.fetchDaily(fakeApi({ 'frankfurter': { rates: { '2026-09-28': { BRL: 5.18 }, '2026-09-29': { BRL: 5.22 }, '2026-09-26': { BRL: 5.1 } } } }), 'USD', 7, NOW);
  assert.deepEqual(fx.map(d => d.bid), ['5.22', '5.18', '5.1']);
  assert.ok(Number(fx[0].timestamp) > Number(fx[1].timestamp));
  const btc = await QuoteSources.fetchDaily(fakeApi({ 'klines': [[1790467200000, '1', '2', '0', '100'], [1790553600000, '1', '2', '0', '200']] }), 'BTC', 2, NOW);
  assert.deepEqual(btc.map(d => d.bid), ['200', '100']);
  await assert.rejects(QuoteSources.fetchDaily(fakeApi({}), 'ARS', 30, NOW));
});
