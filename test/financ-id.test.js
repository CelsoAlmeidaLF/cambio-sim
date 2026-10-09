const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
// Roda tanto em stk-pkg-security/test quanto em <app>/test (o kit fica em <app>/src).
const kit = ['../stk-pkg-secure-vault.js', '../src/stk-pkg-secure-vault.js'].map(p => path.join(__dirname, p)).find(p => fs.existsSync(p));
const { Vault, protect, recoveryCode, seed } = require(kit);
const wordlist = require(path.join(path.dirname(kit), 'stk-pkg-bip39-pt.js'));

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
// FINANC ID no formato até a v1.6 (código de recuperação de 8 blocos, sem as 12 palavras).
async function legacyIdentity(storage, pin, code = recoveryCode()) {
  const master = b64(crypto.getRandomValues(new Uint8Array(32)));
  storage.setItem('financ-id-v1', JSON.stringify({ version: 1, uid: 'u1',
    password: await protect(master, pin, 'financ-id:v1:password'),
    recovery: await protectRecovery(master, code, 'financ-id:v1:recovery') }));
  return code;
}
const isSeed = s => s && Array.isArray(s.words) && s.words.length === 12 && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(s.hash);

test('primeiro app cria o FINANC ID com 12 palavras; o segundo usa o mesmo PIN sem palavras novas', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim');
  const created = await a.create('123456', { cambio_log: '[1]' });
  assert.ok(isSeed(created));
  assert.ok(created.words.every(w => wordlist.includes(w)));
  assert.doesNotMatch(storage.getItem('financ-id-v1'), new RegExp(created.words.join('|')));
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

test('12 palavras ou o hash redefinem o PIN de todos; as palavras continuam as mesmas', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); const { words, hash } = await a.create('123456'); await a.lock();
  const b = new Vault(storage, 'taxometro'); await b.create('123456'); await b.lock();
  assert.deepEqual(await a.resetPassword(words.join(' '), '222222'), {});
  await b.unlock('222222'); await b.lock(); await a.lock();
  // Mesmas palavras de novo (não trocam), agora pelo hash, digitado com minúsculas e sem traços.
  await a.resetPassword(hash.replace(/-/g, '').toLowerCase(), '333333');
  await b.unlock('333333'); await b.lock(); await a.lock();
  // Palavras erradas (válidas na lista e no dígito de conferência) não abrem.
  const other = await seed.wordsFromEntropy(new Uint8Array(16).fill(7));
  await assert.rejects(a.resetPassword(other.join(' '), '444444'), { name: 'OperationError' });
  await assert.rejects(a.resetPassword('abacate abaixo', '444444'), { code: 'SEED_INVALID' });
  await assert.rejects(a.resetPassword(recoveryCode(), '444444'), { code: 'SEED_INVALID' });
});

test('app sem cofre neste aparelho entra pelas 12 palavras', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); const { words } = await a.create('123456');
  const b = new Vault(storage, 'taxometro');
  const status = await b.resetPassword(words.map(w => w.slice(0, 4).toUpperCase()).join(', '), '444444');
  assert.ok(b.linked); assert.deepEqual(status, {});
  await a.lock(); await a.unlock('444444');
});

