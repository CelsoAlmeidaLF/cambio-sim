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

  // Decreto 12.499/2025 (vigente desde 11/06/2025; alíquotas verificadas em 30/09/2026).
  // ESCALA: as alíquotas de IOF são DECIMAIS (0.035 = 3,5%). Já o spread e as tarifas percentuais são em PERCENTUAL (1.5 = 1,5%).
  var IOF_RATES = {
    especie: 0.035, // 3.5% compra de moeda em espécie
    cartao: 0.035, // 3.5% cartão de crédito / débito / pré-pago internacional
    remessa_mesma_titularidade: 0.035, // 3.5% conta própria no exterior (não investimento)
    remessa_outra_titularidade: 0.035, // 3.5% remessa para terceiros
    remessa_investimento: 0.011, // 1.1% recursos próprios do residente, finalidade investimento no exterior
    ingresso_recursos: 0.0038, // 0.38% ingresso de recursos do exterior (inciso XXV) - enquadramento a confirmar
    nenhum: 0.0
  };

  // Spread padrão por modalidade (em %). São ESTIMATIVAS de mercado, não norma: cada instituição define o seu.
  var SPREAD_DEFAULTS = {
    especie: 5.5, // casas de câmbio/bancos: ~5% a 6% sobre o comercial
    cartao: 4, // emissores: ~4% sobre o comercial
    remessa_mesma_titularidade: 2, // conta/remessa: ~1,5% a 2%
    remessa_outra_titularidade: 2,
    remessa_investimento: 1.5,
    ingresso_recursos: 1.5,
    nenhum: 1.5
  };
  var SPREAD_FALLBACK = 2;
  // Se a base já for a cotação turismo (que embute a margem da espécie), o padrão adicional é zero.
  var SPREAD_TOURIST_BASE = 0;

  // Limites de validação (rejeitam entradas absurdas em vez de calcular lixo)
  var LIMITS = {
    spreadMax: 20, // % (spread)
    feePercentMax: 20, // % (tarifa percentual)
    feeFixedMax: 1e7, // R$
    amountMax: 1e12,
    rateMax: 1e9,
    iofMax: 0.1 // decimal (10%)
  };

  /** Spread padrão (%) sugerido para a modalidade. */
  function defaultSpreadPercent(mode, opts) {
    if (mode === 'especie' && opts && opts.touristBase) return SPREAD_TOURIST_BASE;
    return SPREAD_DEFAULTS[mode] !== undefined ? SPREAD_DEFAULTS[mode] : SPREAD_FALLBACK;
  }

  // ---------- Aritmética decimal exata (BigInt) ----------
  var SCALE_DIGITS = 12;
  var K = BigInt('1000000000000'); // 10^12
  var K100 = K * BigInt(100);
  var B2 = BigInt(2);
  var B100 = BigInt(100);

  /** Número finito >= 0 -> BigInt escalado por 10^12 (usa a expansão decimal, não a binária). */
  function scaled(x) {
    var parts = Math.abs(x).toFixed(SCALE_DIGITS).split('.');
    return BigInt(parts[0] + parts[1]);
  }

  /** Divisão inteira arredondando meio para cima (operandos positivos). */
  function rdiv(n, d) {
    return (n * B2 + d) / (B2 * d);
  }

  /**
   * Arredonda para `decimals` casas, meio para cima (half-up, afastando de zero), sem o erro de
   * ponto flutuante de Math.round(x*100)/100 (ex.: 1.005 -> 1.01). Devolve NaN para não finitos.
   */
  function roundHalfUp(x, decimals) {
    var n = Number(x);
    var d = decimals === undefined ? 2 : decimals;
    if (!Number.isFinite(n) || Math.abs(n) >= 1e15 || !(d >= 0 && d <= SCALE_DIGITS)) return NaN;
    var div = BigInt('1' + new Array(SCALE_DIGITS - d + 1).join('0'));
    var r = rdiv(scaled(n), div);
    var out = Number(r) / Math.pow(10, d);
    return n < 0 ? -out : out;
  }

  /**
   * Converte string localizada pt-BR (ou número) para float. Aceita apenas formatos inequívocos:
   *   "5,40" | "1.250,50" | "1250" | "5.40" (ponto decimal, sem vírgula) | "1,234.56" (en-US)
   * O ponto é milhar somente quando segue o padrão ^[1-9]\d{0,2}(\.\d{3})+$ ("1.234" = 1234; "0.500" = 0,5).
   * Qualquer outra coisa ("12abc", "1,2,3", "1e3", "5,") devolve NaN em vez de adivinhar.
   */
  function parseLocaleNumber(val) {
    if (typeof val === 'number') {
      return Number.isFinite(val) ? val : NaN;
    }
    if (typeof val !== 'string') return NaN;
    var s = val.trim();
    if (!s) return NaN;
    var sign = 1;
    if (s.charAt(0) === '-') { sign = -1; s = s.slice(1); }
    var cleaned;
    if (/^\d+(,\d+)?$/.test(s)) {
      cleaned = s.replace(',', '.'); // "5,40" | "1250"
    } else if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) {
      cleaned = s.replace(/\./g, '').replace(',', '.'); // "1.250,50" | "1.234"
    } else if (/^\d+\.\d+$/.test(s)) {
      cleaned = s; // "5.40" | "1000.50": ponto decimal
    } else if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)) {
      cleaned = s.replace(/,/g, ''); // "1,234.56" (en-US)
    } else {
      return NaN;
    }
    var num = parseFloat(cleaned) * sign;
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
   * Converte valor entre moeda estrangeira e BRL (resultado bruto, sem arredondamento)
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
   * Conversão de balcão usando o lado correto da cotação:
   *   FOREIGN_TO_BRL: quem vende a moeda estrangeira recebe a COMPRA (bid) da instituição;
   *   BRL_TO_FOREIGN: quem compra a moeda estrangeira paga a VENDA (ask).
   * Resultado em BRL sai com exatamente 2 casas (half-up); em moeda estrangeira, com `foreignDecimals` (padrão 2).
   * @returns {{value:number, rate:number, side:string}|null}
   */
  function convertQuoted(amount, quote, direction, foreignDecimals) {
    if (!quote) return null;
    var toForeign = direction === 'BRL_TO_FOREIGN';
    var rate = Number(toForeign ? quote.ask : quote.bid);
    var raw = convert(amount, rate, direction);
    if (!Number.isFinite(raw)) return null;
    var value = roundHalfUp(raw, toForeign ? (foreignDecimals === undefined ? 2 : foreignDecimals) : 2);
    return { value: value, rate: rate, side: toForeign ? 'ask' : 'bid' };
  }

  /**
   * Disponibilidade do simulador VET por moeda. Bitcoin fica de fora: o IOF de espécie (3,5%) não se aplica
   * automaticamente a criptoativos (Res. BCB 519 a 521/2025; incidência a confirmar com tributarista).
   */
  function vetAvailability(currency) {
    if (currency === 'BTC') {
      return {
        ok: false,
        reason: 'O simulador VET não se aplica ao Bitcoin: a incidência de IOF sobre criptoativos ainda deve ser confirmada com contador/tributarista (Res. BCB 519 a 521/2025). Nenhum valor é calculado para evitar aplicar a alíquota de espécie por engano.'
      };
    }
    return { ok: true, reason: '' };
  }

  function validPct(v, max) {
    return Number.isFinite(v) && v >= 0 && v <= max;
  }

  /**
   * Calcula o Valor Efetivo Total (VET) e o custo total de uma compra de moeda estrangeira.
   *   Total em R$ = câmbio com spread + IOF + tarifas;  VET = Total em R$ / quantia em moeda estrangeira
   *   (o VET inclui tarifas e tributos - Res. BCB 277/2022).
   * Toda a conta é feita em aritmética decimal exata e só o resultado final é arredondado (half-up, centavos).
   * Os componentes fecham com o total: base + spread + IOF + tarifas = total (spread = subtotal - base arredondada).
   * O IOF incide sobre o valor do câmbio com spread; tarifas ficam fora da base do IOF.
   * Devolve null para qualquer entrada inválida (nada é "corrigido" em silêncio).
   * @param {Object} options
   * @param {number} options.amountForeign - Quantia em moeda estrangeira (> 0)
   * @param {number} options.baseRate - Cotação base de venda/ask (R$ por unidade, > 0)
   * @param {number} [options.spreadPercent] - Margem da instituição em PERCENTUAL, 0 a 20 (ex.: 1.5 = 1,5%). Padrão: por modalidade
   * @param {number|string} [options.iofRate='especie'] - Chave de IOF_RATES ou alíquota em DECIMAL, 0 a 0.1 (ex.: 0.035 = 3,5%; 3.5 é rejeitado)
   * @param {number} [options.feeFixedBrl=0] - Tarifa fixa em R$
   * @param {number} [options.feePercent=0] - Tarifa percentual (%) sobre o valor do câmbio com spread
   * @param {string} [options.currency] - Moeda; 'BTC' devolve null (ver vetAvailability)
   */
  function calculateVET(options) {
    var opts = options || {};
    if (opts.currency !== undefined && !vetAvailability(opts.currency).ok) return null;

    var amount = typeof opts.amountForeign === 'number' ? opts.amountForeign : NaN;
    var baseRate = typeof opts.baseRate === 'number' ? opts.baseRate : NaN;
    if (!Number.isFinite(amount) || amount <= 0 || amount > LIMITS.amountMax) return null;
    if (!Number.isFinite(baseRate) || baseRate <= 0 || baseRate > LIMITS.rateMax) return null;

    var iof;
    if (opts.iofRate === undefined) {
      iof = IOF_RATES.especie;
    } else if (typeof opts.iofRate === 'string') {
      if (!Object.prototype.hasOwnProperty.call(IOF_RATES, opts.iofRate)) return null;
      iof = IOF_RATES[opts.iofRate];
    } else if (typeof opts.iofRate === 'number' && Number.isFinite(opts.iofRate) && opts.iofRate >= 0 && opts.iofRate <= LIMITS.iofMax) {
      iof = opts.iofRate;
    } else {
      return null; // inclui 3.5 (percentual em campo decimal) e negativos
    }

    var spreadPct;
    if (opts.spreadPercent === undefined) {
      spreadPct = defaultSpreadPercent(typeof opts.iofRate === 'string' ? opts.iofRate : 'especie');
    } else if (typeof opts.spreadPercent === 'number' && validPct(opts.spreadPercent, LIMITS.spreadMax)) {
      spreadPct = opts.spreadPercent;
    } else {
      return null;
    }

    var feeFixed = opts.feeFixedBrl === undefined ? 0 : opts.feeFixedBrl;
    var feePct = opts.feePercent === undefined ? 0 : opts.feePercent;
    if (typeof feeFixed !== 'number' || !validPct(feeFixed, LIMITS.feeFixedMax)) return null;
    if (typeof feePct !== 'number' || !validPct(feePct, LIMITS.feePercentMax)) return null;

    var a = scaled(amount), b = scaled(baseRate), p = scaled(spreadPct), i = scaled(iof);
    var fp = scaled(feePct), f = scaled(feeFixed);

    var baseCents = rdiv(a * b * B100, K * K);
    var subtotalCents = rdiv(a * b * (K100 + p) * B100, K * K * K100);
    var spreadCents = subtotalCents - baseCents;
    var iofCents = rdiv(subtotalCents * i, K);
    var feeCents = rdiv(subtotalCents * fp, K100) + rdiv(f * B100, K);
    var totalCents = subtotalCents + iofCents + feeCents;

    // Taxas (6 casas, só para exibição), a partir dos valores exatos
    var million = BigInt(1000000);
    var commercialWithSpread = Number(rdiv(b * (K100 + p) * million, K * K100)) / 1e6;
    var vetDen = K * K100 * K100;
    var vetNum = b * (K100 + p) * (K100 + B100 * i + fp);
    var vetRate = Number(rdiv((vetNum * a + f * vetDen) * million, vetDen * a)) / 1e6;

    return {
      amountForeign: amount,
      baseRate: baseRate,
      spreadPercent: spreadPct,
      iofPercent: roundHalfUp(iof * 100, 6),
      commercialWithSpread: commercialWithSpread,
      vetRate: vetRate,
      baseBrl: Number(baseCents) / 100,
      spreadCostBrl: Number(spreadCents) / 100,
      subtotalBrl: Number(subtotalCents) / 100,
      iofCostBrl: Number(iofCents) / 100,
      feeCostBrl: Number(feeCents) / 100,
      totalBrl: Number(totalCents) / 100
    };
  }

  /**
   * Avisos que a interface deve exibir no simulador VET, conforme o contexto.
   * @param {Object} ctx - { currency, mode (chave de IOF), quote, touristUsed, touristMissing }
   * @returns {Array<{level:string, text:string}>} level: 'block' | 'warn' | 'info'
   */
  function getVetWarnings(ctx) {
    var c = ctx || {};
    var out = [];
    var avail = vetAvailability(c.currency);
    if (!avail.ok) {
      out.push({ level: 'block', text: avail.reason });
      return out;
    }
    if (isFallbackQuote(c.quote)) {
      out.push({ level: 'warn', text: 'Cotação vinda de fonte reserva (média diária, sem separar compra e venda): o câmbio base pode diferir do praticado agora. Confira o VET na instituição.' });
    }
    if (c.mode === 'cartao') {
      out.push({ level: 'warn', text: 'Cartão: a conversão para reais depende da data de fechamento/pagamento da fatura (regra do emissor). A cotação de hoje é apenas uma estimativa.' });
    }
    if (c.mode === 'especie') {
      if (c.touristUsed) {
        out.push({ level: 'info', text: 'Base: cotação turismo (venda) da AwesomeAPI, que já embute a margem de espécie; por isso o spread adicional padrão é 0%.' });
      } else if (c.touristMissing) {
        out.push({ level: 'warn', text: 'Cotação turismo indisponível para ' + (c.currency || 'esta moeda') + ': usando a cotação comercial mais o spread padrão de espécie (estimativa).' });
      }
    }
    if (c.mode === 'remessa_investimento') {
      out.push({ level: 'warn', text: 'A alíquota de 1,1% vale para recursos próprios do residente com finalidade de investimento no exterior. A instituição pode exigir declaração da finalidade; fora desse enquadramento, o IOF é 3,5%.' });
    }
    if (c.mode === 'ingresso_recursos') {
      out.push({ level: 'warn', text: 'Ingresso de recursos do exterior (0,38%, inciso XXV): é fluxo de entrada, não compra de moeda. Confirme o enquadramento com a instituição ou contador.' });
    }
    return out;
  }

  /** Cotação da fonte reserva (currency-api/Binance): sem spread compra/venda confiável. */
  function isFallbackQuote(quote) {
    return !!quote && typeof quote.name === 'string' && /fonte reserva/i.test(quote.name);
  }

  // Faixas plausíveis (R$ por unidade), bem largas: barram cotação adulterada ou quebrada vinda de uma fonte,
  // sem precisar de atualização frequente.
  var PLAUSIBLE_BRL = { USD: [1, 30], EUR: [1, 35], GBP: [1, 40], CAD: [0.5, 25], ARS: [0.0001, 0.5], BTC: [10000, 20000000] };

  /**
   * Validação rigorosa do payload retornado pela API de cotação.
   * Com o código da moeda, também exige valor dentro da faixa plausível.
   */
  function validateApiQuote(quote, code) {
    if (!quote || typeof quote !== 'object') return null;
    var bid = parseFloat(quote.bid);
    var ask = parseFloat(quote.ask);
    var pctChange = parseFloat(quote.pctChange);
    var timestamp = parseInt(quote.timestamp, 10);

    if (!Number.isFinite(bid) || bid <= 0) return null;
    if (!Number.isFinite(ask) || ask <= 0) return null;
    if (ask < bid * 0.5 || ask > bid * 1.5) return null;
    var range = code && PLAUSIBLE_BRL[code];
    if (range && (bid < range[0] || bid > range[1])) return null;
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

  // Cotação turismo da AwesomeAPI (par <MOEDA>-BRLT): só existe para USD e EUR.
  var TOURIST_PAIRS = { USD: 'USD-BRLT', EUR: 'EUR-BRLT' };

  /**
   * Valida a cotação turismo (venda maior que a comercial, mas dentro de uma faixa sã).
   * Devolve a cotação normalizada ou null (o chamador cai no comercial + spread padrão).
   */
  function validateTouristQuote(raw, code, commercial) {
    if (!TOURIST_PAIRS[code]) return null;
    var q = validateApiQuote(raw, code);
    if (!q) return null;
    if (commercial && Number.isFinite(commercial.ask) && commercial.ask > 0) {
      if (q.ask < commercial.ask * 0.98 || q.ask > commercial.ask * 1.3) return null;
    }
    return q;
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
   * Compatibilidade criptográfica para migração do histórico da versão anterior.
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
    SPREAD_DEFAULTS: SPREAD_DEFAULTS,
    LIMITS: LIMITS,
    defaultSpreadPercent: defaultSpreadPercent,
    roundHalfUp: roundHalfUp,
    parseLocaleNumber: parseLocaleNumber,
    convertQuoted: convertQuoted,
    vetAvailability: vetAvailability,
    getVetWarnings: getVetWarnings,
    isFallbackQuote: isFallbackQuote,
    fmtBRL: fmtBRL,
    convert: convert,
    calculateVET: calculateVET,
    validateApiQuote: validateApiQuote,
    TOURIST_PAIRS: TOURIST_PAIRS,
    validateTouristQuote: validateTouristQuote,
    checkAlertCondition: checkAlertCondition,
    validateConversionLog: validateConversionLog,
    validateAlerts: validateAlerts,
    encryptData: encryptData,
    decryptData: decryptData
  };
});
