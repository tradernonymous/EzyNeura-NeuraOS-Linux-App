// The Test button beside the Hugging Face paste field (upgrade plan E4): a
// token is checked end to end WITHOUT being kept, and the answer says which
// Inference Providers it can reach -- so an empty Model column is explained
// rather than looking like a bug. hf-auth.js is pure behind an injectable
// fetch; the .tsx pins keep the button on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hfAuth = require('../desktop/src/hf-auth.js');

const TOKEN = 'hf_' + 'a'.repeat(24);
const whoamiUrl = 'https://huggingface.co/api/whoami-v2';
const modelsUrl = 'https://router.huggingface.co/v1/models';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const bad = (status, body = {}) => ({ ok: false, status, json: async () => body });

/** fetch that answers per URL; a null route means the network throws. */
const fakeFetch = (whoami, models) => async (url) => {
  if (String(url).startsWith(whoamiUrl)) {
    if (whoami instanceof Error) throw whoami;
    return whoami;
  }
  if (String(url).startsWith(modelsUrl)) {
    if (models instanceof Error) throw models;
    return models;
  }
  throw new Error('unexpected url ' + url);
};

const userWith = (fineGrained) => ({
  name: 'someone',
  auth: { accessToken: fineGrained ? { fineGrained } : {} },
});
const allowsInference = { global: ['inference.serverless.write'] };
const forbidsInference = { global: ['read'], scoped: [{ permissions: ['repo.read'] }] };

const modelRows = (specs) => ({
  data: specs.map((providers) => ({ id: 'org/model-' + Math.random().toString(36).slice(2), providers })),
});

test('a token that does not look like one is refused on its shape alone', async () => {
  const report = await hfAuth.testToken('not-a-token', fakeFetch(bad(500), bad(500)));
  assert.equal(report.status, 'bad-format');
  assert.equal(report.ok, false);
  assert.match(report.messages[0], /start with hf_/);
});

test('a refused token says so, and says what to do', async () => {
  const report = await hfAuth.testToken(TOKEN, fakeFetch(bad(401), bad(500)));
  assert.equal(report.status, 'refused');
  assert.match(report.messages[0], /refused that token/);
});

test('a valid token without the Inference Providers permission is named exactly', async () => {
  const report = await hfAuth.testToken(TOKEN, fakeFetch(ok(userWith(forbidsInference)), bad(500)));
  assert.equal(report.status, 'no-inference-permission');
  assert.match(report.messages[0], /Make calls to Inference Providers/);
  assert.equal(report.ok, false);
});

test('an unreachable network is offline, not a broken token', async () => {
  const report = await hfAuth.testToken(TOKEN, fakeFetch(new Error('ECONNREFUSED'), bad(500)));
  assert.equal(report.status, 'offline');
  assert.match(report.messages[0], /could not be reached/);
});

test('the router refusing the token is the permission answer too', async () => {
  const report = await hfAuth.testToken(TOKEN, fakeFetch(ok(userWith(allowsInference)), bad(401)));
  assert.equal(report.status, 'no-inference-permission');
  assert.match(report.messages[0], /router refused/);
});

test('a working token with no models says the column is empty for that reason', async () => {
  const report = await hfAuth.testToken(
    TOKEN,
    fakeFetch(ok(userWith(allowsInference)), ok({ data: [{ id: 'org/x', providers: [] }] })),
  );
  assert.equal(report.status, 'no-models');
  assert.equal(report.ok, false);
  assert.match(report.messages[0], /It is not the token/);
});

test('the report names the providers the token can reach, most models first', async () => {
  const rows = [
    { providers: [{ provider: 'novita' }, { provider: 'together' }] },
    { providers: [{ provider: 'novita' }] },
    { providers: [{ provider: 'fireworks' }] },
  ];
  const report = await hfAuth.testToken(TOKEN, fakeFetch(ok(userWith(allowsInference)), ok({ data: rows })));
  assert.equal(report.status, 'ok');
  assert.equal(report.ok, true);
  assert.equal(report.user, 'someone');
  assert.equal(report.models, 3);
  assert.deepEqual(report.providers, ['novita', 'fireworks', 'together'], 'most models first, then alphabetical');
  assert.match(report.messages[0], /3 Inference Providers/);
});

test('testing never keeps the token', async () => {
  // The one rule this button must not break: a test is not a sign-in. The
  // secret store is a stand-in that fails the test if anything is written.
  const store = {
    writes: [],
    async get() { return null; },
    async set(value) { this.writes.push(value); return value; },
  };
  hfAuth.configureStore(store);
  try {
    await hfAuth.testToken(TOKEN, fakeFetch(ok(userWith(allowsInference)), ok(modelRows([{ provider: 'novita' }]))));
    assert.deepEqual(store.writes, [], 'nothing was written to the secret store');
    assert.equal(hfAuth.signedIn(), false, 'and the app is still signed out');
  } finally {
    hfAuth.configureStore(null);
  }
});

test('useToken and testToken share the same permission rule', () => {
  // Both read one helper: a stricter check on one path than the other would
  // let a token test pass and the sign-in refuse (or the reverse).
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'hf-auth.js'), 'utf8');
  const helperUses = src.match(/inferencePermission\(user\)/g) || [];
  assert.ok(helperUses.length >= 2, 'useToken and testToken both call inferencePermission');
});

test('the screen wears it: a Test button beside the paste field, and the report under it', () => {
  const screen = fs.readFileSync(
    path.join(__dirname, '..', 'desktop', 'src', 'components', 'HfSignIn.tsx'),
    'utf8',
  );
  assert.match(screen, /onClick=\{test\}/);
  assert.match(screen, /hfAuth\.testToken\(token\)/, 'the button tests the pasted token');
  assert.match(screen, /hf-token-report/, 'the report renders under the field');
});
