// C4 (upgrade plan): "A failed step retries with backoff, then on the next
// free provider, visible in the steps fold." The backoff and the decision to
// retry are pure (fallback.js); this test pins both, plus the ChatScreen
// wiring — the loop, the tool-touch guard that stops a re-send from running
// a tool twice, and the step row that makes the wait visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fallback = require('../desktop/src/fallback.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('backoff doubles and caps, and is deterministic', () => {
  assert.equal(fallback.backoff(0), 1000);
  assert.equal(fallback.backoff(1), 2000);
  assert.equal(fallback.backoff(2), 4000);
  assert.equal(fallback.backoff(3), 8000);
  assert.equal(fallback.backoff(9), 8000, 'capped');
  assert.equal(fallback.backoff(-1), 1000, 'a bad attempt starts at the base');
  assert.equal(fallback.backoff(NaN), 1000);
  assert.equal(fallback.waitLabel(1000), '1s');
  assert.equal(fallback.waitLabel(2000), '2s');
  assert.equal(fallback.waitLabel(1500), '1.5s');
  assert.equal(fallback.waitLabel(500), '500ms');
});

test('only a wait can fix, and only for as long as the budget lasts', () => {
  // The kinds a moment of waiting fixes — and nothing else.
  for (const kind of fallback.SWITCHABLE) {
    assert.equal(fallback.retryable({ kind }, 0), true, `${kind} may retry`);
  }
  assert.equal(fallback.retryable({ kind: 'credits' }, 0), false, 'a billing wall is not waited out');
  assert.equal(fallback.retryable({ kind: 'auth' }, 0), false);
  assert.equal(fallback.retryable({ kind: 'context' }, 0), false);
  assert.equal(fallback.retryable(null, 0), false, 'no failure, no retry');
  // The budget: RETRIES same-model attempts after the first, then switching.
  assert.equal(fallback.retryable({ kind: 'rate-limit' }, fallback.RETRIES - 1), true);
  assert.equal(fallback.retryable({ kind: 'rate-limit' }, fallback.RETRIES), false);
  assert.equal(fallback.retryable({ kind: 'rate-limit' }, 5), false, 'never an infinite loop');
});

test('the switching plan is unchanged by the retry', () => {
  // C4 adds a wait BEFORE the ladder; the ladder itself still starts with
  // the local handoff and never exceeds MAX_ATTEMPTS.
  const plan = fallback.plan({
    failure: { kind: 'rate-limit' },
    provider: 'openrouter',
    model: 'a/b',
    next: 'c/d',
    local: { baseUrl: 'http://127.0.0.1:8080', model: 'local', ready: true },
  });
  assert.equal(plan.automatic, true, 'remote -> local still switches on its own');
  assert.ok(plan.attempts.length <= fallback.MAX_ATTEMPTS);
  assert.equal(fallback.plan({ failure: { kind: 'credits' }, provider: 'p', model: 'm' }).attempts.length, 0);
});

test('ChatScreen retries with backoff before it switches, and says so in the fold', () => {
  const src = read('app', 'desktop', 'src', 'screens', 'ChatScreen.tsx');
  // The loop: catch, decide, wait, run again.
  assert.match(src, /fallback\.retryable\(told, attempt\)/, 'the pure gate decides');
  assert.match(src, /fallback\.backoff\(attempt\)/, 'the wait comes from fallback.js');
  assert.match(src, /await new Promise<void>\(\(resolve\) => \{\s*\n\s*const timer = setTimeout\(resolve, wait\);/, 'it actually waits');
  // The safety wire: a turn that already ran a tool is never re-sent.
  assert.match(src, /if \(aborted \|\| touched \|\| !fallback\.retryable/, 'no auto-retry after a tool ran');
  assert.match(src, /onTool: \(event: ToolEvent\) => \{ touched = true; upsertTool\(event\); \}/, 'touching is observed');
  // Visible in the steps fold: a real ToolEvent row, running while waiting.
  assert.match(src, /name: 'retry'/, 'the wait is a step, not a silence');
  assert.match(src, /summary: `\$\{told\.label\} — waiting \$\{label\}/, 'the step names the wait');
  // Stop during the backoff is still Stop.
  assert.match(src, /controller\.signal\.addEventListener\('abort'/, 'the wait is abortable');
});

test('fallback.d.ts declares the C4 surface for the screen', () => {
  const dts = read('app', 'desktop', 'src', 'fallback.d.ts');
  for (const pin of ['RETRIES', 'backoff', 'waitLabel', 'retryable']) {
    assert.ok(dts.includes(pin), `${pin} is typed`);
  }
});
