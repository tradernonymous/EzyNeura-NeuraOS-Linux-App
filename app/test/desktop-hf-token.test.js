// Testing a Hugging Face token before using it (E4 of
// docs/APP_UPGRADE_PLAN.md).
//
// The property that matters most here is negative: `checkToken` must not save
// anything. It is wired to a button labelled "Test", and a button labelled
// "Test" that quietly writes a credential to the OS keyring is the kind of
// surprise that loses somebody's trust in the whole app. So the store is
// asserted empty after a successful check, not merely unmentioned.
const test = require('node:test');
const assert = require('node:assert/strict');

const hfAuth = require('../desktop/src/hf-auth.js');

/** A store that records everything written to it, so "was anything saved?" is answerable. */
function recordingStore() {
  const written = new Map();
  return {
    written,
    get: (k) => written.get(k) ?? null,
    set: (k, v) => { written.set(k, v); return Promise.resolve(); },
    remove: (k) => { written.delete(k); return Promise.resolve(); },
  };
}

const TOKEN = 'hf_' + 'a'.repeat(30);
const tokenOf = (store) => store.written.get(hfAuth.SECRET_TOKEN);

/** whoami-v2 answers with this for a token that may call Inference Providers. */
const okUser = (name = 'sam') => ({
  name,
  auth: { accessToken: { fineGrained: { global: ['inference.serverless.write'] } } },
});

/** A token that is valid but was created without the inference permission. */
const noInferUser = () => ({
  name: 'sam',
  auth: { accessToken: { fineGrained: { global: ['repo'] } } },
});

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// ---- checkToken: verifies, and does not keep ---------------------------------

test('a good token resolves to the user it belongs to, and saves nothing', async () => {
  const store = recordingStore();
  hfAuth.configureStore(store);
  const who = await hfAuth.checkToken(TOKEN, async () => jsonResponse(200, okUser('sam')));
  assert.equal(who.name, 'sam');
  // The whole point: a test is not a sign-in.
  assert.equal(store.written.size, 0, `checkToken wrote ${[...store.written.keys()]}`);
  assert.equal(hfAuth.signedIn(), false, 'and the app is not signed in afterwards');
});

test('the token is sent as a header, never in the URL', async () => {
  hfAuth.configureStore(recordingStore());
  let seenUrl = '';
  let seenAuth = '';
  await hfAuth.checkToken(TOKEN, async (url, init) => {
    seenUrl = url;
    seenAuth = (init?.headers || {}).Authorization || '';
    return jsonResponse(200, okUser());
  });
  assert.ok(!seenUrl.includes(TOKEN), 'the token is not in the URL, where it would land in a log');
  assert.equal(seenAuth, 'Bearer ' + TOKEN);
});

test('a token without the inference permission is refused, and says which box to tick', async () => {
  hfAuth.configureStore(recordingStore());
  await assert.rejects(
    () => hfAuth.checkToken(TOKEN, async () => jsonResponse(200, noInferUser())),
    /Make calls to Inference Providers/,
  );
});

test('a scoped token with the permission is accepted', async () => {
  // Hugging Face issues both shapes; only the global one is common enough to
  // be the only one that matters, and rejecting a working scoped token would
  // be a bug that only some users would ever see.
  hfAuth.configureStore(recordingStore());
  const scoped = {
    name: 'sam',
    auth: { accessToken: { fineGrained: { scoped: [{ permissions: ['inference.serverless.write'] }] } } },
  };
  const who = await hfAuth.checkToken(TOKEN, async () => jsonResponse(200, scoped));
  assert.equal(who.name, 'sam');
});

// ---- the three failures, kept distinct because the next step differs ---------

test('a malformed string is refused before any request is made', async () => {
  hfAuth.configureStore(recordingStore());
  let called = false;
  // A function matcher rather than a regex: this is about the message, and the
  // caller reads `err.message`, so that is what is asserted.
  await assert.rejects(
    () => hfAuth.checkToken('not-a-token', async () => { called = true; return jsonResponse(200, okUser()); }),
    (err) => err instanceof Error && /does not look like a Hugging Face token/.test(err.message),
  );
  assert.equal(called, false, 'no point spending a request on something that cannot be one');
});

test('a 401 says the token was refused, which is a different problem from a typo', async () => {
  hfAuth.configureStore(recordingStore());
  await assert.rejects(
    () => hfAuth.checkToken(TOKEN, async () => jsonResponse(401, {})),
    /refused that token/,
  );
});

test('a 500 says to try again, rather than blaming the token', async () => {
  // The failure that is not the user's fault, and must not read as one.
  hfAuth.configureStore(recordingStore());
  await assert.rejects(
    () => hfAuth.checkToken(TOKEN, async () => jsonResponse(500, {})),
    /did not answer/,
  );
});

test('a network failure is an error, not a silent success', async () => {
  hfAuth.configureStore(recordingStore());
  await assert.rejects(
    () => hfAuth.checkToken(TOKEN, async () => { throw new Error('offline'); }),
    /offline/,
  );
});

// ---- useToken: the same rules, plus the saving -------------------------------

test('useToken accepts exactly what checkToken accepts', async () => {
  // The two share one implementation precisely so they cannot disagree. This
  // walks the same four cases through both and compares the verdicts.
  const cases = [
    ['ok', 200, okUser()],
    ['no-permission', 200, noInferUser()],
    ['unauthorized', 401, {}],
    ['server-error', 500, {}],
  ];
  for (const [label, status, body] of cases) {
    const checkStore = recordingStore();
    hfAuth.configureStore(checkStore);
    const useStore = recordingStore();
    hfAuth.configureStore(useStore);

    const verdict = async (fn) => {
      try { await fn(); return 'accepted'; } catch (e) { return e.message; }
    };
    const viaCheck = await verdict(() => hfAuth.checkToken(TOKEN, async () => jsonResponse(status, body)));
    const viaUse = await verdict(() => hfAuth.useToken(TOKEN, async () => jsonResponse(status, body)));
    assert.equal(viaUse, viaCheck, `${label}: the two disagree`);
  }
});

test('useToken does store the token, since that is the button that says so', async () => {
  const store = recordingStore();
  hfAuth.configureStore(store);
  await hfAuth.useToken(TOKEN, async () => jsonResponse(200, okUser()));
  assert.ok(tokenOf(store), 'the token reached the keyring');
  assert.equal(hfAuth.signedIn(), true);
  hfAuth.signOut();
});

test('useToken stores nothing when the token is refused', async () => {
  const store = recordingStore();
  hfAuth.configureStore(store);
  await assert.rejects(() => hfAuth.useToken(TOKEN, async () => jsonResponse(401, {})));
  assert.equal(store.written.size, 0, 'a rejected token is not half-saved');
  assert.equal(hfAuth.signedIn(), false);
});
