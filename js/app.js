/**
 * app.js - Interface, Ciclo de Vida e Manipulação Segura de DOM
 */

(function () {
  'use strict';

  var Engine = window.CambioEngine;
  if (!Engine) {
    console.error('CambioEngine não encontrado.');
    return;
  }

  var CURRENCIES = {
    USD: { pair: 'USD-BRL', key: 'USDBRL', name: 'Dólar Americano', boardLabel: 'DÓLAR COMERCIAL — COMPRA', decimals: 4 },
    EUR: { pair: 'EUR-BRL', key: 'EURBRL', name: 'Euro', boardLabel: 'EURO COMERCIAL — COMPRA', decimals: 4 },
    BTC: { pair: 'BTC-BRL', key: 'BTCBRL', name: 'Bitcoin', boardLabel: 'BITCOIN — COMPRA', decimals: 2 },
    GBP: { pair: 'GBP-BRL', key: 'GBPBRL', name: 'Libra Esterlina', boardLabel: 'LIBRA ESTERLINA — COMPRA', decimals: 4 },
    CAD: { pair: 'CAD-BRL', key: 'CADBRL', name: 'Dólar Canadense', boardLabel: 'DÓLAR CANADENSE — COMPRA', decimals: 4 },
    ARS: { pair: 'ARS-BRL', key: 'ARSBRL', name: 'Peso Argentino', boardLabel: 'PESO ARGENTINO — COMPRA', decimals: 4 }
  };

  var PERIODS = { '7D': 7, '30D': 30, '90D': 90, '1A': 365 };
  var LAST_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL,GBP-BRL,CAD-BRL,ARS-BRL';

  function dailyUrl(pair, days) {
    return 'https://economia.awesomeapi.com.br/json/daily/' + pair + '/' + days;
  }

  var ALERTS_KEY = 'cambio_alerts_v2';
  var LOG_ENC_KEY = 'cambio_conversions_enc_v2';
  var DEVICE_KEY_STORAGE = 'cambio_device_key_v2';

  // ---------- Gerenciamento da Chave Criptográfica do Dispositivo ----------
  var cryptoKey = null;

  async function getOrCreateDeviceKey() {
    if (cryptoKey) return cryptoKey;
    if (!('crypto' in window) || !window.crypto.subtle) {
      return null;
    }
    try {
      var storedJwk = localStorage.getItem(DEVICE_KEY_STORAGE);
      if (storedJwk) {
        cryptoKey = await window.crypto.subtle.importKey(
          'jwk',
          JSON.parse(storedJwk),
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      } else {
        cryptoKey = await window.crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
        var exported = await window.crypto.subtle.exportKey('jwk', cryptoKey);
        localStorage.setItem(DEVICE_KEY_STORAGE, JSON.stringify(exported));
      }
      return cryptoKey;
    } catch (e) {
      console.warn('Erro ao inicializar chave criptográfica local:', e);
      return null;
    }
  }

  var els = {
    currencyTabs: document.getElementById('currency-tabs'),
    rateValue: document.getElementById('rate-value'),
    rateDelta: document.getElementById('rate-delta'),
    alertBadge: document.getElementById('alert-badge'),
    updatedAt: document.getElementById('updated-at'),
    boardLabel: document.getElementById('board-label'),
    pairLabel: document.getElementById('pair-label'),
    bidValue: document.getElementById('bid-value'),
    askValue: document.getElementById('ask-value'),
    statHigh: document.getElementById('stat-high'),
    statLow: document.getElementById('stat-low'),
    statVar: document.getElementById('stat-var'),
    spark: document.getElementById('spark'),
    sparkSkeleton: document.getElementById('spark-skeleton'),
    sparkStart: document.getElementById('spark-start'),
    sparkTooltip: document.getElementById('spark-tooltip'),
    currencyError: document.getElementById('currency-error'),
    refresh: document.getElementById('refresh'),
    status: document.getElementById('status'),
    convInput: document.getElementById('conv-input'),
    convOutput: document.getElementById('conv-output'),
    convInputLabel: document.getElementById('conv-input-label'),
    convOutputLabel: document.getElementById('conv-output-label'),
    convInvert: document.getElementById('conv-invert'),
    btnAddLog: document.getElementById('btn-add-log'),
    per7d: document.getElementById('per-7d'),
    per30d: document.getElementById('per-30d'),
    per90d: document.getElementById('per-90d'),
    per1a: document.getElementById('per-1a'),
    alertCurLabel: document.getElementById('alert-currency-label'),
    alertCurName: document.getElementById('alert-cur-name'),
    alertValue: document.getElementById('alert-value'),
    alertDirAbove: document.getElementById('alert-dir-above'),
    alertDirBelow: document.getElementById('alert-dir-below'),
    alertSave: document.getElementById('alert-save'),
    alertClear: document.getElementById('alert-clear'),
    alertStatus: document.getElementById('alert-status'),
    btnNotifyPerm: document.getElementById('btn-notify-perm'),
    logList: document.getElementById('log-list'),
    clearLog: document.getElementById('clear-log'),
    btnOpenVet: document.getElementById('btn-open-vet'),
    btnOpenAlert: document.getElementById('btn-open-alert'),
    modalVet: document.getElementById('modal-vet'),
    modalAlert: document.getElementById('modal-alert'),
    modalVetTitle: document.getElementById('modal-vet-title'),
    // VET inputs
    vetAmount: document.getElementById('vet-amount'),
    vetSpread: document.getElementById('vet-spread'),
    vetIof: document.getElementById('vet-iof'),
    vetCommercial: document.getElementById('vet-commercial'),
    vetRate: document.getElementById('vet-rate'),
    vetSpreadCost: document.getElementById('vet-spread-cost'),
    vetIofCost: document.getElementById('vet-iof-cost'),
    vetTotal: document.getElementById('vet-total')
  };

  var currentQuote = null;
  var selectedCurrency = 'USD';
  var selectedPeriod = '30D';
  var convDirection = 'FOREIGN_TO_BRL';
  var alertDirDraft = 'above';

  var lastData = {};
  var lastError = {};
  var dailyData = {};
  var dailyError = {};

  var alerts = loadJSON(ALERTS_KEY, {}, Engine.validateAlerts);
  var conversionLog = [];

  async function loadEncryptedLog() {
    try {
      var raw = localStorage.getItem(LOG_ENC_KEY);
      if (!raw) {
        conversionLog = [];
        renderLog();
        return;
      }
      var encryptedObj = JSON.parse(raw);
      var key = await getOrCreateDeviceKey();
      if (!key) {
        conversionLog = [];
        renderLog();
        return;
      }
      var decryptedStr = await Engine.decryptData(encryptedObj, key);
      var parsed = JSON.parse(decryptedStr);
      conversionLog = Engine.validateConversionLog(parsed);
    } catch (e) {
      console.warn('Falha ao decifrar log de conversões:', e);
      conversionLog = [];
    }
    renderLog();
  }

  async function saveEncryptedLog() {
    try {
      var key = await getOrCreateDeviceKey();
      if (!key) return;
      var plainText = JSON.stringify(conversionLog);
      var encryptedObj = await Engine.encryptData(plainText, key);
      localStorage.setItem(LOG_ENC_KEY, JSON.stringify(encryptedObj));
    } catch (e) {
      console.error('Erro ao criptografar e salvar log:', e);
    }
  }

  function loadJSON(key, fallback, validator) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return validator ? validator(parsed) : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function setStatus(msg) {
    if (!msg) {
      els.status.classList.remove('show');
      els.status.textContent = '';
      return;
    }
    els.status.textContent = msg;
    els.status.classList.add('show');
  }

  function setDeltaClass(el, cls) {
    el.classList.remove('pos', 'neg', 'warn');
    el.classList.add(cls);
  }

  // ---------- Notificações Web ----------

  function requestNotificationPermission() {
    if (!('Notification' in window)) {
      alert('Notificações não são suportadas neste navegador.');
      return;
    }
    Notification.requestPermission().then(function (perm) {
      updateNotificationBtnState();
      if (perm === 'granted') {
        new Notification('Câmbio Notificações', {
          body: 'Notificações ativadas com sucesso! Você receberá alertas de preço.',
          icon: 'cambio-icon-192.png'
        });
      }
    });
  }

  function updateNotificationBtnState() {
    if (!els.btnNotifyPerm) return;
    if (!('Notification' in window)) {
      els.btnNotifyPerm.style.display = 'none';
      return;
    }
    if (Notification.permission === 'granted') {
      els.btnNotifyPerm.textContent = '🔔 Notificações ativas';
      els.btnNotifyPerm.disabled = true;
    } else if (Notification.permission === 'denied') {
      els.btnNotifyPerm.textContent = '🔕 Notificações bloqueadas';
      els.btnNotifyPerm.disabled = true;
    } else {
      els.btnNotifyPerm.textContent = '🔔 Ativar notificações push';
      els.btnNotifyPerm.disabled = false;
    }
  }

  function triggerPushAlert(currency, rate, targetVal, dir) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var symbol = dir === 'above' ? '≥' : '≤';
    new Notification('Alerta de Câmbio: ' + currency, {
      body: currency + ' atingiu R$ ' + Engine.fmtBRL(rate) + ' (' + symbol + ' R$ ' + Engine.fmtBRL(targetVal) + ')',
      icon: 'cambio-icon-192.png',
      tag: 'cambio-alert-' + currency
    });
  }

  // ---------- Busca de Dados com Timeout ----------

  async function fetchWithTimeout(url, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms || 8000);
    try {
      var res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async function fetchLast() {
    var codes = Object.keys(CURRENCIES);
    try {
      var res = await fetchWithTimeout(LAST_URL, 8000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var payload = await res.json();
      codes.forEach(function (c) {
        var rawQuote = payload[CURRENCIES[c].key];
        var validated = Engine.validateApiQuote(rawQuote);
        if (validated) {
          lastData[c] = validated;
          lastError[c] = false;
        } else {
          lastError[c] = true;
        }
      });
    } catch (err) {
      codes.forEach(function (c) { lastError[c] = true; });
    }
  }

  async function fetchDaily(cur, period) {
    var days = PERIODS[period];
    try {
      var res = await fetchWithTimeout(dailyUrl(CURRENCIES[cur].pair, days), 9000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var payload = await res.json();
      if (!Array.isArray(payload)) throw new Error('Payload inválido');
      dailyData[cur] = dailyData[cur] || {};
      dailyData[cur][period] = payload;
      dailyError[cur] = dailyError[cur] || {};
      dailyError[cur][period] = false;
    } catch (err) {
      dailyError[cur] = dailyError[cur] || {};
      dailyError[cur][period] = true;
    }
  }

  function ensureDaily(cur, period) {
    if (dailyData[cur] && dailyData[cur][period]) return Promise.resolve();
    return fetchDaily(cur, period);
  }

  // ---------- Renderização Segura ----------

  function setSkeleton(on) {
    [els.rateValue, els.bidValue, els.askValue, els.statHigh, els.statLow, els.statVar].forEach(function (el) {
      el.classList.toggle('skeleton-block', on);
    });
    els.sparkSkeleton.classList.toggle('show', on);
    els.spark.classList.toggle('hide', on);
  }

  function render(cur) {
    if (cur !== selectedCurrency) return;
    var cfg = CURRENCIES[cur];
    var data = lastData[cur];
    var daily = dailyData[cur] && dailyData[cur][selectedPeriod];
    var hasAnyData = !!data;

    els.boardLabel.textContent = cfg.boardLabel;

    if (!hasAnyData) {
      setSkeleton(!lastError[cur]);
      if (lastError[cur]) {
        els.currencyError.textContent = 'Não foi possível carregar a cotação de ' + cur + ' agora.';
        els.currencyError.classList.add('show');
      }
      updateAlertBadge();
      return;
    }

    setSkeleton(false);
    els.currencyError.classList.remove('show');
    if (lastError[cur]) {
      els.currencyError.textContent = 'Última atualização de ' + cur + ' falhou — exibindo dados salvos em cache.';
      els.currencyError.classList.add('show', 'warn-box');
    } else {
      els.currencyError.classList.remove('warn-box');
    }

    currentQuote = data;
    els.rateValue.textContent = Engine.fmtBRL(data.bid, 2, cfg.decimals);
    els.bidValue.textContent = Engine.fmtBRL(data.bid, 2, cfg.decimals);
    els.askValue.textContent = Engine.fmtBRL(data.ask, 2, cfg.decimals);

    var sign = data.pctChange > 0 ? '+' : '';
    if (data.pctChange > 0.001) {
      setDeltaClass(els.rateDelta, 'pos');
      els.rateDelta.textContent = '▲ ' + sign + data.pctChange.toFixed(2) + '%';
    } else if (data.pctChange < -0.001) {
      setDeltaClass(els.rateDelta, 'neg');
      els.rateDelta.textContent = '▼ ' + data.pctChange.toFixed(2) + '%';
    } else {
      setDeltaClass(els.rateDelta, 'warn');
      els.rateDelta.textContent = '· 0,00%';
    }

    var d = new Date(data.timestamp * 1000);
    els.updatedAt.textContent = 'atualizado ' + d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    if (daily && daily.length) {
      renderHistory(cur, daily);
    } else if (dailyError[cur] && dailyError[cur][selectedPeriod]) {
      while (els.spark.firstChild) els.spark.removeChild(els.spark.firstChild);
      els.sparkStart.textContent = '—';
      els.statHigh.textContent = '—';
      els.statLow.textContent = '—';
      els.statVar.textContent = '—';
    }

    updateConversion();
    updateVET();
    updateAlertBadge();
  }

  function renderHistory(cur, list) {
    var cfg = CURRENCIES[cur];
    var ordered = list.slice().reverse();
    var series = ordered.map(function (d) { return parseFloat(d.bid); }).filter(Number.isFinite);
    if (!series.length) return;

    var high = Math.max.apply(null, series);
    var low = Math.min.apply(null, series);
    var varPct = ((series[series.length - 1] - series[0]) / series[0]) * 100;

    els.statHigh.textContent = Engine.fmtBRL(high, 2, cfg.decimals);
    els.statLow.textContent = Engine.fmtBRL(low, 2, cfg.decimals);
    els.statVar.textContent = (varPct >= 0 ? '+' : '') + varPct.toFixed(2) + '%';
    els.statVar.style.color = varPct >= 0 ? 'var(--up)' : 'var(--down)';

    var firstTimestamp = parseInt(ordered[0].timestamp, 10);
    if (Number.isFinite(firstTimestamp)) {
      var firstDate = new Date(firstTimestamp * 1000);
      els.sparkStart.textContent = firstDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }

    drawSparkDOM(series, low, high, ordered);
  }

  /**
   * Renderização SVG usando nós do DOM (evitando innerHTML perigoso)
   */
  function drawSparkDOM(bids, low, high, rawList) {
    while (els.spark.firstChild) {
      els.spark.removeChild(els.spark.firstChild);
    }

    var w = 400, h = 68, pad = 4;
    var range = (high - low) || 1;
    var stepX = (w - pad * 2) / (bids.length - 1 || 1);
    var points = bids.map(function (v, i) {
      return [pad + i * stepX, pad + (1 - (v - low) / range) * (h - pad * 2)];
    });

    var linePathStr = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ',' + p[1].toFixed(2);
    }).join(' ');

    var areaPathStr = linePathStr +
      ' L' + points[points.length - 1][0].toFixed(2) + ',' + h +
      ' L' + points[0][0].toFixed(2) + ',' + h + ' Z';

    var up = bids[bids.length - 1] >= bids[0];
    var strokeColor = up ? '#6FCF97' : '#E08585';

    var svgNS = 'http://www.w3.org/2000/svg';
    var defs = document.createElementNS(svgNS, 'defs');
    var grad = document.createElementNS(svgNS, 'linearGradient');
    grad.setAttribute('id', 'sparkFill');
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');

    var stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', strokeColor);
    stop1.setAttribute('stop-opacity', '0.22');

    var stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', strokeColor);
    stop2.setAttribute('stop-opacity', '0');

    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    els.spark.appendChild(defs);

    var areaPath = document.createElementNS(svgNS, 'path');
    areaPath.setAttribute('d', areaPathStr);
    areaPath.setAttribute('fill', 'url(#sparkFill)');
    areaPath.setAttribute('stroke', 'none');
    els.spark.appendChild(areaPath);

    var linePath = document.createElementNS(svgNS, 'path');
    linePath.setAttribute('d', linePathStr);
    linePath.setAttribute('fill', 'none');
    linePath.setAttribute('stroke', strokeColor);
    linePath.setAttribute('stroke-width', '1.6');
    linePath.setAttribute('stroke-linejoin', 'round');
    linePath.setAttribute('stroke-linecap', 'round');
    els.spark.appendChild(linePath);

    // Adiciona evento de hover/pointer para interatividade no gráfico
    setupSparkInteractivity(points, bids, rawList);
  }

  function setupSparkInteractivity(points, bids, rawList) {
    if (!els.sparkTooltip) return;

    function onPointerMove(e) {
      var rect = els.spark.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var ratio = Math.max(0, Math.min(1, x / rect.width));
      var idx = Math.round(ratio * (bids.length - 1));
      var val = bids[idx];
      var raw = rawList[idx];
      var dateStr = '';
      if (raw && raw.timestamp) {
        var d = new Date(parseInt(raw.timestamp, 10) * 1000);
        dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' · ';
      }
      els.sparkTooltip.textContent = dateStr + 'R$ ' + Engine.fmtBRL(val, 2, CURRENCIES[selectedCurrency].decimals);
      els.sparkTooltip.classList.add('show');
    }

    function onPointerLeave() {
      els.sparkTooltip.classList.remove('show');
    }

    els.spark.onpointermove = onPointerMove;
    els.spark.onpointerleave = onPointerLeave;
  }

  // ---------- Conversor BRL ⇄ Moeda ----------

  function updateConversion() {
    if (!currentQuote) return;
    var input = Engine.parseLocaleNumber(els.convInput.value);
    if (isNaN(input) || input < 0) {
      els.convOutput.value = '—';
      return;
    }
    var cfg = CURRENCIES[selectedCurrency];
    var result = Engine.convert(input, currentQuote.bid, convDirection);
    var outDecimals = convDirection === 'FOREIGN_TO_BRL' ? 4 : cfg.decimals;
    els.convOutput.value = Engine.fmtBRL(result, 2, outDecimals);
  }

  function refreshConverterLabels() {
    if (convDirection === 'FOREIGN_TO_BRL') {
      els.convInputLabel.textContent = selectedCurrency;
      els.convOutputLabel.textContent = 'BRL';
    } else {
      els.convInputLabel.textContent = 'BRL';
      els.convOutputLabel.textContent = selectedCurrency;
    }
  }

  function toggleConvDirection() {
    convDirection = convDirection === 'FOREIGN_TO_BRL' ? 'BRL_TO_FOREIGN' : 'FOREIGN_TO_BRL';
    refreshConverterLabels();
    els.convInput.value = '1,00';
    updateConversion();
  }

  // ---------- Histórico de Conversões Criptografado (+ Add Manual) ----------

  async function handleAddCurrentConversion() {
    if (!currentQuote) return;
    var input = Engine.parseLocaleNumber(els.convInput.value);
    if (isNaN(input) || input <= 0 || els.convOutput.value === '—') return;

    var fromLabel = convDirection === 'FOREIGN_TO_BRL' ? selectedCurrency : 'BRL';
    var toLabel = convDirection === 'FOREIGN_TO_BRL' ? 'BRL' : selectedCurrency;
    var inputStr = Engine.fmtBRL(input, 2, convDirection === 'FOREIGN_TO_BRL' ? CURRENCIES[selectedCurrency].decimals : 4);
    var entry = {
      from: fromLabel,
      to: toLabel,
      inputStr: inputStr,
      outputStr: els.convOutput.value,
      ts: Date.now()
    };

    conversionLog.unshift(entry);
    conversionLog = conversionLog.slice(0, 10);
    await saveEncryptedLog();
    renderLog();

    if (els.btnAddLog) {
      var origText = els.btnAddLog.textContent;
      els.btnAddLog.textContent = '✓ Adicionado ao histórico!';
      els.btnAddLog.disabled = true;
      setTimeout(function () {
        els.btnAddLog.textContent = origText;
        els.btnAddLog.disabled = false;
      }, 1500);
    }
  }

  function renderLog() {
    while (els.logList.firstChild) {
      els.logList.removeChild(els.logList.firstChild);
    }

    if (!conversionLog.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-note';
      empty.textContent = 'Nenhuma conversão salva ainda. Clique em [+ Adicionar ao Histórico].';
      els.logList.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();
    conversionLog.forEach(function (e) {
      var item = document.createElement('div');
      item.className = 'timeline-item-seed';

      var dot = document.createElement('div');
      dot.className = 'timeline-dot-seed';
      item.appendChild(dot);

      var content = document.createElement('div');
      var what = document.createElement('div');
      what.className = 'what';
      what.textContent = e.inputStr + ' ' + e.from + ' = ' + e.outputStr + ' ' + e.to;

      var when = document.createElement('div');
      when.className = 'when';
      var d = new Date(e.ts);
      when.textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      content.appendChild(what);
      content.appendChild(when);
      item.appendChild(content);
      frag.appendChild(item);
    });

    els.logList.appendChild(frag);
  }

  // ---------- Simulador VET (Valor Efetivo Total) ----------

  function updateVET() {
    if (!currentQuote) return;
    var amount = Engine.parseLocaleNumber(els.vetAmount.value) || 1000;
    var spread = Engine.parseLocaleNumber(els.vetSpread.value);
    if (isNaN(spread) || spread < 0) spread = 1.5;
    var iof = els.vetIof.value || 'especie';

    var res = Engine.calculateVET({
      amountForeign: amount,
      baseRate: currentQuote.ask || currentQuote.bid,
      spreadPercent: spread,
      iofRate: iof
    });

    if (!res) return;

    els.vetCommercial.textContent = 'R$ ' + Engine.fmtBRL(res.commercialWithSpread, 2, 4);
    els.vetRate.textContent = 'R$ ' + Engine.fmtBRL(res.vetRate, 2, 4);
    els.vetSpreadCost.textContent = 'R$ ' + Engine.fmtBRL(res.spreadCostBrl, 2, 2);
    els.vetIofCost.textContent = 'R$ ' + Engine.fmtBRL(res.iofCostBrl, 2, 2);
    els.vetTotal.textContent = 'R$ ' + Engine.fmtBRL(res.totalBrl, 2, 2);
  }

  // ---------- Alertas de Cotação ----------

  function loadAlertUI(cur) {
    var a = alerts[cur];
    els.alertCurLabel.textContent = cur;
    els.alertCurName.textContent = cur;
    els.alertValue.value = a ? Engine.fmtBRL(a.value, 2, CURRENCIES[cur].decimals) : '';
    alertDirDraft = a ? a.dir : 'above';
    els.alertDirAbove.classList.toggle('active', alertDirDraft === 'above');
    els.alertDirBelow.classList.toggle('active', alertDirDraft === 'below');
    els.alertStatus.textContent = a ? 'Alerta configurado para ' + cur + '.' : '';
  }

  function saveAlert() {
    var val = Engine.parseLocaleNumber(els.alertValue.value);
    if (isNaN(val) || val <= 0) {
      els.alertStatus.textContent = 'Informe um valor numérico válido.';
      return;
    }
    alerts[selectedCurrency] = { value: val, dir: alertDirDraft };
    saveJSON(ALERTS_KEY, alerts);
    els.alertStatus.textContent = 'Alerta salvo com sucesso!';
    updateAlertBadge();
  }

  function clearAlert() {
    delete alerts[selectedCurrency];
    saveJSON(ALERTS_KEY, alerts);
    els.alertValue.value = '';
    els.alertStatus.textContent = 'Alerta removido.';
    updateAlertBadge();
  }

  function updateAlertBadge() {
    var a = alerts[selectedCurrency];
    var data = lastData[selectedCurrency];
    if (!a || !data) {
      els.alertBadge.classList.remove('show');
      return;
    }
    var hit = Engine.checkAlertCondition(a, data.bid);
    els.alertBadge.classList.toggle('show', hit);
    if (hit) {
      triggerPushAlert(selectedCurrency, data.bid, a.value, a.dir);
    }
  }

  // ---------- Seleção de Moeda e Período ----------

  function setCurrency(cur) {
    if (!CURRENCIES[cur] || cur === selectedCurrency) return;
    selectedCurrency = cur;

    var buttons = els.currencyTabs.querySelectorAll('.tab-btn-seed');
    buttons.forEach(function (btn) {
      var isActive = btn.getAttribute('data-cur') === cur;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });

    els.pairLabel.textContent = cur + ' ⇄ BRL';
    refreshConverterLabels();
    els.convInput.value = '1,00';
    loadAlertUI(cur);
    render(cur);
    ensureDaily(cur, selectedPeriod).then(function () { render(cur); });
  }

  function setPeriod(period) {
    if (period === selectedPeriod) return;
    selectedPeriod = period;
    [['7D', els.per7d], ['30D', els.per30d], ['90D', els.per90d], ['1A', els.per1a]].forEach(function (pair) {
      pair[1].classList.toggle('active', pair[0] === period);
    });
    var haveCached = dailyData[selectedCurrency] && dailyData[selectedCurrency][period];
    if (!haveCached) {
      els.sparkSkeleton.classList.add('show');
      els.spark.classList.add('hide');
    }
    ensureDaily(selectedCurrency, period).then(function () { render(selectedCurrency); });
  }

  // ---------- Carregamento e Auto-Refresh ----------

  async function load(isManualRefresh) {
    setStatus('');
    if (isManualRefresh) {
      els.refresh.disabled = true;
      els.refresh.textContent = 'Atualizando…';
    }
    await fetchLast();
    await fetchDaily(selectedCurrency, selectedPeriod);
    render(selectedCurrency);

    var allFailed = Object.keys(CURRENCIES).every(function (c) { return lastError[c]; });
    if (allFailed) {
      setStatus('Não foi possível obter cotações da rede. Operando com dados offline.');
    }

    // Pré-carrega outras moedas em background de forma controlada
    Object.keys(CURRENCIES).filter(function (c) { return c !== selectedCurrency; }).forEach(function (c) {
      ensureDaily(c, selectedPeriod);
    });

    if (isManualRefresh) {
      els.refresh.disabled = false;
      els.refresh.textContent = 'Atualizar cotação';
    }
  }

  // ---------- Controle de Modais ----------

  function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) {
      document.body.style.overflow = '';
    }
  }

  function initModals() {
    if (els.btnOpenVet) {
      els.btnOpenVet.addEventListener('click', function () {
        updateVET();
        openModal(els.modalVet);
      });
    }
    if (els.btnOpenAlert) {
      els.btnOpenAlert.addEventListener('click', function () {
        loadAlertUI(selectedCurrency);
        openModal(els.modalAlert);
      });
    }

    // Fechar ao clicar no botão '✕'
    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var modalId = btn.getAttribute('data-close');
        closeModal(document.getElementById(modalId));
      });
    });

    // Fechar ao clicar no fundo escuro
    [els.modalVet, els.modalAlert].forEach(function (modal) {
      if (!modal) return;
      modal.addEventListener('click', function (e) {
        if (e.target === modal) {
          closeModal(modal);
        }
      });
    });

    // Fechar com tecla ESC
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeModal(els.modalVet);
        closeModal(els.modalAlert);
      }
    });
  }

  // ---------- Event Listeners ----------

  els.refresh.addEventListener('click', function () { load(true); });
  els.convInput.addEventListener('input', function () { updateConversion(); });
  els.convInvert.addEventListener('click', toggleConvDirection);

  els.currencyTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.tab-btn-seed');
    if (btn && btn.getAttribute('data-cur')) {
      setCurrency(btn.getAttribute('data-cur'));
    }
  });

  els.per7d.addEventListener('click', function () { setPeriod('7D'); });
  els.per30d.addEventListener('click', function () { setPeriod('30D'); });
  els.per90d.addEventListener('click', function () { setPeriod('90D'); });
  els.per1a.addEventListener('click', function () { setPeriod('1A'); });

  els.alertDirAbove.addEventListener('click', function () {
    alertDirDraft = 'above';
    els.alertDirAbove.classList.add('active');
    els.alertDirBelow.classList.remove('active');
  });

  els.alertDirBelow.addEventListener('click', function () {
    alertDirDraft = 'below';
    els.alertDirBelow.classList.add('active');
    els.alertDirAbove.classList.remove('active');
  });

  els.alertSave.addEventListener('click', saveAlert);
  els.alertClear.addEventListener('click', clearAlert);

  if (els.btnNotifyPerm) {
    els.btnNotifyPerm.addEventListener('click', requestNotificationPermission);
  }

  if (els.btnAddLog) {
    els.btnAddLog.addEventListener('click', handleAddCurrentConversion);
  }

  els.clearLog.addEventListener('click', function () {
    conversionLog = [];
    localStorage.removeItem(LOG_ENC_KEY);
    renderLog();
  });

  els.vetAmount.addEventListener('input', updateVET);
  els.vetSpread.addEventListener('input', updateVET);
  els.vetIof.addEventListener('change', updateVET);

  // ---------- Inicialização ----------

  initModals();
  updateNotificationBtnState();
  loadAlertUI(selectedCurrency);
  loadEncryptedLog();
  load(false);
  setInterval(function () { load(false); }, 5 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
