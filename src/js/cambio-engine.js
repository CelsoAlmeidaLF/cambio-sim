/**
 * cambio-engine.js - Motor Financeiro e Regras de Negócio do Câmbio
 * Funcionalidades:
 * - Conversão com controle de precisão e arredondamento
 * - Cálculo de VET (Valor Efetivo Total), IOF e Spread Bancário
 * - Validação e sanitização de dados e schemas
 * - Gestão de alertas e detecção de rompimento de limites
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CambioEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IOF_RATES = {
    especie: 0.011, // 1.1% compra de moeda em espécie
    cartao: 0.0438, // 4.38% cartão de crédito / débito internacional
    remessa_mesma_titularidade: 0.011, // 1.1%
    remessa_outra_titularidade: 0.0038, // 0.38%
    nenhum: 0.0
  };

  /**
   * Converte string localizada pt-BR ou número para float numérico seguro
   */
  function parseLocaleNumber(val) {
    if (typeof val === 'number') {
      return Number.isFinite(val) ? val : NaN;
    }
    if (typeof val !== 'string') return NaN;
    var cleaned = val.trim();
    if (!cleaned) return NaN;
    // Remove separadores de milhares e converte vírgula decimal
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    var num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : NaN;
  }

  /**
   * Formata número no padrão brasileiro com casas decimais configuráveis
   */
  function fmtBRL(n, minDecimals, maxDecimals) {
    if (!Number.isFinite(n)) return '—';
    var min = minDecimals !== undefined ? minDecimals : 2;
    var max = maxDecimals !== undefined ? maxDecimals : 4;
    return n.toLocaleString('pt-BR', {
      minimumFractionDigits: min,
      maximumFractionDigits: max
    });
  }

  /**
   * Converte valor entre moeda estrangeira e BRL
   * @param {number} amount - Quantia a converter
   * @param {number} rate - Taxa da moeda (1 moeda estrangeira = X BRL)
   * @param {string} direction - 'FOREIGN_TO_BRL' ou 'BRL_TO_FOREIGN'
   */
  function convert(amount, rate, direction) {
    var amt = Number(amount);
    var r = Number(rate);
    if (!Number.isFinite(amt) || !Number.isFinite(r) || amt < 0 || r <= 0) {
      return NaN;
    }
    if (direction === 'BRL_TO_FOREIGN') {
      return amt / r;
    }
    return amt * r;
  }

  /**
   * Calcula o Valor Efetivo Total (VET) e o custo total de uma compra internacional
   * VET = Taxa Comercial * (1 + Spread%) * (1 + IOF%)
   * @param {Object} options
   * @param {number} options.amountForeign - Quantia em moeda estrangeira desejada
   * @param {number} options.baseRate - Cotação de mercado (ask/venda)
   * @param {number} [options.spreadPercent=1.5] - Margem da corretora/banco (ex: 1.5 para 1.5%)
   * @param {number|string} [options.iofRate='especie'] - Tipo de IOF ou taxa decimal direta
   */
  function calculateVET(options) {
    var opts = options || {};
    var amount = Number(opts.amountForeign);
    var baseRate = Number(opts.baseRate);
    var spreadPct = Number(opts.spreadPercent !== undefined ? opts.spreadPercent : 1.5);

    var iof = 0;
    if (typeof opts.iofRate === 'string' && IOF_RATES[opts.iofRate] !== undefined) {
      iof = IOF_RATES[opts.iofRate];
    } else if (Number.isFinite(Number(opts.iofRate))) {
      iof = Number(opts.iofRate);
    } else {
      iof = IOF_RATES.especie;
    }

    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(baseRate) || baseRate <= 0) {
      return null;
    }

    var spreadMultiplier = 1 + (spreadPct / 100);
    var commercialWithSpread = Math.round(baseRate * spreadMultiplier * 1000000) / 1000000;
    var vetRate = Math.round(commercialWithSpread * (1 + iof) * 1000000) / 1000000;

    var subtotalBrl = Math.round(amount * commercialWithSpread * 100) / 100;
    var spreadBrl = Math.round(amount * (commercialWithSpread - baseRate) * 100) / 100;
    var iofBrl = Math.round(subtotalBrl * iof * 100) / 100;
    var totalBrl = Math.round((subtotalBrl + iofBrl) * 100) / 100;

    return {
      amountForeign: amount,
      baseRate: baseRate,
      spreadPercent: spreadPct,
      iofPercent: iof * 100,
      commercialWithSpread: commercialWithSpread,
      vetRate: vetRate,
      spreadCostBrl: spreadBrl,
      iofCostBrl: iofBrl,
      totalBrl: totalBrl
    };
  }

  /**
   * Validação rigorosa do payload retornado pela API de cotação
   */
  function validateApiQuote(quote) {
    if (!quote || typeof quote !== 'object') return null;
    var bid = parseFloat(quote.bid);
    var ask = parseFloat(quote.ask);
    var pctChange = parseFloat(quote.pctChange);
    var timestamp = parseInt(quote.timestamp, 10);

    if (!Number.isFinite(bid) || bid <= 0) return null;
    if (!Number.isFinite(ask) || ask <= 0) return null;
    if (!Number.isFinite(pctChange)) pctChange = 0;
    if (!Number.isFinite(timestamp) || timestamp <= 0) timestamp = Math.floor(Date.now() / 1000);

    return {
      bid: bid,
      ask: ask,
      pctChange: pctChange,
      timestamp: timestamp,
      name: typeof quote.name === 'string' ? quote.name : '',
      high: Number.isFinite(parseFloat(quote.high)) ? parseFloat(quote.high) : bid,
      low: Number.isFinite(parseFloat(quote.low)) ? parseFloat(quote.low) : bid
    };
  }

  /**
   * Avalia condição de alerta configurada
   * @param {Object} alert - { value: number, dir: 'above'|'below' }
   * @param {number} currentPrice - Preço atual
   */
  function checkAlertCondition(alert, currentPrice) {
    if (!alert || !Number.isFinite(alert.value) || !Number.isFinite(currentPrice)) {
      return false;
    }
    if (alert.dir === 'above') {
      return currentPrice >= alert.value;
    }
    if (alert.dir === 'below') {
      return currentPrice <= alert.value;
    }
    return false;
  }

  /**
   * Validador de schema para logs de conversão do localStorage
   */
  function validateConversionLog(entries) {
    if (!Array.isArray(entries)) return [];
    var safeList = [];
    for (var i = 0; i < entries.length; i++) {
      var item = entries[i];
      if (
        item &&
        typeof item === 'object' &&
        typeof item.from === 'string' &&
        typeof item.to === 'string' &&
        typeof item.inputStr === 'string' &&
        typeof item.outputStr === 'string' &&
        Number.isFinite(item.ts)
      ) {
        // Sanitiza strings removendo tags perigosas
        safeList.push({
          from: item.from.replace(/[^\w\s-]/g, '').slice(0, 10),
          to: item.to.replace(/[^\w\s-]/g, '').slice(0, 10),
          inputStr: item.inputStr.replace(/[<>"']/g, '').slice(0, 30),
          outputStr: item.outputStr.replace(/[<>"']/g, '').slice(0, 30),
          ts: item.ts
        });
      }
    }
    return safeList.slice(0, 10);
  }

  /**
   * Validador de schema para alertas
   */
  function validateAlerts(alertsObj) {
    if (!alertsObj || typeof alertsObj !== 'object' || Array.isArray(alertsObj)) {
      return {};
    }
    var clean = {};
    var allowedCurrencies = ['USD', 'EUR', 'BTC', 'GBP', 'CAD', 'ARS'];
    for (var i = 0; i < allowedCurrencies.length; i++) {
      var cur = allowedCurrencies[i];
      var alert = alertsObj[cur];
      if (alert && typeof alert === 'object') {
        var val = Number(alert.value);
        var dir = alert.dir === 'below' ? 'below' : 'above';
        if (Number.isFinite(val) && val > 0) {
          clean[cur] = { value: val, dir: dir };
        }
      }
    }
    return clean;
  }

  /**
   * Criptografia e decifragem de dados sensíveis locais (AES-GCM 256 bits via Web Crypto)
   * Sem necessidade de PIN/senha manual do usuário (chave segura gerada por dispositivo).
   */
  async function encryptData(plainText, key) {
    var cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) {
      throw new Error('Web Cryptography API não suportada');
    }
    var iv = cryptoObj.getRandomValues(new Uint8Array(12));
    var encoded = new TextEncoder().encode(plainText);
    var ciphertext = await cryptoObj.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoded
    );
    return {
      iv: Array.from(iv),
      cipher: Array.from(new Uint8Array(ciphertext))
    };
  }

  async function decryptData(encryptedObj, key) {
    var cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) {
      throw new Error('Web Cryptography API não suportada');
    }
    var iv = new Uint8Array(encryptedObj.iv);
    var cipher = new Uint8Array(encryptedObj.cipher);
    var decrypted = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      cipher
    );
    return new TextDecoder().decode(decrypted);
  }

  return {
    IOF_RATES: IOF_RATES,
    parseLocaleNumber: parseLocaleNumber,
    fmtBRL: fmtBRL,
    convert: convert,
    calculateVET: calculateVET,
    validateApiQuote: validateApiQuote,
    checkAlertCondition: checkAlertCondition,
    validateConversionLog: validateConversionLog,
    validateAlerts: validateAlerts,
    encryptData: encryptData,
    decryptData: decryptData
  };
});
