// Puter sign-in from the desktop: the page opens in the system browser and the
// app polls /login/wait for the session's token (puter.js signIn). A sign-in
// that never comes back must be stoppable, and Puter must read as optional
// when another service draws.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const puter = require('../desktop/src/puter.js');

function fakeSdk() {
  let token = '';
  return {
    auth: { isSignedIn: () => !!token },
    setAuthToken: (t) => { token = t; },
  };
}

test('a token from /login/wait signs the SDK in', async () => {
  globalThis.puter = fakeSdk();
  let polls = 0;
  const ok = await puter.signIn({
    open: () => {},
    sleep: () => Promise.resolve(),
    fetchImpl: async (url, init) => {
      assert.match(url, /\/login\/wait$/);
      assert.equal(init.method, 'POST');
      polls += 1;
      if (polls < 3) return { ok: false };
      return { ok: true, json: async () => ({ auth_token: 't0k' }) };
    },
  });
  assert.equal(ok, true);
  assert.equal(polls, 3);
  delete globalThis.puter;
});

test('Cancel stops a sign-in that never comes back', async () => {
  globalThis.puter = fakeSdk();
  let cancelled = false;
  let polls = 0;
  await assert.rejects(
    puter.signIn({
      open: () => {},
      sleep: () => { if (polls >= 2) cancelled = true; return Promise.resolve(); },
      fetchImpl: async () => { polls += 1; return { ok: false }; },
      cancelled: () => cancelled,
    }),
    /cancelled/,
  );
  assert.equal(polls, 2);
  delete globalThis.puter;
});

test('the Images screen folds Puter away unless it is the service chosen', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'screens', 'ImagesScreen.tsx'), 'utf8');
  assert.match(src, /<details className="puter-fold" open=\{isBrowser \|\| puterWaiting\}>/);
  assert.match(src, /Puter \(optional\)/);
  assert.match(src, /Not needed for This PC or the engine/);
  assert.match(src, /Cancel sign-in/);
  // The wait has its own state: a local draw is not blocked by it.
  assert.doesNotMatch(src, /const connectPuter = \(\) => \{\n\s*setPuterMsg\(''\);\n\s*setBusy\(true\)/);
});
