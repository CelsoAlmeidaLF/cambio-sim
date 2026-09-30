/**
 * Testes das correções da auditoria financeira de 30/09/2026 (docs/auditoria-financeira-2026-09.md).
 * Cada bloco cita o ID do achado.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/js/cambio-engine.js');

const cents = (x) => Math.round(x * 100);

describe('C1 - parseLocaleNumber estrito', () => {
  test('ponto sem vírgula é decimal quando não casa com milhar', () => {
    assert.equal(E.parseLocaleNumber('5.40'), 5.4);
    assert.equal(E.parseLocaleNumber('1000.50'), 1000.5);
    assert.equal(E.parseLocaleNumber('0.500'), 0.5);
    assert.equal(E.parseLocaleNumber('12.5'), 12.5);
  });
  test('ponto de milhar continua sendo milhar', () => {
    assert.equal(E.parseLocaleNumber('1.234'), 1234);
    assert.equal(E.parseLocaleNumber('1.250,50'), 1250.5);
    assert.equal(E.parseLocaleNumber('1.234.567,89'), 1234567.89);
  });
  test('formato en-US inequívoco é aceito', () => {
    assert.equal(E.parseLocaleNumber('1,234.56'), 1234.56);
  });
  test('vírgula decimal e inteiros', () => {
    assert.equal(E.parseLocaleNumber('5,40'), 5.4);
    assert.equal(E.parseLocaleNumber('1000'), 1000);
    assert.equal(E.parseLocaleNumber('-5,5'), -5.5);
  });
  test('lixo é rejeitado (NaN)', () => {
    for (const bad of ['12abc', 'abc', '1,2,3', '1..2', '5,', ',5', '1e3', '1.2.3', '1 000', 'R$ 5', '--1', '', '  ', '1,23.456,7', null, undefined, {}, NaN, Infinity]) {
      assert.ok(Number.isNaN(E.parseLocaleNumber(bad)), 'deveria rejeitar: ' + String(bad));
    }
  });
});

describe('M7 - arredondamento half-up e precisão', () => {
  test('roundHalfUp acerta 1,005 e outros casos que Math.round erra', () => {
    assert.equal(Math.round(1.005 * 100) / 100, 1, 'confirma o defeito do método antigo');
    assert.equal(E.roundHalfUp(1.005, 2), 1.01);
    assert.equal(E.roundHalfUp(2.675, 2), 2.68);
    assert.equal(E.roundHalfUp(1.115, 2), 1.12);
    assert.equal(E.roundHalfUp(0.285, 2), 0.29);
    assert.equal(E.roundHalfUp(-1.005, 2), -1.01);
    assert.equal(E.roundHalfUp(5.4, 2), 5.4);
    assert.ok(Number.isNaN(E.roundHalfUp(NaN)));
    assert.ok(Number.isNaN(E.roundHalfUp(Infinity)));
  });
  test('ARS com quantia grande: 1.000.000 x 0,00412345, spread 1,5%, IOF espécie = 4.331,79', () => {
    const r = E.calculateVET({ amountForeign: 1000000, baseRate: 0.00412345, spreadPercent: 1.5, iofRate: 'especie' });
    assert.equal(r.baseBrl, 4123.45);
    assert.equal(r.subtotalBrl, 4185.3);
    assert.equal(r.iofCostBrl, 146.49);
    assert.equal(r.totalBrl, 4331.79);
  });
  test('meio centavo no IOF sobe (half-up): 100 a 1,005 sem spread, IOF 3,5%', () => {
    const r = E.calculateVET({ amountForeign: 100, baseRate: 1.005, spreadPercent: 0, iofRate: 'especie' });
    assert.equal(r.subtotalBrl, 100.5);
    assert.equal(r.iofCostBrl, 3.52); // 3,5175
  });
});

describe('M8 - parcelas fecham com o total', () => {
  test('3,37 USD a 5,4317 com spread 2,7%: base + spread + IOF + tarifas = total', () => {
    const r = E.calculateVET({ amountForeign: 3.37, baseRate: 5.4317, spreadPercent: 2.7, iofRate: 'especie', feeFixedBrl: 1.99, feePercent: 0.5 });
    assert.equal(cents(r.baseBrl) + cents(r.spreadCostBrl) + cents(r.iofCostBrl) + cents(r.feeCostBrl), cents(r.totalBrl));
    assert.equal(cents(r.spreadCostBrl), cents(r.subtotalBrl) - cents(r.baseBrl));
  });
  test('varredura: as parcelas fecham em todas as combinações', () => {
    const amounts = [0.01, 1, 3.37, 99.99, 1234.56, 1000000];
    const rates = [0.00412345, 1.005, 5.4317, 5.55555, 350000.5];
    const spreads = [0, 0.33, 1.5, 2.7, 5.5, 20];
    const iofs = ['especie', 'remessa_investimento', 'ingresso_recursos', 'nenhum'];
    for (const amountForeign of amounts) for (const baseRate of rates) for (const spreadPercent of spreads) for (const iofRate of iofs) {
      const r = E.calculateVET({ amountForeign, baseRate, spreadPercent, iofRate, feeFixedBrl: 7.77, feePercent: 0.9 });
      assert.equal(cents(r.baseBrl) + cents(r.spreadCostBrl) + cents(r.iofCostBrl) + cents(r.feeCostBrl), cents(r.totalBrl), JSON.stringify({ amountForeign, baseRate, spreadPercent, iofRate }));
      assert.ok(r.spreadCostBrl >= 0);
    }
  });
});

describe('A3 - VET com tarifas', () => {
  test('sem tarifas o VET continua venda x (1+spread) x (1+IOF)', () => {
    const r = E.calculateVET({ amountForeign: 1000, baseRate: 5, spreadPercent: 1.5, iofRate: 'especie' });
    assert.equal(r.vetRate, 5.252625);
    assert.equal(r.feeCostBrl, 0);
  });
  test('tarifa fixa e percentual entram no total e no VET (total / quantia)', () => {
    const r = E.calculateVET({ amountForeign: 1000, baseRate: 5, spreadPercent: 1.5, iofRate: 'especie', feeFixedBrl: 25, feePercent: 1 });
    // subtotal 5075,00; IOF 177,63 (177,625); tarifa = 25 + 50,75
    assert.equal(r.iofCostBrl, 177.63);
    assert.equal(r.feeCostBrl, 75.75);
    assert.equal(r.totalBrl, 5328.38);
    assert.ok(Math.abs(r.vetRate * 1000 - r.totalBrl) < 0.01);
    assert.equal(r.vetRate, 5.328375);
  });
  test('a tarifa fixa pesa mais em quantias pequenas', () => {
    const small = E.calculateVET({ amountForeign: 10, baseRate: 5, spreadPercent: 0, iofRate: 'nenhum', feeFixedBrl: 10 });
    assert.equal(small.totalBrl, 60);
    assert.equal(small.vetRate, 6);
  });
  test('tarifas inválidas devolvem null', () => {
    const base = { amountForeign: 100, baseRate: 5, spreadPercent: 1 };
    assert.equal(E.calculateVET({ ...base, feeFixedBrl: -1 }), null);
    assert.equal(E.calculateVET({ ...base, feePercent: -0.1 }), null);
    assert.equal(E.calculateVET({ ...base, feePercent: 21 }), null);
    assert.equal(E.calculateVET({ ...base, feeFixedBrl: NaN }), null);
  });
});

describe('A2 - spread padrão por modalidade', () => {
  test('espécie > cartão > remessa', () => {
    const d = E.SPREAD_DEFAULTS;
    assert.ok(d.especie >= 5 && d.especie <= 6);
    assert.ok(d.cartao >= 3.5 && d.cartao <= 4.5);
    assert.ok(d.remessa_mesma_titularidade >= 1.5 && d.remessa_mesma_titularidade <= 2);
    assert.ok(d.remessa_outra_titularidade >= 1.5 && d.remessa_outra_titularidade <= 2);
    assert.ok(d.especie > d.cartao && d.cartao > d.remessa_mesma_titularidade);
  });
  test('cada modalidade de IOF tem padrão; espécie com base turismo não soma margem de novo', () => {
    for (const k of Object.keys(E.IOF_RATES)) assert.ok(Number.isFinite(E.defaultSpreadPercent(k)), k);
    assert.equal(E.defaultSpreadPercent('especie', { touristBase: true }), 0);
    assert.equal(E.defaultSpreadPercent('cartao', { touristBase: true }), E.SPREAD_DEFAULTS.cartao);
  });
  test('sem spreadPercent, o motor usa o padrão da modalidade (não mais 1,5% fixo)', () => {
    const r = E.calculateVET({ amountForeign: 100, baseRate: 5, iofRate: 'especie' });
    assert.equal(r.spreadPercent, E.SPREAD_DEFAULTS.especie);
    const c = E.calculateVET({ amountForeign: 100, baseRate: 5, iofRate: 'cartao' });
    assert.equal(c.spreadPercent, E.SPREAD_DEFAULTS.cartao);
  });
});

describe('A4 - VET bloqueado para BTC', () => {
  test('vetAvailability e calculateVET recusam BTC', () => {
    const av = E.vetAvailability('BTC');
    assert.equal(av.ok, false);
    assert.match(av.reason, /tributarista/);
    assert.match(av.reason, /519/);
    assert.equal(E.calculateVET({ currency: 'BTC', amountForeign: 1, baseRate: 400000, spreadPercent: 1, iofRate: 'especie' }), null);
  });
  test('outras moedas seguem liberadas', () => {
    for (const c of ['USD', 'EUR', 'GBP', 'CAD', 'ARS']) {
      assert.equal(E.vetAvailability(c).ok, true);
      assert.ok(E.calculateVET({ currency: c, amountForeign: 1, baseRate: 5, spreadPercent: 1 }));
    }
  });
  test('getVetWarnings devolve aviso bloqueante para BTC', () => {
    const w = E.getVetWarnings({ currency: 'BTC', mode: 'especie' });
    assert.equal(w.length, 1);
    assert.equal(w[0].level, 'block');
  });
});

describe('A5 - aviso de fonte reserva', () => {
  test('isFallbackQuote reconhece a marca da fonte reserva e os avisos aparecem', () => {
    const reserva = E.validateApiQuote({ bid: '5.2', ask: '5.2', name: 'USD/BRL (fonte reserva)', timestamp: '1790000000', pctChange: '0' }, 'USD');
    const normal = E.validateApiQuote({ bid: '5.2', ask: '5.21', name: 'Dólar Americano/Real Brasileiro', timestamp: '1790000000', pctChange: '0' }, 'USD');
    assert.equal(E.isFallbackQuote(reserva), true);
    assert.equal(E.isFallbackQuote(normal), false);
    assert.equal(E.isFallbackQuote(null), false);
    assert.ok(E.getVetWarnings({ currency: 'USD', mode: 'remessa_mesma_titularidade', quote: reserva }).some(w => /fonte reserva/i.test(w.text)));
    assert.ok(!E.getVetWarnings({ currency: 'USD', mode: 'remessa_mesma_titularidade', quote: normal }).some(w => /fonte reserva/i.test(w.text)));
  });
});

describe('M6 - conversor usa o lado certo da cotação', () => {
  const q = { bid: 5.1, ask: 5.3 };
  test('estrangeira -> BRL usa compra (bid), com 2 casas', () => {
    const r = E.convertQuoted(3.333, q, 'FOREIGN_TO_BRL');
    assert.equal(r.side, 'bid');
    assert.equal(r.value, 17); // 3,333 x 5,1 = 16,9983
    assert.equal(E.convertQuoted(1, q, 'FOREIGN_TO_BRL').value, 5.1);
  });
  test('BRL -> estrangeira usa venda (ask)', () => {
    const r = E.convertQuoted(530, q, 'BRL_TO_FOREIGN');
    assert.equal(r.side, 'ask');
    assert.equal(r.value, 100);
  });
  test('resultado em R$ half-up com 2 casas e entradas inválidas', () => {
    assert.equal(E.convertQuoted(1.005, { bid: 1, ask: 1 }, 'FOREIGN_TO_BRL').value, 1.01);
    assert.equal(E.convertQuoted(-1, q, 'FOREIGN_TO_BRL'), null);
    assert.equal(E.convertQuoted(NaN, q, 'FOREIGN_TO_BRL'), null);
    assert.equal(E.convertQuoted(1, null, 'FOREIGN_TO_BRL'), null);
  });
});

describe('M9 - validação de entradas do VET', () => {
  const ok = { amountForeign: 100, baseRate: 5, spreadPercent: 1, iofRate: 'especie' };
  test('quantia inválida devolve null', () => {
    for (const amountForeign of [0, -1, NaN, undefined, null, '100', Infinity, 1e13]) {
      assert.equal(E.calculateVET({ ...ok, amountForeign }), null, String(amountForeign));
    }
  });
  test('cotação inválida devolve null', () => {
    for (const baseRate of [0, -5, NaN, undefined, Infinity]) assert.equal(E.calculateVET({ ...ok, baseRate }), null);
  });
  test('spread NaN, negativo ou acima do limite devolve null (sem custo negativo nem NaN)', () => {
    for (const spreadPercent of [NaN, -1, -0.01, 20.01, 100, Infinity, 'abc', null]) {
      assert.equal(E.calculateVET({ ...ok, spreadPercent }), null, String(spreadPercent));
    }
    assert.ok(E.calculateVET({ ...ok, spreadPercent: 0 }));
    assert.ok(E.calculateVET({ ...ok, spreadPercent: 20 }));
  });
  test('sem opções devolve null', () => {
    assert.equal(E.calculateVET(), null);
    assert.equal(E.calculateVET({}), null);
  });
});

describe('M10 - escala do IOF', () => {
  const ok = { amountForeign: 100, baseRate: 5, spreadPercent: 1 };
  test('alíquota decimal fora de [0, 0,1] é rejeitada (3.5 em vez de 0.035)', () => {
    assert.equal(E.calculateVET({ ...ok, iofRate: 3.5 }), null);
    assert.equal(E.calculateVET({ ...ok, iofRate: -0.01 }), null);
    assert.equal(E.calculateVET({ ...ok, iofRate: 0.11 }), null);
    assert.equal(E.calculateVET({ ...ok, iofRate: NaN }), null);
    assert.equal(E.calculateVET({ ...ok, iofRate: 'inexistente' }), null);
  });
  test('alíquotas decimais válidas continuam aceitas', () => {
    assert.equal(E.calculateVET({ ...ok, iofRate: 0.035 }).iofPercent, 3.5);
    assert.equal(E.calculateVET({ ...ok, iofRate: 0 }).iofCostBrl, 0);
    assert.equal(E.calculateVET({ ...ok, iofRate: 0.1 }).iofPercent, 10);
  });
});

describe('B12 - iofPercent sem ruído de ponto flutuante', () => {
  test('3,5 exato e 1,1 exato', () => {
    assert.equal(0.035 * 100, 3.5000000000000004, 'confirma o defeito original');
    assert.equal(E.calculateVET({ amountForeign: 1, baseRate: 5, spreadPercent: 0, iofRate: 'especie' }).iofPercent, 3.5);
    assert.equal(E.calculateVET({ amountForeign: 1, baseRate: 5, spreadPercent: 0, iofRate: 'remessa_investimento' }).iofPercent, 1.1);
    assert.equal(E.calculateVET({ amountForeign: 1, baseRate: 5, spreadPercent: 0, iofRate: 'ingresso_recursos' }).iofPercent, 0.38);
  });
});

describe('B11 / B13 / B14 - avisos por modalidade', () => {
  const texts = (ctx) => E.getVetWarnings(ctx).map(w => w.text).join(' | ');
  test('B11: investimento 1,1% explica o enquadramento e existe opção 0,38%', () => {
    assert.match(texts({ currency: 'USD', mode: 'remessa_investimento' }), /recursos próprios.*investimento.*declaração/s);
    assert.equal(E.IOF_RATES.ingresso_recursos, 0.0038);
    assert.match(texts({ currency: 'USD', mode: 'ingresso_recursos' }), /0,38%.*XXV/s);
  });
  test('B13: cartão avisa sobre fechamento/pagamento da fatura', () => {
    assert.match(texts({ currency: 'USD', mode: 'cartao' }), /fechamento\/pagamento da fatura/);
    assert.doesNotMatch(texts({ currency: 'USD', mode: 'especie' }), /fatura/);
  });
  test('B14: espécie informa uso da cotação turismo ou o fallback', () => {
    assert.match(texts({ currency: 'USD', mode: 'especie', touristUsed: true }), /turismo/);
    assert.match(texts({ currency: 'GBP', mode: 'especie', touristMissing: true }), /turismo indisponível para GBP/);
    assert.equal(texts({ currency: 'USD', mode: 'remessa_mesma_titularidade' }), '');
  });
});

describe('B14 - validação da cotação turismo', () => {
  const raw = (bid, ask) => ({ bid: String(bid), ask: String(ask), pctChange: '0', timestamp: '1790777366', name: 'Dólar Americano/Real Brasileiro Turismo' });
  const commercial = { ask: 5.183 };
  test('só USD e EUR têm par turismo', () => {
    assert.deepEqual(Object.keys(E.TOURIST_PAIRS).sort(), ['EUR', 'USD']);
    assert.equal(E.TOURIST_PAIRS.USD, 'USD-BRLT');
    assert.equal(E.validateTouristQuote(raw(5.14, 5.54), 'GBP', { ask: 5.5 }), null);
  });
  test('aceita turismo plausível e rejeita fora da faixa em relação ao comercial', () => {
    assert.equal(E.validateTouristQuote(raw(5.14438, 5.5469), 'USD', commercial).ask, 5.5469);
    assert.equal(E.validateTouristQuote(raw(5.14, 9.5), 'USD', commercial), null);
    assert.equal(E.validateTouristQuote(raw(5.14, 4.0), 'USD', commercial), null);
    assert.equal(E.validateTouristQuote({ bid: 'x' }, 'USD', commercial), null);
    assert.equal(E.validateTouristQuote(null, 'USD', commercial), null);
  });
  test('espécie com base turismo usa a venda turismo no VET com spread adicional 0', () => {
    const t = E.validateTouristQuote(raw(5.14438, 5.5469), 'USD', commercial);
    const r = E.calculateVET({ currency: 'USD', amountForeign: 100, baseRate: t.ask, spreadPercent: E.defaultSpreadPercent('especie', { touristBase: true }), iofRate: 'especie' });
    assert.equal(r.subtotalBrl, 554.69);
    assert.equal(r.iofCostBrl, 19.41); // 19,41415
  });
});