test('migração: primeiro app antigo vira o FINANC ID e mantém os dados', async () => {
  const storage = new MemoryStorage();
  await legacyVault(storage, 'cripito-sim', '123456', { 'cripto-chain:real': 'bloco-secreto' });
  const v = new Vault(storage, 'cripito-sim');
  assert.equal(v.linked, false);
  const status = await v.unlock('123456');
  assert.ok(isSeed(status.seed), 'mostra as 12 palavras do FINANC ID');
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
  assert.ok(isSeed(status.seed)); assert.equal(v.linked, true);
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

test('senha longa no lugar do PIN vale para todos os apps', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); const { words } = await a.create('123456');
  const b = new Vault(storage, 'taxometro'); await b.create('123456'); await b.lock();
  await assert.rejects(a.changeSecretKind('123456', 'curta', 'password'), /10 caracteres/);
  await assert.rejects(a.changeSecretKind('000000', 'minha frase segura', 'password'), { name: 'OperationError' });
  await a.changeSecretKind('123456', 'minha frase segura', 'password');
  assert.equal(a.secretKind, 'password');
  await assert.rejects(b.unlock('123456'), { name: 'OperationError' });
  await b.unlock('minha frase segura');
  assert.equal(b.secretKind, 'password');
  // Com senha, trocar exige outra senha longa, não um PIN.
  await assert.rejects(b.changePin('minha frase segura', '654321'), /10 caracteres/);
  await b.changePin('minha frase segura', 'outra frase segura');
  // App novo no aparelho entra com a senha.
  const c = new Vault(storage, 'gerenc-fin');
  assert.equal(c.secretKind, 'password');
  assert.equal(await c.create('outra frase segura'), null);
  // Voltar ao PIN.
  await c.changeSecretKind('outra frase segura', '777777', 'pin');
  await a.lock(); await a.unlock('777777');
  assert.equal(a.secretKind, 'pin');
  // Código de recuperação volta para PIN (a interface de recuperação usa o teclado numérico).
  await a.changeSecretKind('777777', 'frase de novo aqui', 'password');
  await a.lock();
  await a.resetPassword(words.join(' '), '222222');
  assert.equal(a.secretKind, 'pin');
});

test('BIP39: semente zero, ida e volta, conferência e abreviações', async () => {
  const zero = await seed.wordsFromEntropy(new Uint8Array(16));
  assert.deepEqual(zero, [...Array(11).fill(wordlist[0]), wordlist[3]]); // mesmo padrão de "abandon … about"
  for (let i = 0; i < 5; i++) {
    const e = crypto.getRandomValues(new Uint8Array(16)), words = await seed.wordsFromEntropy(e);
    assert.deepEqual(await seed.entropyFromWords(words.join(' ')), e);
    assert.deepEqual(await seed.entropyFromWords(words.map(w => w.slice(0, 4).toUpperCase()).join('\n')), e);
  }
  const words = await seed.wordsFromEntropy(new Uint8Array(16).fill(3));
  const swapped = [words[1], words[0], ...words.slice(2)];
  if (swapped.join() !== words.join()) await assert.rejects(seed.entropyFromWords(swapped.join(' ')), { code: 'SEED_INVALID' });
  await assert.rejects(seed.entropyFromWords(words.slice(0, 11).join(' ')), /12 palavras/);
  await assert.rejects(seed.entropyFromWords([...words.slice(0, 11), 'xyzw'].join(' ')), /não existe/);
  assert.equal(seed.normalizeHash('k7qm-2xpa-9rtd'), 'K7QM2XPA9RTD');
  assert.equal(seed.normalizeHash('o1i0 L000 0000'), '011010000000');
  assert.throws(() => seed.normalizeHash('ABC'), { code: 'SEED_INVALID' });
});

test('FINANC ID antigo ganha as 12 palavras ao abrir; o código antigo deixa de valer', async () => {
  const storage = new MemoryStorage();
  const oldCode = await legacyIdentity(storage, '123456');
  const a = new Vault(storage, 'invest-sim');
  assert.equal(await a.create('123456', { x: '1' }), null);
  await a.lock();
  const status = await a.unlock('123456');
  assert.ok(isSeed(status.seed));
  await a.lock();
  assert.deepEqual(await a.unlock('123456'), {}, 'migra uma vez só');
  await a.lock();
  await assert.rejects(a.resetPassword(oldCode, '222222'), { code: 'SEED_INVALID' });
  await a.resetPassword(status.seed.words.join(' '), '222222');
  assert.equal(a.getItem('x'), '1');
});

test('certificado sai das palavras: o mesmo em outro aparelho, e é o atual', async () => {
  const s1 = new MemoryStorage(), s2 = new MemoryStorage();
  const a = new Vault(s1, 'cripito-sim'); const { words } = await a.create('123456');
  const b = new Vault(s2, 'cripito-sim'); await b.create('999999');
  assert.notEqual(a.certificates[0].id, b.certificates[0].id);
  const c = new Vault(s2, 'gerenc-fin'); await c.create('999999');
  // Aparelho 2 passa a usar as palavras do aparelho 1? Não: cada FINANC ID tem as suas. Mas a raiz é a mesma.
  const root = await seed.rootFromHash(await seed.hashFromEntropy(await seed.entropyFromWords(words.join(' '))));
  assert.equal((await seed.certFromRoot(root)).id, a.certificates[0].id);
  assert.equal((await seed.certFromRoot(root)).secret, a.certificates[0].secret);
});

