/**
 * cambio-engine.js - Motor Financeiro e Regras de Negócio do Câmbio
 * Refatorado para Arquitetura Hexagonal, Orientação a Objetos e Criptografia (CryptoAdapter).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CambioEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ==========================================
  // INFRASTRUCTURE LAYER
  // ==========================================
  class CryptoAdapter {
    static async encryptData(plainText, key) {
      const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (!cryptoObj || !cryptoObj.subtle) throw new Error('Web Cryptography API não suportada');
      const iv = cryptoObj.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plainText);
      const ciphertext = await cryptoObj.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, encoded);
      return { iv: Array.from(iv), cipher: Array.from(new Uint8Array(ciphertext)) };
    }

    static async decryptData(encryptedObj, key) {
      const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (!cryptoObj || !cryptoObj.subtle) throw new Error('Web Cryptography API não suportada');
      const iv = new Uint8Array(encryptedObj.iv);
      const cipher = new Uint8Array(encryptedObj.cipher);
      const decrypted = await cryptoObj.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
      return new TextDecoder().decode(decrypted);
    }
  }

  // ==========================================
  // DOMAIN LAYER (Entities & Value Objects)
  // ==========================================
  class CambioConstants {
    constructor() {
      this._iofRates = {
        especie: 0.035,
        cartao: 0.035,
        remessa_mesma_titularidade: 0.035,
        remessa_outra_titularidade: 0.035,
        remessa_investimento: 0.011,
        ingresso_recursos: 0.0038,
        nenhum: 0.0
      };
      
      this._spreadDefaults = {
        especie: 5.5,
        cartao: 4,
        remessa_mesma_titularidade: 2,
        remessa_outra_titularidade: 2,
        remessa_investimento: 1.5,
        ingresso_recursos: 1.5,
        nenhum: 1.5
      };
      
      this._limits = {
        spreadMax: 20,
        feePercentMax: 20,
        feeFixedMax: 1e7,
        amountMax: 1e12,
        rateMax: 1e9,
        iofMax: 0.1
      };

      this._touristPairs = { USD: 'USD-BRLT', EUR: 'EUR-BRLT' };
      this._plausibleBrl = { USD: [1, 30], EUR: [1, 35], GBP: [1, 40], CAD: [0.5, 25], ARS: [0.0001, 0.5], BTC: [10000, 20000000] };
    }

    get iofRates() { return this._iofRates; }
    get spreadDefaults() { return this._spreadDefaults; }
    get limits() { return this._limits; }
    get touristPairs() { return this._touristPairs; }
    get plausibleBrl() { return this._plausibleBrl; }
  }

  class DecimalMath {
    static get SCALE_DIGITS() { return 12; }
    static get K() { return BigInt('1000000000000'); }
    static get K100() { return this.K * BigInt(100); }
    static get B2() { return BigInt(2); }
    static get B100() { return BigInt(100); }

    static scaled(x) {
      const parts = Math.abs(x).toFixed(this.SCALE_DIGITS).split('.');
      return BigInt(parts[0] + parts[1]);
    }

    static rdiv(n, d) {
      return (n * this.B2 + d) / (this.B2 * d);
    }

    static roundHalfUp(x, decimals = 2) {
      const n = Number(x);
      const d = decimals;
      if (!Number.isFinite(n) || Math.abs(n) >= 1e15 || !(d >= 0 && d <= this.SCALE_DIGITS)) return NaN;
      const div = BigInt('1' + new Array(this.SCALE_DIGITS - d + 1).join('0'));
      const r = this.rdiv(this.scaled(n), div);
      const out = Number(r) / Math.pow(10, d);
      return n < 0 ? -out : out;
    }

    static validPct(v, max) {
      return Number.isFinite(v) && v >= 0 && v <= max;
    }
  }

  class Quote {
    constructor(data) {
      this._bid = parseFloat(data.bid);
      this._ask = parseFloat(data.ask);
      this._pctChange = parseFloat(data.pctChange);
      this._timestamp = parseInt(data.timestamp, 10);
      this._name = typeof data.name === 'string' ? data.name : '';
      this._high = parseFloat(data.high);
      this._low = parseFloat(data.low);
    }

    isValid(plausibleRange) {
      if (!Number.isFinite(this._bid) || this._bid <= 0) return false;
      if (!Number.isFinite(this._ask) || this._ask <= 0) return false;
      if (this._ask < this._bid * 0.5 || this._ask > this._bid * 1.5) return false;
      if (plausibleRange && (this._bid < plausibleRange[0] || this._bid > plausibleRange[1])) return false;
      return true;
    }

    normalize() {
      return {
        bid: this._bid,
        ask: this._ask,
        pctChange: Number.isFinite(this._pctChange) ? this._pctChange : 0,
        timestamp: Number.isFinite(this._timestamp) && this._timestamp > 0 ? this._timestamp : Math.floor(Date.now() / 1000),
        name: this._name,
        high: Number.isFinite(this._high) ? this._high : this._bid,
        low: Number.isFinite(this._low) ? this._low : this._bid
      };
    }
  }

  // ==========================================
  // APPLICATION LAYER (Use Cases)
  // ==========================================
  class CambioService {
    constructor() {
      this._constants = new CambioConstants();
    }

    getDefaultSpreadPercent(mode, opts) {
      if (mode === 'especie' && opts && opts.touristBase) return 0;
      return this._constants.spreadDefaults[mode] !== undefined ? this._constants.spreadDefaults[mode] : 2;
    }

    parseLocaleNumber(val) {
      if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
      if (typeof val !== 'string') return NaN;
      let s = val.trim();
      if (!s) return NaN;
      let sign = 1;
      if (s.charAt(0) === '-') { sign = -1; s = s.slice(1); }
      let cleaned;
      if (/^\d+(,\d+)?$/.test(s)) cleaned = s.replace(',', '.');
      else if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) cleaned = s.replace(/\./g, '').replace(',', '.');
      else if (/^\d+\.\d+$/.test(s)) cleaned = s;
      else if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)) cleaned = s.replace(/,/g, '');
      else return NaN;
      const num = parseFloat(cleaned) * sign;
      return Number.isFinite(num) ? num : NaN;
    }

    fmtBRL(n, minDecimals = 2, maxDecimals = 4) {
      if (!Number.isFinite(n)) return '—';
      return n.toLocaleString('pt-BR', { minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals });
    }

    convert(amount, rate, direction) {
      const amt = Number(amount);
      const r = Number(rate);
      if (!Number.isFinite(amt) || !Number.isFinite(r) || amt < 0 || r <= 0) return NaN;
      return direction === 'BRL_TO_FOREIGN' ? amt / r : amt * r;
    }

    convertQuoted(amount, quote, direction, foreignDecimals = 2) {
      if (!quote) return null;
      const toForeign = direction === 'BRL_TO_FOREIGN';
      const rate = Number(toForeign ? quote.ask : quote.bid);
      const raw = this.convert(amount, rate, direction);
      if (!Number.isFinite(raw)) return null;
      const value = DecimalMath.roundHalfUp(raw, toForeign ? foreignDecimals : 2);
      return { value, rate, side: toForeign ? 'ask' : 'bid' };
    }

    vetAvailability(currency) {
      if (currency === 'BTC') {
        return { ok: false, reason: 'O simulador VET não se aplica ao Bitcoin: a incidência de IOF sobre criptoativos ainda deve ser confirmada com contador/tributarista (Res. BCB 519 a 521/2025). Nenhum valor é calculado para evitar aplicar a alíquota de espécie por engano.' };
      }
      return { ok: true, reason: '' };
    }

    calculateVET(opts) {
      if (!opts) return null;
      if (opts.currency !== undefined && !this.vetAvailability(opts.currency).ok) return null;

      const amount = typeof opts.amountForeign === 'number' ? opts.amountForeign : NaN;
      const baseRate = typeof opts.baseRate === 'number' ? opts.baseRate : NaN;
      const L = this._constants.limits;

      if (!Number.isFinite(amount) || amount <= 0 || amount > L.amountMax) return null;
      if (!Number.isFinite(baseRate) || baseRate <= 0 || baseRate > L.rateMax) return null;

      let iof;
      if (opts.iofRate === undefined) {
        iof = this._constants.iofRates.especie;
      } else if (typeof opts.iofRate === 'string') {
        if (!Object.prototype.hasOwnProperty.call(this._constants.iofRates, opts.iofRate)) return null;
        iof = this._constants.iofRates[opts.iofRate];
      } else if (typeof opts.iofRate === 'number' && Number.isFinite(opts.iofRate) && opts.iofRate >= 0 && opts.iofRate <= L.iofMax) {
        iof = opts.iofRate;
      } else return null;

      let spreadPct;
      if (opts.spreadPercent === undefined) {
        spreadPct = this.getDefaultSpreadPercent(typeof opts.iofRate === 'string' ? opts.iofRate : 'especie');
      } else if (typeof opts.spreadPercent === 'number' && DecimalMath.validPct(opts.spreadPercent, L.spreadMax)) {
        spreadPct = opts.spreadPercent;
      } else return null;

      const feeFixed = opts.feeFixedBrl === undefined ? 0 : opts.feeFixedBrl;
      const feePct = opts.feePercent === undefined ? 0 : opts.feePercent;
      if (typeof feeFixed !== 'number' || !DecimalMath.validPct(feeFixed, L.feeFixedMax)) return null;
      if (typeof feePct !== 'number' || !DecimalMath.validPct(feePct, L.feePercentMax)) return null;

      const a = DecimalMath.scaled(amount), b = DecimalMath.scaled(baseRate);
      const p = DecimalMath.scaled(spreadPct), i = DecimalMath.scaled(iof);
      const fp = DecimalMath.scaled(feePct), f = DecimalMath.scaled(feeFixed);

      const baseCents = DecimalMath.rdiv(a * b * DecimalMath.B100, DecimalMath.K * DecimalMath.K);
      const subtotalCents = DecimalMath.rdiv(a * b * (DecimalMath.K100 + p) * DecimalMath.B100, DecimalMath.K * DecimalMath.K * DecimalMath.K100);
      const spreadCents = subtotalCents - baseCents;
      const iofCents = DecimalMath.rdiv(subtotalCents * i, DecimalMath.K);
      const feeCents = DecimalMath.rdiv(subtotalCents * fp, DecimalMath.K100) + DecimalMath.rdiv(f * DecimalMath.B100, DecimalMath.K);
      const totalCents = subtotalCents + iofCents + feeCents;

      const million = BigInt(1000000);
      const commercialWithSpread = Number(DecimalMath.rdiv(b * (DecimalMath.K100 + p) * million, DecimalMath.K * DecimalMath.K100)) / 1e6;
      const vetDen = DecimalMath.K * DecimalMath.K100 * DecimalMath.K100;
      const vetNum = b * (DecimalMath.K100 + p) * (DecimalMath.K100 + DecimalMath.B100 * i + fp);
      const vetRate = Number(DecimalMath.rdiv((vetNum * a + f * vetDen) * million, vetDen * a)) / 1e6;

      return {
        amountForeign: amount, baseRate, spreadPercent: spreadPct,
        iofPercent: DecimalMath.roundHalfUp(iof * 100, 6),
        commercialWithSpread, vetRate,
        baseBrl: Number(baseCents) / 100,
        spreadCostBrl: Number(spreadCents) / 100,
        subtotalBrl: Number(subtotalCents) / 100,
        iofCostBrl: Number(iofCents) / 100,
        feeCostBrl: Number(feeCents) / 100,
        totalBrl: Number(totalCents) / 100
      };
    }

    getVetWarnings(ctx) {
      const c = ctx || {};
      const out = [];
      const avail = this.vetAvailability(c.currency);
      if (!avail.ok) {
        out.push({ level: 'block', text: avail.reason });
        return out;
      }
      if (this.isFallbackQuote(c.quote)) {
        out.push({ level: 'warn', text: 'Cotação vinda de fonte reserva (média diária, sem separar compra e venda): o câmbio base pode diferir do praticado agora. Confira o VET na instituição.' });
      }
      if (c.mode === 'cartao') {
        out.push({ level: 'warn', text: 'Cartão: a conversão para reais depende da data de fechamento/pagamento da fatura (regra do emissor). A cotação de hoje é apenas uma estimativa.' });
      }
      if (c.mode === 'especie') {
        if (c.touristUsed) out.push({ level: 'info', text: 'Base: cotação turismo (venda) da AwesomeAPI, que já embute a margem de espécie; por isso o spread adicional padrão é 0%.' });
        else if (c.touristMissing) out.push({ level: 'warn', text: 'Cotação turismo indisponível para ' + (c.currency || 'esta moeda') + ': usando a cotação comercial mais o spread padrão de espécie (estimativa).' });
      }
      if (c.mode === 'remessa_investimento') {
        out.push({ level: 'warn', text: 'A alíquota de 1,1% vale para recursos próprios do residente com finalidade de investimento no exterior. A instituição pode exigir declaração da finalidade; fora desse enquadramento, o IOF é 3,5%.' });
      }
      if (c.mode === 'ingresso_recursos') {
        out.push({ level: 'warn', text: 'Ingresso de recursos do exterior (0,38%, inciso XXV): é fluxo de entrada, não compra de moeda. Confirme o enquadramento com a instituição ou contador.' });
      }
      return out;
    }

    isFallbackQuote(quote) {
      return !!quote && typeof quote.name === 'string' && /fonte reserva/i.test(quote.name);
    }

    validateApiQuote(rawQuote, code) {
      if (!rawQuote || typeof rawQuote !== 'object') return null;
      const quote = new Quote(rawQuote);
      const range = code ? this._constants.plausibleBrl[code] : null;
      if (!quote.isValid(range)) return null;
      return quote.normalize();
    }

    validateTouristQuote(raw, code, commercial) {
      if (!this._constants.touristPairs[code]) return null;
      const q = this.validateApiQuote(raw, code);
      if (!q) return null;
      if (commercial && Number.isFinite(commercial.ask) && commercial.ask > 0) {
        if (q.ask < commercial.ask * 0.98 || q.ask > commercial.ask * 1.3) return null;
      }
      return q;
    }

    checkAlertCondition(alert, currentPrice) {
      if (!alert || !Number.isFinite(alert.value) || !Number.isFinite(currentPrice)) return false;
      if (alert.dir === 'above') return currentPrice >= alert.value;
      if (alert.dir === 'below') return currentPrice <= alert.value;
      return false;
    }

    validateConversionLog(entries) {
      if (!Array.isArray(entries)) return [];
      const safeList = [];
      for (const item of entries) {
        if (item && typeof item === 'object' && typeof item.from === 'string' && typeof item.to === 'string' &&
            typeof item.inputStr === 'string' && typeof item.outputStr === 'string' && Number.isFinite(item.ts)) {
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

    validateAlerts(alertsObj) {
      if (!alertsObj || typeof alertsObj !== 'object' || Array.isArray(alertsObj)) return {};
      const clean = {};
      const allowedCurrencies = ['USD', 'EUR', 'BTC', 'GBP', 'CAD', 'ARS'];
      for (const cur of allowedCurrencies) {
        const alert = alertsObj[cur];
        if (alert && typeof alert === 'object') {
          const val = Number(alert.value);
          const dir = alert.dir === 'below' ? 'below' : 'above';
          if (Number.isFinite(val) && val > 0) clean[cur] = { value: val, dir };
        }
      }
      return clean;
    }
  }

  // ==========================================
  // ADAPTER EXPORT (Mantendo assinatura legada)
  // ==========================================
  const service = new CambioService();
  const constants = service._constants;

  return {
    IOF_RATES: constants.iofRates,
    SPREAD_DEFAULTS: constants.spreadDefaults,
    LIMITS: constants.limits,
    TOURIST_PAIRS: constants.touristPairs,
    
    defaultSpreadPercent: (mode, opts) => service.getDefaultSpreadPercent(mode, opts),
    roundHalfUp: (x, d) => DecimalMath.roundHalfUp(x, d),
    parseLocaleNumber: val => service.parseLocaleNumber(val),
    fmtBRL: (n, min, max) => service.fmtBRL(n, min, max),
    convert: (amount, rate, dir) => service.convert(amount, rate, dir),
    convertQuoted: (amount, quote, dir, fDec) => service.convertQuoted(amount, quote, dir, fDec),
    vetAvailability: cur => service.vetAvailability(cur),
    calculateVET: opts => service.calculateVET(opts),
    getVetWarnings: ctx => service.getVetWarnings(ctx),
    isFallbackQuote: q => service.isFallbackQuote(q),
    validateApiQuote: (q, c) => service.validateApiQuote(q, c),
    validateTouristQuote: (raw, c, comm) => service.validateTouristQuote(raw, c, comm),
    checkAlertCondition: (alert, price) => service.checkAlertCondition(alert, price),
    validateConversionLog: entries => service.validateConversionLog(entries),
    validateAlerts: alerts => service.validateAlerts(alerts),

    encryptData: CryptoAdapter.encryptData,
    decryptData: CryptoAdapter.decryptData,

    CryptoAdapter,
    CambioService,
    CambioConstants,
    DecimalMath,
    Quote
  };
});
