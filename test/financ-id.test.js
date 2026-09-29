const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
// Roda tanto em .security/test quanto em <app>/test (o kit fica em <app>/src).
const kit = ['../secure-vault.js', '../src/secure-vault.js'].map(p => path.join(__dirname, p)).find(p => fs.existsSync(p));
const { Vault, protect, recoveryCode } = require(kit);

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

// Cofre no formato das versões até 1.5.4: PIN e código próprios do app.
const enc = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString('base64');
async function legacyVault(storage, appId, pin, values, code = recoveryCode()) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(appId + ':vault-v1:data') }, key, enc.encode(JSON.stringify(values)));
  const recovery = await protectRecovery(b64(raw), code, appId + ':vault-v1:recovery');
  storage.setItem('financ-vault-v1:' + appId, JSON.stringify({ version: 1, appId,
    password: await protect(b64(raw), pin, appId + ':vault-v1:password'), recovery,
    payload: { iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) } }));
  return code;
}
// protect() exige PIN de 6 números; o código de recuperação usa o mesmo formato com outro segredo.
async function protectRecovery(value, secret, context) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, enc.encode(JSON.stringify(value)));
  return { format: 'financ-encrypted-v1', context, iterations: 600000, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
const envelopeOf = (storage, appId) => JSON.parse(storage.getItem('financ-vault-v1:' + appId));

test('primeiro app cria o FINANC ID; o segundo usa o mesmo PIN sem código novo', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim');
  const code = await a.create('123456', { cambio_log: '[1]' });
  assert.match(code, /^[0-9a-f]{8}(-[0-9a-f]{8}){7}$/);
  assert.ok(storage.getItem('financ-id-v1'));
  assert.equal(envelopeOf(storage, 'cambio-sim').password, undefined);

  const b = new Vault(storage, 'taxometro');
  await assert.rejects(b.create('654321'), { name: 'OperationError' });
  assert.equal(await b.create('123456'), null);
  await b.lock();
  await assert.rejects(b.unlock('000000'));
  await b.unlock('123456');
  assert.equal(b.linked, true);
});

test('trocar o PIN num app vale para todos', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); await a.create('123456');
  const b = new Vault(storage, 'gerenc-fin'); await b.create('123456', { livro_caixa_x: 'segredo' }); await b.lock();
  await a.changePin('123456', '999999');
  await assert.rejects(b.unlock('123456'));
  await b.unlock('999999');
  assert.equal(b.getItem('livro_caixa_x'), 'segredo');
});

test('código de recuperação FINANC redefine o PIN de todos e é trocado', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); const code = await a.create('123456'); await a.lock();
  const b = new Vault(storage, 'taxometro'); await b.create('123456'); await b.lock();
  const status = await a.resetPassword(code, '222222');
  assert.notEqual(status.recovery, code);
  await b.unlock('222222');
  await b.lock();
  await assert.rejects(a.resetPassword(code, '333333'), { name: 'OperationError' });
  await a.lock();
  await a.resetPassword(status.recovery, '333333');
});

test('app sem cofre neste aparelho entra pelo código FINANC', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); const code = await a.create('123456');
  const b = new Vault(storage, 'taxometro');
  const status = await b.resetPassword(code, '444444');
  assert.ok(b.linked); assert.ok(status.recovery);
  await a.lock(); await a.unlock('444444');
});

test('migração: primeiro app antigo vira o FINANC ID e mantém os dados', async () => {
  const storage = new MemoryStorage();
  await legacyVault(storage, 'cripito-sim', '123456', { 'cripto-chain:real': 'bloco-secreto' });
  const v = new Vault(storage, 'cripito-sim');
  assert.equal(v.linked, false);
  const status = await v.unlock('123456');
  assert.ok(status.recovery, 'mostra o código novo do FINANC ID');
  assert.equal(v.linked, true);
  assert.equal(v.getItem('cripto-chain:real'), 'bloco-secreto');
  const env = envelopeOf(storage, 'cripito-sim');
  assert.equal(env.password, undefined); assert.equal(env.recovery, undefined);
  assert.doesNotMatch(storage.getItem('financ-vault-v1:cripito-sim'), /bloco-secreto/);
  await v.lock(); await v.unlock('123456');
  assert.equal(v.getItem('cripto-chain:real'), 'bloco-secreto');
});

