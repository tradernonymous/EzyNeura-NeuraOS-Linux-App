// Settings backup and restore (backup.js, U08): one file out, one file in.
// Secrets never leave, content never bloats the file, and an import only
// touches keys this build knows.
const test = require('node:test');
const assert = require('node:assert/strict');

const backup = require('../desktop/src/backup.js');

function memStore(values) {
  const data = { ...values };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    keys: () => Object.keys(data),
    data,
  };
}

test('export keeps settings, drops secrets, skips chat content', () => {
  const store = memStore({
    'freeai4u-theme': 'dark',
    'freeai4u.accent': 'violet',
    'freeai4u.hf_token': 'hf_abcDEF1234567890',
    'freeai4u.byok': '{"x":1}',
    'freeai4u.chats': '[...a thousand chats...]',
    'freeai4u.updateChannel': 'stable',
  });
  const doc = backup.exportBackup(store);
  assert.equal(doc.version, 1);
  assert.equal(doc.values['freeai4u-theme'], 'dark');
  assert.equal(doc.values['freeai4u.updateChannel'], 'stable');
  assert.ok(!('freeai4u.hf_token' in doc.values), 'token stays');
  assert.ok(!('freeai4u.byok' in doc.values), 'provider keys stay');
  assert.ok(!('freeai4u.chats' in doc.values), 'content stays');
  assert.ok(doc.skippedSecrets.includes('freeai4u.hf_token'));
});

test('import restores known keys, skips secrets, unknowns and garbage', () => {
  const store = memStore({});
  const result = backup.importBackup({
    version: 1,
    at: new Date().toISOString(),
    values: {
      'freeai4u-theme': 'light',
      'freeai4u.hf_token': 'hf_abcDEF1234567890',
      'freeai4u.fromTheFuture': '1',
    },
  }, store);
  assert.deepEqual(result.restored, ['freeai4u-theme']);
  assert.deepEqual(result.skipped.sort(), ['freeai4u.fromTheFuture', 'freeai4u.hf_token'].sort());
  assert.deepEqual(result.errors, []);
  assert.equal(store.data['freeai4u-theme'], 'light');
  assert.ok(!('freeai4u.hf_token' in store.data));
});

test('a malformed document restores nothing', () => {
  for (const bad of [null, 'x', {}, { version: 2, values: {} }, { version: 1 }]) {
    const store = memStore({});
    const result = backup.importBackup(bad, store);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(Object.keys(store.data), []);
  }
});

test('round trip preserves every known settings key the tree uses', () => {
  const store = memStore({
    'freeai4u-theme': 'dark', 'freeai4u.accent': 'violet',
    'freeai4u.updateChannel': 'preview', 'freeai4u.sidebar.hidden': '1',
    'freeai4u.localRoot': '/home/u', 'neuraos.telemetry': '{}',
  });
  const doc = backup.exportBackup(store);
  const fresh = memStore({});
  const result = backup.importBackup(JSON.parse(JSON.stringify(doc)), fresh);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(fresh.data, store.data);
});
