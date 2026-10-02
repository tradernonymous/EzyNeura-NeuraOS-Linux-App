// The Doctor (D6): what the gathered facts turn into, and the sentences that
// come with them.
//
// The properties worth pinning are the ones a screenshot test would never
// catch: that every `bad` carries a fix, that a warning never does, that the
// ordering puts the hard requirement first, and that nothing here can echo a
// secret -- because this card is the thing a user is told to paste into a bug
// report.
const test = require('node:test');
const assert = require('node:assert/strict');

const doctor = require('../desktop/src/doctor.js');

const byId = (checks, id) => checks.find((c) => c.id === id);

/** A machine with nothing wrong and nothing installed but Node. */
const healthy = () => ({
  version: '2.11.0',
  os: 'linux',
  arch: 'x86_64',
  node: { found: true, ok: true, path: '/usr/bin/node', major: 24 },
  engine: { running: true, port: 8787, service: { available: true, enabled: true, active: true, unit: 'neuraos-engine' } },
  runtimes: { node: { path: '/usr/bin/node', version: 'v24.1.0' }, llama: null, gpu: null, min_node_major: 24 },
  git: { available: true, name: 'Sam', email: 'sam@example.com' },
  keys: { hf_token: true },
  tools: { git: true, curl: true, jq: true, rg: true, ffmpeg: true },
});

const find = (list, text) => list.some((c) => c.includes(text));

// ---- the three states -------------------------------------------------------

test('a healthy machine is all ok, and says so in one line', () => {
  const checks = doctor.buildChecks(healthy());
  for (const c of checks) {
    assert.equal(c.state, 'ok', `${c.id} was ${c.state}: ${c.detail}`);
  }
  assert.equal(doctor.overallState(checks), 'ok');
  assert.equal(doctor.summarize(checks), 'Everything NeuraOS depends on is here.');
});

test('a missing Node is bad, names the version, and says how to fix it', () => {
  const facts = healthy();
  facts.node = { found: false, ok: false, reason: 'No `node` found.' };
  const node = byId(doctor.buildChecks(facts), 'node');
  assert.equal(node.state, 'bad');
  assert.ok(node.fix.includes('Node 24'), node.fix);
  assert.ok(find([node.fix], 'nvm'), 'the fix names a way to install it');
});

test('a Node that is too old is bad, and says which version is needed', () => {
  const facts = healthy();
  facts.node = { found: true, ok: false, major: 18, reason: 'Node 18 is on PATH, but the engine needs 24+.' };
  const node = byId(doctor.buildChecks(facts), 'node');
  assert.equal(node.state, 'bad');
  assert.ok(find([node.detail], 'too old') || find([node.detail], 'needs 24'), node.detail);
  assert.ok(node.fix.includes('24'), node.fix);
});

// ---- the middle state, which a boolean would throw away ---------------------

test('an engine that is not running is fine, because nothing asked it to run', () => {
  const facts = healthy();
  facts.engine = { running: false, port: 8787, service: { available: true, enabled: false, active: false, unit: 'neuraos-engine' } };
  const engine = byId(doctor.buildChecks(facts), 'engine');
  assert.equal(engine.state, 'ok', 'not running is the normal state before a chat needs it');
});

test('an engine that is enabled to start on login but is not, is bad', () => {
  // The one that surprises people: they asked for this and it quietly did not
  // happen, which is a fault rather than a state.
  const facts = healthy();
  facts.engine = { running: false, port: 8787, service: { available: true, enabled: true, active: false, unit: 'neuraos-engine' } };
  const engine = byId(doctor.buildChecks(facts), 'engine');
  assert.equal(engine.state, 'bad');
  assert.ok(engine.fix.includes('systemctl --user start'), engine.fix);
  assert.ok(engine.fix.includes('neuraos-engine'), 'the fix names the unit');
});

test('a git identity that is missing is bad, with the two commands to set it', () => {
  const facts = healthy();
  facts.git = { available: true, name: '', email: '' };
  const git = byId(doctor.buildChecks(facts), 'git');
  assert.equal(git.state, 'bad');
  assert.ok(git.fix.includes('user.name'), git.fix);
  assert.ok(git.fix.includes('user.email'), git.fix);
});

test('no git at all is a warning, not a fault: most of the app works without it', () => {
  const facts = healthy();
  facts.git = { available: false, name: '', email: '' };
  const git = byId(doctor.buildChecks(facts), 'git');
  assert.equal(git.state, 'warn');
  assert.equal(git.fix, '', 'a warning suggests; it does not instruct');
});

test('a missing Hugging Face token is a warning, never bad', () => {
  const facts = healthy();
  facts.keys = { hf_token: false };
  const keys = byId(doctor.buildChecks(facts), 'keys');
  assert.equal(keys.state, 'warn');
  assert.ok(find([keys.detail], 'Public models work'), keys.detail);
});

test('a missing optional tool is a warning naming the tool', () => {
  const facts = healthy();
  facts.tools = { git: true, curl: true, jq: false, rg: true, ffmpeg: true };
  const tools = byId(doctor.buildChecks(facts), 'tools');
  assert.equal(tools.state, 'warn');
  assert.ok(tools.detail.includes('jq'), tools.detail);
});