test('backup v2: abre sem senha no aparelho; em outro, com as 12 palavras ou o hash', async () => {
  const s1 = new MemoryStorage(), s2 = new MemoryStorage();
  const a = new Vault(s1, 'invest-sim'); const { words, hash } = await a.create('123456');
  const file = JSON.parse(JSON.stringify(await a.exportBackup({ saldo: 100 }, 'invest-sim:backup')));
  assert.equal(file.format, 'financ-backup-v2');
  assert.doesNotMatch(JSON.stringify(file), /saldo/);
  assert.deepEqual(await a.importBackup(file, 'invest-sim:backup'), { saldo: 100 });
  await assert.rejects(a.importBackup(file, 'gerenc-fin:backup'), /incompatível/);
  const b = new Vault(s2, 'invest-sim'); await b.create('999999');
  await assert.rejects(b.importBackup(file, 'invest-sim:backup'), { code: 'SEED_REQUIRED' });
  assert.deepEqual(await b.importBackup(file, 'invest-sim:backup', words.join(' ')), { saldo: 100 });
  assert.deepEqual(await b.importBackup(file, 'invest-sim:backup', hash), { saldo: 100 });
  const wrong = await seed.wordsFromEntropy(new Uint8Array(16).fill(9));
  await assert.rejects(b.importBackup(file, 'invest-sim:backup', wrong.join(' ')), /não abrem este backup/);
  file.ciphertext = file.ciphertext.replace(/^./, c => c === 'A' ? 'B' : 'A');
  await assert.rejects(a.importBackup(file, 'invest-sim:backup'), { name: 'OperationError' });
});

test('gerar novas 12 palavras e ver as palavras de novo com o PIN', async () => {
  const storage = new MemoryStorage();
  const a = new Vault(storage, 'cambio-sim'); const first = await a.create('123456');
  assert.deepEqual(await a.revealSeed('123456'), first);
  await assert.rejects(a.revealSeed('000000'), { name: 'OperationError' });
  const oldCert = a.certificates[0].id;
  const next = await a.rotateRecovery('123456');
  assert.ok(isSeed(next)); assert.notDeepEqual(next.words, first.words);
  assert.deepEqual(await a.revealSeed('123456'), next);
  assert.equal(a.certificates[1].id, oldCert, 'certificado antigo continua guardado');
  await a.lock();
  await assert.rejects(a.resetPassword(first.words.join(' '), '222222'), { name: 'OperationError' });
  await a.resetPassword(next.hash, '222222');
});

test('FINANC ID antigo reaberto pela sessão (sem PIN) ganha as 12 palavras; ver palavras também cria', async () => {
  const storage = new MemoryStorage();
  const sessionKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await legacyIdentity(storage, '123456');
  const a = new Vault(storage, 'invest-sim'); a.sessionKey = sessionKey;
  assert.equal(await a.create('123456', { x: '1' }), null);
  const blob = a.session;
  const again = new Vault(storage, 'invest-sim'); again.sessionKey = sessionKey;
  await again.resume(blob);
  const status = await again.finishMigration();
  assert.ok(isSeed(status.seed));
  assert.deepEqual(await again.finishMigration(), {});
  assert.deepEqual(await again.revealSeed('123456'), status.seed);
  // Outro FINANC ID antigo: "Ver minhas 12 palavras" cria e mostra.
  const s2 = new MemoryStorage(); await legacyIdentity(s2, '654321');
  const b = new Vault(s2, 'cambio-sim'); await b.create('654321');
  const shown = await b.revealSeed('654321');
  assert.ok(isSeed(shown));
  assert.deepEqual(await b.revealSeed('654321'), shown);
});
