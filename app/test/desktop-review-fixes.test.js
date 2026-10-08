// The code-review round: the hang, the parked workers, the un-cancellable
// tools, the split tool calls, the sd-server's death — and the upgrades
// beside them. The pure parts are RUN (collect, shrink, withSystem); the
// TypeScript and Rust parts are pinned in source, the repo's own habit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

require('../desktop/src/tools.js');
require('../desktop/src/run-settings.js');
const tools = globalThis.FreeAI4UTools;
const runSettings = globalThis.FreeAI4URunSettings;

// ---- HIGH 1: the Ollama error frame that hung the turn ----------------------

test('an Ollama error row is a marker, not a throw inside the drain', () => {
  const src = read('desktop', 'src', 'run-model.ts');
  // ollamaFrame returns the error...
  assert.match(src, /if \(row && row\.error\) return \{ error:/, 'the frame carries it');
  assert.ok(!/row && row\.error\) throw new ApiError/.test(src), 'nothing throws from inside the stream handler');
  // ...streamOllama records it and throws once, after the drain completes.
  assert.match(src, /let ollamaErr = '';/);
  assert.match(src, /if \(frame\?\.error\) \{ ollamaErr = frame\.error; continue; \}/);
  assert.match(src, /if \(ollamaErr\) throw new ApiError\(0, `Ollama: \$\{ollamaErr\}`\)/);
  // Belt and braces: a callback that throws anywhere becomes the stream's
  // own error instead of escaping the event handler with no settle.
  const bridge = read('desktop', 'src', 'bridge.ts');
  const guarded = bridge.match(/catch \(e\) \{\s*settle\(e instanceof Error \? e : new Error\(String\(e\)\)\);\s*return;/g) || [];
  assert.ok(guarded.length >= 2, 'both shell stream handlers wrap their callbacks');
});

// ---- HIGH 2: no thread::sleep inside async commands -------------------------

test('the three wait loops yield to tokio instead of parking a worker', () => {
  const models = read('desktop', 'src-tauri', 'src', 'models.rs');
  assert.match(models, /tokio::time::sleep\(Duration::from_millis\(750\)\)\.await/, 'the model-load wait');
  assert.ok(!/thread::sleep\(Duration::from_millis\(750\)\)/.test(models));
  const sd = read('desktop', 'src-tauri', 'src', 'sd.rs');
  assert.match(sd, /tokio::time::sleep\(Duration::from_millis\(750\)\)\.await/, 'the sd-server ready wait');
  assert.ok(!/thread::sleep\(Duration::from_millis\(750\)\)/.test(sd));
  const local = read('desktop', 'src-tauri', 'src', 'local.rs');
  assert.match(local, /tokio::time::sleep\(Duration::from_millis\(40\)\)\.await/, 'the run poll');
  assert.match(local, /pub async fn local_run\(/, 'async, so the yield is legal');
  const cargo = read('desktop', 'src-tauri', 'Cargo.toml');
  assert.match(cargo, /tokio = \{ version = "1", features = \["time"\] \}/);
});

// ---- MED 3: a turn's Stop reaches the tools ---------------------------------

test('Stop threads through execute, cancels what it can, and settles the cards', () => {
  const turn = read('desktop', 'src', 'agent-turn.ts');
  assert.match(turn, /execute: \(call: ToolCall, args: Record<string, any>, signal\?: AbortSignal\) => Promise<string>/);
  assert.match(turn, /result = await options\.execute\(call, args, options\.signal\)/);
  assert.match(turn, /status: 'stopped'/, 'in-flight cards settle on Stop');
  assert.match(turn, /settleStopped\(\);/, 'on every abort path');
  const run = read('desktop', 'src', 'tool-run.ts');
  assert.match(run, /function guarded<T>/, 'the race that frees the turn');
  assert.match(run, /signal\?\.aborted\) return 'Error: this tool was stopped before it started\.'/, 'a call refused before it starts');
  assert.match(run, /localRunCancel\(runId\)/, 'run_command is killed, not just unwaited');
  const bridge = read('desktop', 'src', 'bridge.ts');
  assert.match(bridge, /export async function localRunCancel/);
  const rust = read('desktop', 'src-tauri', 'src', 'local.rs');
  assert.match(rust, /pub fn local_run_cancel\(/);
  assert.match(rust, /remember_run\(&run_id, child\.id\(\)\)/, 'the pid the cancel signals');
  assert.match(rust, /forget_run\(&run_id\)/, 'gone when the run returns, so a recycled pid is never signalled');
  const main = read('desktop', 'src-tauri', 'src', 'main.rs');
  assert.match(main, /local::local_run_cancel,/);
  const cards = read('desktop', 'src', 'components', 'ToolCards.tsx');
  assert.match(cards, /stopped: 'stopped'/);
  assert.match(cards, /stopped: 'stop'/);
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.equal((chat.match(/execute: \(call, args, signal\) =>/g) || []).length, 2, 'both turns pass it');
});

// ---- MED 4: one call's deltas stay one call ---------------------------------

test('deltas that repeat an id without an index assemble into ONE call', () => {
  const calls = tools.collect(null, [
    { id: 'c1', function: { name: 'run_command', arguments: '{"command":"ls"' } },
    { id: 'c1', function: { arguments: '}' } },
    { id: 'c2', function: { name: 'read_file', arguments: '{"path":' } },
    { id: 'c2', function: { arguments: '"a.txt"}' } },
  ]);
  const done = tools.finish(calls);
  assert.equal(done.length, 2, 'two calls, not four');
  assert.equal(JSON.parse(done[0].arguments).command, 'ls');
  assert.equal(JSON.parse(done[1].arguments).path, 'a.txt');
  // Index still wins; an id-less delta still lands by position.
  const indexed = tools.finish(tools.collect(null, [
    { index: 0, id: 'x', function: { name: 'a', arguments: '{"q":' } },
    { index: 0, function: { arguments: '1}' } },
    { function: { name: 'b', arguments: '{"r":2}' } },
  ]));
  assert.equal(JSON.parse(indexed[0].arguments).q, 1);
  assert.equal(indexed[1].name, 'b');
});

// ---- LOW: the quick ones ----------------------------------------------------

test('web calls carry a deadline, and a screenshot map cannot grow forever', () => {
  const run = read('desktop', 'src', 'tool-run.ts');
  assert.match(run, /isWeb \? 30_000 : 0/, 'the web deadline');
  assert.match(run, /The web request timed out after 30 seconds\./);
  assert.match(run, /toolImages\.size > 8/, 'capped');
  const model = read('desktop', 'src', 'run-model.ts');
  assert.match(model, /const loading = new Map<string, Promise<LocalModelStatus>>\(\)/, 'one load per model');
  const imageRun = read('desktop', 'src', 'image-run.js');
  assert.match(imageRun, /lastState === 'queued' \? 2000 : 900/, 'the queue polls slowly, drawing quickly');
});

// ---- upgrades ---------------------------------------------------------------

test('the GPU ledger sits between the two servers', () => {
  const budget = read('desktop', 'src-tauri', 'src', 'gpu_budget.rs');
  assert.match(budget, /fn fits\(held: u64, need: u64, ceiling: Option<u64>\)/);
  assert.match(budget, /Stop the local model in Settings → Local models, then draw again\./, 'the refusal in words');
  const sd = read('desktop', 'src-tauri', 'src', 'sd.rs');
  assert.match(sd, /crate::gpu_budget::take_sd\(model_mb\(&model\)\)\?/, 'sd claims before it spawns');
  assert.match(sd, /crate::gpu_budget::give_sd\(\)/);
  const models = read('desktop', 'src-tauri', 'src', 'models.rs');
  assert.match(models, /crate::gpu_budget::available_mb\(\)/, 'the fit plans against what is free');
  assert.match(models, /crate::gpu_budget::take_llama\(claim_mb\)/);
  assert.match(models, /crate::gpu_budget::give_llama\(\)/);
});

test('sd-server dies the way a run_command does: group, TERM, KILL, reap', () => {
  const sd = read('desktop', 'src-tauri', 'src', 'sd.rs');
  assert.match(sd, /#\[cfg\(unix\)\]\s*\{\s*use std::os::unix::process::CommandExt;/, 'the Unix spawn path');
  assert.match(sd, /command\.process_group\(0\);/, 'its own process group (local.rs uses `cmd.`, not `command.`)');
  assert.match(sd, /crate::local::kill_tree\(&mut run\.child\)/, 'the shared graceful path');
  assert.ok(!/let _ = run\.child\.kill\(\);/.test(sd), 'the abrupt kill is gone');
  const local = read('desktop', 'src-tauri', 'src', 'local.rs');
  assert.match(local, /pub\(crate\) fn kill_tree/);
});

test('read-only calls in a round run together, asking calls alone', () => {
  const turn = read('desktop', 'src', 'agent-turn.ts');
  assert.match(turn, /const results = await Promise\.all\(batch\.map\(\(c\) => runOne\(c\)\)\)/);
  assert.match(turn, /if \(!batch\.length\) \{[\s\S]{0,200}?await runOne\(calls\[at\]\)/, 'an asking call is on its own');
  // Order is kept by pushing each call's messages after the batch resolves.
  assert.match(turn, /for \(const pushed of results\) pushed\.forEach\(\(m\) => messages\.push\(m\)\)/);
  // The preview rides the same ids the finished events use.
  assert.match(turn, /preview: String\(last\.arguments\)\.slice\(-600\)/);
  const cards = read('desktop', 'src', 'components', 'ToolCards.tsx');
  assert.match(cards, /tool-card-preview/);
});

test('a long turn trims old tool results inside the loaded context', () => {
  const turn = read('desktop', 'src', 'agent-turn.ts');
  assert.match(turn, /charBudget\?: number/);
  assert.match(turn, /tools\.shrink\(messages, options\.charBudget\)/);
  const model = read('desktop', 'src', 'run-model.ts');
  assert.match(model, /export function charBudgetFor/);
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.equal((chat.match(/charBudget: charBudgetFor\(/g) || []).length, 2, 'chat and the sub-agent');
  // And the prefix it all hangs on stays byte-stable: one prepend, no order.
  const out = JSON.stringify(runSettings.withSystem([{ role: 'user', content: 'hi' }], { system: 'SYS' }));
  assert.equal(out, JSON.stringify(runSettings.withSystem([{ role: 'user', content: 'hi' }], { system: 'SYS' })), 'same bytes every round');
  assert.match(out, /"role":"system","content":"SYS"/);
});

test('shrink: oldest tool results go first, everything else is untouchable', () => {
  const big = 'y'.repeat(6000);
  const messages = [
    { role: 'system', content: 'rules '.repeat(1000) },
    { role: 'tool', content: big },
    { role: 'tool', content: 'short' },
    { role: 'assistant', content: 'ok' },
  ];
  const over = tools.shrink(messages, 4000);
  assert.ok(over.clipped >= 1, 'something was trimmed');
  assert.match(over.messages[1].content, /older result trimmed to fit the model’s context/);
  assert.ok(over.messages[1].content.length < big.length, 'shorter than it was');
  assert.equal(over.messages[0].content, messages[0].content, 'system stays');
  assert.equal(over.messages[2].content, 'short', 'a small tool result stays');
  assert.equal(over.messages[3].content, 'ok', 'assistant stays');
  const under = tools.shrink(messages, 10_000_000);
  assert.equal(under.clipped, 0, 'under budget, nothing changes');
  assert.equal(under.messages[1], messages[1], 'the same reference');
});
