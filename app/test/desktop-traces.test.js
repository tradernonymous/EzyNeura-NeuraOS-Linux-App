// C7 (upgrade plan): "One JSONL line per model call and tool call, viewable
// in Activity, never sent anywhere." The store is localStorage written as
// JSONL; this test drives the real module against a fake store and pins the
// two facts the promise rests on: the whitelist (an argument passed along is
// dropped, not serialised) and the wiring (the turn and Activity both call it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const traces = require('../desktop/src/traces.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const store = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
};

test('one event is one JSON line with only the whitelisted fields', () => {
  const s = store();
  assert.equal(traces.append({ kind: 'model', provider: 'openrouter', model: 'a/b', chars: 120, ms: 840 }, s), true);
  assert.equal(traces.append({ kind: 'tool', name: 'run_command', status: 'done', ms: 42 }, s), true);
  const raw = s.getItem(traces.KEY);
  const lines = raw.split('\n');
  assert.equal(lines.length, 2, 'JSONL: one line per call');
  const model = JSON.parse(lines[0]);
  assert.equal(model.kind, 'model');
  assert.equal(model.provider, 'openrouter');
  assert.equal(model.model, 'a/b');
  const tool = JSON.parse(lines[1]);
  assert.deepEqual([tool.kind, tool.name, tool.status, tool.ms], ['tool', 'run_command', 'done', 42]);
  // The whitelist is a whitelist: anything else a caller passes is dropped.
  traces.append({ kind: 'tool', name: 'run_command', status: 'done', ms: 1, args: { command: 'cat ~/.ssh/id_rsa' }, result: 'secret output' }, s);
  const rawAfter = s.getItem(traces.KEY);
  assert.ok(!rawAfter.includes('id_rsa') && !rawAfter.includes('secret output'), 'arguments never reach the store');
  // Newest first for the screen.
  const rows = traces.recent(10, s);
  assert.equal(rows[0].kind, 'tool', 'recent is newest first');
  assert.equal(rows.length, 3);
});

test('the store is capped, cleared and crash-proof', () => {
  const s = store();
  for (let i = 0; i < traces.CAP + 25; i += 1) {
    traces.append({ kind: 'tool', name: 'n' + i, status: 'done', ms: i }, s);
  }
  const lines = s.getItem(traces.KEY).split('\n');
  assert.equal(lines.length, traces.CAP, 'capped');
  assert.equal(JSON.parse(lines[lines.length - 1]).name, 'n' + (traces.CAP + 24), 'the newest survives the cap');
  // A broken line costs that line, not the log.
  s.setItem(traces.KEY, s.getItem(traces.KEY) + '\n{broken');
  assert.ok(traces.recent(traces.CAP, s).every((r) => r && r.kind), 'a broken line is skipped');
  assert.equal(traces.clear(s), true);
  assert.equal(traces.recent(10, s).length, 0);
  // An event that is not a trace builds to nothing and appends nowhere.
  assert.equal(traces.build({ kind: 'something-else' }), '');
  assert.equal(traces.append({ nope: true }, s), false);
  assert.equal(traces.append({ kind: 'model' }, null), false, 'no store, no trace — and no throw');
  // Long text is clipped: a provider error dump is not a diary.
  const line = JSON.parse(traces.build({ kind: 'model', error: 'x'.repeat(1000) }));
  assert.ok(line.error.length <= 201, 'errors are clipped');
});

test('the turn writes the lines and Activity is the only reader', () => {
  const turn = read('app', 'desktop', 'src', 'agent-turn.ts');
  assert.match(turn, /onTrace\?: \(event: TraceEvent\) => void/, 'the hook exists');
  assert.match(turn, /options\.onTrace\?\.\(\{ kind: 'model', chars: text\.length, ms: Date\.now\(\) - startedAt \}\)/, 'a round is a line');
  assert.match(turn, /options\.onTrace\?\.\(\{ kind: 'model', chars: text\.length, ms: Date\.now\(\) - startedAt, error: message\.slice\(0, 200\) \}\)/, 'a failure is a line');
  assert.match(turn, /options\.onTrace\?\.\(\{ kind: 'tool', name: call\.name, status: event\.status, ms: Date\.now\(\) - toolStartedAt \}\)/, 'a tool call is a line');

  const chat = read('app', 'desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chat, /traceLib\.append\(\{ \.\.\.event, provider: asked\.provider, model: asked\.model \}\)/, 'the chat names its provider');
  assert.match(chat, /traceLib\.append\(\{ \.\.\.event, provider: target\.provider, model: target\.model, agent: agent\.name \}\)/, "a sub-agent's call is tagged");

  const activity = read('app', 'desktop', 'src', 'screens', 'ActivityScreen.tsx');
  assert.match(activity, /tracesLib\.recent\(30\)/, 'Activity shows them');
  assert.match(activity, /tracesLib\.clear\(\)/, 'and can clear them');
  assert.match(activity, /never sent anywhere/, 'the screen says where they live');

  const src = read('app', 'desktop', 'src', 'traces.js');
  assert.ok(!/fetch|XMLHttpRequest|WebSocket/.test(src), 'the store has no network path at all');
  const dts = read('app', 'desktop', 'src', 'traces.d.ts');
  for (const pin of ['append', 'recent', 'clear', 'CAP']) assert.ok(dts.includes(pin), `${pin} is typed`);
});