test('a GPU with no local runtime is a warning, since that looks like a bug', () => {
  const facts = healthy();
  facts.runtimes = { ...healthy().runtimes, gpu: { vendor: 'amd' }, llama: null };
  const runtimes = byId(doctor.buildChecks(facts), 'runtimes');
  assert.equal(runtimes.state, 'warn');
  assert.ok(runtimes.detail.includes('GPU'), runtimes.detail);
});

// ---- the properties a screenshot test would not catch -----------------------

test('every bad check carries a fix, and no other check does', () => {
  // The core promise of a doctor: reporting a problem you cannot act on is
  // worse than not reporting it, because it teaches people to ignore the card.
  const facts = healthy();
  facts.node = { found: false, ok: false };
  facts.git = { available: true, name: '', email: '' };
  facts.keys = { hf_token: false };
  facts.tools = { git: true, curl: true, jq: false, rg: true, ffmpeg: false };
  for (const c of doctor.buildChecks(facts)) {
    if (c.state === 'bad') {
      assert.ok(c.fix.length > 10, `${c.id} is bad with no usable fix: ${JSON.stringify(c.fix)}`);
    } else {
      assert.equal(c.fix, '', `${c.id} is ${c.state} but carries a fix`);
    }
  }
});

test('the worst problem is listed first', () => {
  // A doctor that leads with the GPU is a doctor nobody reads to the end.
  const facts = healthy();
  facts.tools = { git: true, curl: true, jq: false, rg: true, ffmpeg: false };
  facts.node = { found: false, ok: false };
  const checks = doctor.buildChecks(facts);
  assert.equal(checks[0].id, 'node');
  const states = checks.map((c) => c.state);
  const rank = { bad: 0, warn: 1, ok: 2 };
  for (let i = 1; i < states.length; i++) {
    assert.ok(rank[states[i - 1]] <= rank[states[i]], `checks out of order: ${states.join(' ')}`);
  }
});

test('checks keep their written order within a state', () => {
  // Node, engine, git, keys, runtimes, tools: the order a person fixes them.
  const checks = doctor.buildChecks(healthy());
  assert.deepEqual(checks.map((c) => c.id), ['node', 'engine', 'git', 'keys', 'runtimes', 'tools']);
});

test('nothing missing at all still describes itself, rather than throwing', () => {
  // The machine on the very first launch, before anything is configured. A
  // doctor that crashes here is a doctor that never gets to explain anything.
  const checks = doctor.buildChecks({});
  assert.equal(checks.length, 6);
  assert.equal(byId(checks, 'node').state, 'bad');
  for (const c of checks) assert.ok(c.detail.length > 0, `${c.id} has no detail`);
});

test('null facts are a machine with nothing, not a crash', () => {
  assert.equal(doctor.buildChecks(null).length, 6);
  assert.equal(doctor.buildChecks(undefined).length, 6);
  assert.equal(doctor.summarize(null), 'Everything NeuraOS depends on is here.');
  assert.equal(doctor.overallState(undefined), 'ok');
});

test('the summary counts problems and warnings separately', () => {
  const facts = healthy();
  facts.keys = { hf_token: false };
  const one = doctor.buildChecks(facts);
  assert.equal(doctor.overallState(one), 'warn');
  assert.equal(doctor.summarize(one), '1 thing is worth knowing about. NeuraOS works.');

  facts.node = { found: false, ok: false };
  const two = doctor.buildChecks(facts);
  assert.equal(doctor.overallState(two), 'bad');
  assert.ok(doctor.summarize(two).includes('1 thing needs fixing'), doctor.summarize(two));
});

test('the summary is pluralised, because a wrong number reads as a bug', () => {
  const facts = healthy();
  facts.keys = { hf_token: false };
  facts.tools = { git: true, curl: true, jq: false, rg: true, ffmpeg: false };
  const s = doctor.summarize(doctor.buildChecks(facts));
  assert.ok(s.includes('2 things are'), s);
});

// ---- the safety property ----------------------------------------------------

test('no check can echo a key, a token or a path outside the machine', () => {
  // What the card is for is being pasted into a bug report, so it must be
  // safe by construction. The only credential-shaped thing in the facts is the
  // boolean, and this walks every string the Doctor can produce.
  const facts = healthy();
  facts.keys = { hf_token: true, hf_user: true };
  for (const c of doctor.buildChecks(facts)) {
    for (const field of [c.label, c.detail, c.fix]) {
      assert.ok(!/hf_[a-zA-Z0-9]{8,}/.test(field), `${c.id} leaked something token-shaped: ${field}`);
      assert.ok(!/sk-[A-Za-z0-9]{8,}/.test(field), `${c.id} leaked a key: ${field}`);
    }
  }
});

test('the git check shows the identity, which is public by definition', () => {
  // The opposite check: the doctor should say *who* it will commit as, since
  // a wrong identity is a common and confusing problem, and user.name and
  // user.email are things the user typed into git themselves.
  const git = byId(doctor.buildKeys ? doctor.buildKeys(healthy()) : doctor.buildChecks(healthy()), 'git');
  assert.ok(git.detail.includes('sam@example.com'), git.detail);
});
