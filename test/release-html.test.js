/** Verificações estáticas do HTML/versão (disclaimer, campos novos, versão 1.15.0 consistente). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const html = read('index.html');

test('versão 1.15.0 no HTML, no espelho e no cache do service worker', () => {
  assert.match(html, /data-vault-version="1\.15\.4"/);
  assert.match(read('cambio-app.html'), /data-vault-version="1\.15\.4"/);
  assert.match(read('sw.js'), /cambio-app-v1\.15\.4/);
});

test('cambio-app.html continua espelho de index.html', () => {
  assert.equal(read('cambio-app.html'), html);
});

test('disclaimer ampliado no rodapé', () => {
  const footer = html.slice(html.indexOf('<footer>'));
  assert.match(footer, /não são oferta nem orientação tributária/);
  assert.match(footer, /VET vinculante é o que a instituição informa/);
  assert.match(footer, /Decreto 12\.499\/2025 \(verificado em 30\/09\/2026\)/);
  assert.match(footer, /criptoativos, remessas a terceiros ou\s+investimento/);
  assert.match(footer, /contador ou tributarista/);
});

test('modal VET: tarifas, opção 0,38%, aviso de estimativa e Res. BCB 277/2022 sem artigo', () => {
  assert.match(html, /id="vet-fee-fixed"/);
  assert.match(html, /id="vet-fee-pct"/);
  assert.match(html, /<option value="ingresso_recursos">[^<]*0,38%/);
  assert.match(html, /não é norma/);
  assert.match(html, /Res\. BCB 277\/2022/);
  assert.doesNotMatch(html, /277\/2022[^<]{0,20}art/i);
  assert.match(html, /não é oferta nem orientação tributária/);
  assert.match(html, /id="vet-warnings"/);
  assert.match(html, /id="vet-error"/);
});

test('todas as modalidades do select existem na tabela de IOF', () => {
  const E = require('../src/js/cambio-engine.js');
  const values = [...html.matchAll(/<option value="([a-z_]+)">/g)].map((m) => m[1]);
  assert.ok(values.length >= 7);
  for (const v of values) assert.ok(E.IOF_RATES[v] !== undefined, v);
});
