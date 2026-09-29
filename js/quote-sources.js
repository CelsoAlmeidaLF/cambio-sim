/**
 * quote-sources.js - Fontes reserva de cotação, usadas quando a AwesomeAPI falha.
 * Devolvem os dados no mesmo formato da AwesomeAPI para passar pela mesma validação.
 *   Cotação atual: currency-api (jsDelivr, diária) + Binance (BTC em tempo real).
 *   Histórico: Frankfurter/BCE (USD, EUR, GBP, CAD) e Binance (BTC). ARS não tem histórico reserva.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteSources = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CURRENCY_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@';
  var FRANKFURTER = 'https://api.frankfurter.dev/v1/';
  var BINANCE = 'https://api.binance.com/api/v3/';
  var ECB_CODES = ['USD', 'EUR', 'GBP', 'CAD'];
  var DAY = 86400000;

  function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
  // Cotações diárias sem horário: fixa em 12:00 UTC do dia informado.
  function dayTimestamp(date) { return Math.floor(Date.parse(date + 'T12:00:00Z') / 1000); }
  function rate(n) { return Number.isFinite(n) && n > 0 ? n : null; }

  function quote(code, bid, ask, high, low, pctChange, timestamp) {
    return {
      code: code, codein: 'BRL', name: code + '/BRL (fonte reserva)',
      bid: String(bid), ask: String(ask), high: String(high), low: String(low),
      pctChange: String(pctChange), timestamp: String(timestamp)
    };
  }

  // currency-api: valores em "1 BRL = x moeda"; inverte para "1 moeda = x BRL".
  async function currencyApiDay(getJson, tag) {
    var data = await getJson(CURRENCY_API + tag + '/v1/currencies/brl.min.json');
    if (!data || !data.brl || typeof data.date !== 'string') throw new Error('Resposta inválida da currency-api');
    return data;
  }

  async function fetchLast(getJson, codes, now) {
    now = now || Date.now();
    var out = {};
    var latest = await currencyApiDay(getJson, 'latest').catch(function () { return null; });
    var previous = latest ? await currencyApiDay(getJson, isoDate(Date.parse(latest.date + 'T12:00:00Z') - DAY)).catch(function () { return null; }) : null;
    if (latest) {
      codes.forEach(function (code) {
        var today = rate(1 / latest.brl[code.toLowerCase()]);
        if (!today) return;
        var before = previous ? rate(1 / previous.brl[code.toLowerCase()]) : null;
        var pct = before ? ((today / before) - 1) * 100 : 0;
        out[code + 'BRL'] = quote(code, today, today, Math.max(today, before || today), Math.min(today, before || today), pct, dayTimestamp(latest.date));
      });
    }
    if (codes.indexOf('BTC') !== -1) {
      try {
        var t = await getJson(BINANCE + 'ticker/24hr?symbol=BTCBRL');
        var bid = rate(parseFloat(t.bidPrice)), ask = rate(parseFloat(t.askPrice));
        if (bid && ask) {
          out.BTCBRL = quote('BTC', bid, ask, parseFloat(t.highPrice), parseFloat(t.lowPrice), parseFloat(t.priceChangePercent),
            Math.floor((Number(t.closeTime) || now) / 1000));
        }
      } catch (e) { /* mantém o valor da currency-api, se houver */ }
    }
    if (!Object.keys(out).length) throw new Error('Nenhuma fonte reserva respondeu');
    return out;
  }

  // Histórico no formato da AwesomeAPI /json/daily: lista do mais recente para o mais antigo.
  async function fetchDaily(getJson, code, days, now) {
    now = now || Date.now();
    if (code === 'BTC') {
      var klines = await getJson(BINANCE + 'klines?symbol=BTCBRL&interval=1d&limit=' + Math.min(days, 1000));
      if (!Array.isArray(klines)) throw new Error('Resposta inválida da Binance');
      return klines.map(function (k) { return { bid: String(k[4]), timestamp: String(Math.floor(k[0] / 1000)) }; }).reverse();
    }
    if (ECB_CODES.indexOf(code) === -1) throw new Error('Sem histórico reserva para ' + code);
    var data = await getJson(FRANKFURTER + isoDate(now - days * DAY) + '..?base=' + code + '&symbols=BRL');
    if (!data || !data.rates) throw new Error('Resposta inválida da Frankfurter');
    return Object.keys(data.rates).sort().map(function (date) {
      return { bid: String(data.rates[date].BRL), timestamp: String(dayTimestamp(date)) };
    }).filter(function (d) { return rate(parseFloat(d.bid)); }).reverse();
  }

  return { fetchLast: fetchLast, fetchDaily: fetchDaily };
}));
