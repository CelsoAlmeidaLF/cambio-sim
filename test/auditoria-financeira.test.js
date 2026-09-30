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