test('migração: app antigo com o mesmo PIN liga sozinho', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); await a.create('123456');
  await legacyVault(storage, 'gerenc-fin', '123456', { livro_caixa_state: '{"ok":1}' });
  const b = new Vault(storage, 'gerenc-fin');
  assert.deepEqual(await b.unlock('123456'), {});
  assert.equal(b.linked, true);
  assert.equal(b.getItem('livro_caixa_state'), '{"ok":1}');
});

test('migração: PIN antigo diferente, digitando o PIN FINANC primeiro', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); await a.create('123456');
  await legacyVault(storage, 'taxometro', '777777', { tax: 'dado' });
  const b = new Vault(storage, 'taxometro');
  await assert.rejects(b.unlock('000000'), { name: 'OperationError' });
  await assert.rejects(b.unlock('123456'), { code: 'LEGACY_PIN' });
  await assert.rejects(b.unlockLegacy('000000', '123456'), { name: 'OperationError' });
  await b.unlockLegacy('777777', '123456');
  assert.equal(b.linked, true); assert.equal(b.getItem('tax'), 'dado');
  await b.lock();
  await assert.rejects(b.unlock('777777'));
  await b.unlock('123456');
});

test('migração: PIN antigo diferente, digitando o PIN antigo primeiro', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); await a.create('123456');
  await legacyVault(storage, 'taxometro', '777777', { tax: 'dado' });
  const b = new Vault(storage, 'taxometro');
  assert.deepEqual(await b.unlock('777777'), { needsIdentityPin: true });
  assert.equal(b.linked, false); assert.equal(b.getItem('tax'), 'dado');
  await assert.rejects(b.linkWithIdentityPin('777777'), { name: 'OperationError' });
  await b.linkWithIdentityPin('123456');
  assert.equal(b.linked, true);
  await b.lock(); await b.unlock('123456');
  assert.equal(b.getItem('tax'), 'dado');
});

test('migração: código antigo do app redefine o PIN e cria o FINANC ID', async () => {
  const storage = new MemoryStorage();
  const oldCode = await legacyVault(storage, 'cambio-sim', '111111', { cambio_log: 'x' });
  const v = new Vault(storage, 'cambio-sim');
  const status = await v.resetPassword(oldCode, '555555');
  assert.ok(status.recovery); assert.equal(v.linked, true);
  await v.lock(); await v.unlock('555555');
  assert.equal(v.getItem('cambio_log'), 'x');
});

test('certificado único: gravado num app, lido no outro', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cripito-sim'); await a.create('123456');
  const cert = { id: 'certABC', secret: b64(crypto.getRandomValues(new Uint8Array(32))) };
  await a.saveCertificates([cert]);
  assert.doesNotMatch(storage.getItem('financ-id-v1'), new RegExp(cert.secret.replace(/[+/=]/g, '.')));
  const b = new Vault(storage, 'gerenc-fin'); await b.create('123456');
  assert.equal(b.certificates[0].id, 'certABC');
  assert.equal(b.certificates[0].secret, cert.secret);
});

test('sessão da aba reabre o app ligado com acesso ao certificado', async () => {
  const storage = new MemoryStorage();
  const sessionKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const a = new Vault(storage, 'cripito-sim'); a.sessionKey = sessionKey; await a.create('123456', { k: 'v' });
  await a.saveCertificates([{ id: 'c1', secret: b64(crypto.getRandomValues(new Uint8Array(32))) }]);
  const blob = a.session;
  const again = new Vault(storage, 'cripito-sim'); again.sessionKey = sessionKey;
  await again.resume(blob);
  assert.equal(again.getItem('k'), 'v');
  assert.equal(again.certificates[0].id, 'c1');
});

test('apagar um app não apaga o FINANC ID nem os outros apps', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); await a.create('123456');
  const b = new Vault(storage, 'taxometro'); await b.create('123456'); await b.lock();
  await a.destroy('123456');
  assert.equal(a.exists, false);
  assert.ok(storage.getItem('financ-id-v1'));
  await b.unlock('123456');
});
