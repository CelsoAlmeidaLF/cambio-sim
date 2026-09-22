const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const CambioEngine = require('../src/js/cambio-engine.js');

describe('CambioEngine - Testes do Motor Financeiro', () => {
  test('parseLocaleNumber deve tratar vírgulas, pontos e entradas inválidas', () => {
    assert.equal(CambioEngine.parseLocaleNumber('5,40'), 5.40);
    assert.equal(CambioEngine.parseLocaleNumber('1.250,50'), 1250.50);
    assert.equal(CambioEngine.parseLocaleNumber('  3,14  '), 3.14);
    assert.equal(CambioEngine.parseLocaleNumber(100.5), 100.5);
    assert.ok(Number.isNaN(CambioEngine.parseLocaleNumber('abc')));
    assert.ok(Number.isNaN(CambioEngine.parseLocaleNumber('')));
    assert.ok(Number.isNaN(CambioEngine.parseLocaleNumber(null)));
  });

  test('fmtBRL deve formatar corretamente moedas no padrão pt-BR', () => {
    const formatted = CambioEngine.fmtBRL(5.421, 2, 4);
    assert.match(formatted, /^5,421/);
    assert.equal(CambioEngine.fmtBRL(NaN), '—');
    assert.equal(CambioEngine.fmtBRL(Infinity), '—');
  });

  test('convert deve converter valores nas duas direções com precisão', () => {
    // 100 USD @ 5.00 BRL = 500 BRL
    const toBrl = CambioEngine.convert(100, 5.0, 'FOREIGN_TO_BRL');
    assert.equal(toBrl, 500);

    // 500 BRL @ 5.00 BRL = 100 USD
    const toForeign = CambioEngine.convert(500, 5.0, 'BRL_TO_FOREIGN');
    assert.equal(toForeign, 100);

    // Entradas inválidas
    assert.ok(Number.isNaN(CambioEngine.convert(-10, 5.0, 'FOREIGN_TO_BRL')));
    assert.ok(Number.isNaN(CambioEngine.convert(100, 0, 'FOREIGN_TO_BRL')));
  });

  test('calculateVET deve computar spread, IOF e VET corretamente', () => {
    // 1000 USD, cotação base 5.00, spread 1.5%, IOF espécie (1.1%)
    const vet = CambioEngine.calculateVET({
      amountForeign: 1000,
      baseRate: 5.0,
      spreadPercent: 1.5,
      iofRate: 'especie'
    });

    assert.ok(vet !== null);
    // 5.00 * 1.015 = 5.075 (cotação com spread)
    assert.equal(vet.commercialWithSpread, 5.075);
    // VET = 5.075 * 1.011 = 5.130825
    assert.equal(vet.vetRate, 5.130825);
    // Subtotal = 1000 * 5.075 = 5075
    // IOF em BRL = 5075 * 0.011 = 55.83 (arredondado a centavos)
    assert.equal(vet.iofCostBrl, 55.83);
    // Custo spread = 1000 * (5.075 - 5.0) = 75
    assert.equal(vet.spreadCostBrl, 75);
    // Total = 5075 + 55.83 = 5130.83
    assert.equal(vet.totalBrl, 5130.83);
  });

  test('checkAlertCondition deve validar limites superiores e inferiores', () => {
    const alertAbove = { value: 5.50, dir: 'above' };
    assert.equal(CambioEngine.checkAlertCondition(alertAbove, 5.51), true);
    assert.equal(CambioEngine.checkAlertCondition(alertAbove, 5.50), true);
    assert.equal(CambioEngine.checkAlertCondition(alertAbove, 5.49), false);

    const alertBelow = { value: 5.00, dir: 'below' };
    assert.equal(CambioEngine.checkAlertCondition(alertBelow, 4.99), true);
    assert.equal(CambioEngine.checkAlertCondition(alertBelow, 5.00), true);
    assert.equal(CambioEngine.checkAlertCondition(alertBelow, 5.01), false);
  });

  test('validateApiQuote deve rejeitar payloads maliciosos ou corrompidos', () => {
    const validQuote = {
      bid: '5.4215',
      ask: '5.4230',
      pctChange: '0.45',
      timestamp: '1720000000',
      name: 'Dólar Americano/Real Brasileiro'
    };
    const parsed = CambioEngine.validateApiQuote(validQuote);
    assert.ok(parsed !== null);
    assert.equal(parsed.bid, 5.4215);
    assert.equal(parsed.ask, 5.4230);
    assert.equal(parsed.pctChange, 0.45);

    // Inválidos
    assert.equal(CambioEngine.validateApiQuote({ bid: 'invalid' }), null);
    assert.equal(CambioEngine.validateApiQuote(null), null);
    assert.equal(CambioEngine.validateApiQuote({ bid: '-5.0', ask: '5.0' }), null);
  });

  test('validateConversionLog deve sanitizar strings e respeitar o limite de histórico', () => {
    const maliciousLog = [
      { from: 'USD<script>', to: 'BRL', inputStr: '100<img src=x>', outputStr: '500', ts: 1720000000 },
      { from: 'EUR', to: 'BRL', inputStr: '50', outputStr: '300', ts: 1720000010 }
    ];
    const validated = CambioEngine.validateConversionLog(maliciousLog);
    assert.equal(validated.length, 2);
    assert.equal(validated[0].from, 'USDscript');
    assert.ok(!validated[0].inputStr.includes('<img'));
  });

  test('validateAlerts deve limpar moedas inválidas e dados corrompidos', () => {
    const rawAlerts = {
      USD: { value: 5.40, dir: 'above' },
      INVALID_COIN: { value: 100, dir: 'above' },
      EUR: { value: 'invalid', dir: 'below' },
      BTC: { value: 350000, dir: 'below' }
    };
    const cleaned = CambioEngine.validateAlerts(rawAlerts);
    assert.ok(cleaned.USD);
    assert.ok(cleaned.BTC);
    assert.ok(!cleaned.INVALID_COIN);
    assert.ok(!cleaned.EUR);
  });

  test('encryptData e decryptData devem cifrar e decifrar dados sensíveis com AES-GCM 256', async () => {
    const rawKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    const secretText = JSON.stringify([{ from: 'USD', to: 'BRL', inputStr: '100,00', outputStr: '540,00', ts: 1720000000 }]);
    const encrypted = await CambioEngine.encryptData(secretText, rawKey);

    assert.ok(encrypted.iv && Array.isArray(encrypted.iv));
    assert.ok(encrypted.cipher && Array.isArray(encrypted.cipher));
    assert.notEqual(JSON.stringify(encrypted), secretText);

    const decrypted = await CambioEngine.decryptData(encrypted, rawKey);
    assert.equal(decrypted, secretText);
  });
});
