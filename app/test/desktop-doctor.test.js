// The Doctor (upgrade plan D6): one screen that checks everything NeuraOS
// depends on and, for every failure, says the fix. doctor.js is pure (facts
// in, rows out); the pins keep the card in Settings and the probe read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const doctor = require('../desktop/src/doctor.js');

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

/** A machine where everything the doctor probes is present and passing. */
const healthy = () => ({
  shell: true,
  platform: 'linux',
  node: { found: true, ok: true, major: 24, path: '/home/u/.neuranos/node/bin/node' },
  engine: { running: true, port: 8787, url: 'http://127.0.0.1:8787' },
  localModel: { state: 'off' },
  imageServer: { found: false },
  hfSignedIn: true,
  byokKeys: 1,
  probe: {
    tools: { git: true, xdotool: true, bwrap: true, docker: false, podman: false },
    name: 'A User',
    email: 'a@example.com',
    diskGb: 120,
  },
});

test('the probe is one read-only line: presence, config reads, free space', () => {
  const cmd = doctor.probeCommand();
  assert.match(cmd, /command -v/, 'presence is checked with command -v');
  assert.match(cmd, /git config --get user\.name/, 'the identity is read, never written');
  assert.match(cmd, /git config --get user\.email/);
  assert.match(cmd, /\bdf\b/, 'free space comes from df');
  // Nothing that writes, moves, downloads or deletes. The probe may redirect
  // to /dev/null; after stripping those, no redirection may remain.
  const stripped = cmd.replace(/\d?>\/?dev\/null/g, '').replace(/\d?>&\d/g, '');
  assert.ok(!/[<>]/.test(stripped), `probe only redirects to /dev/null: ${stripped}`);
  for (const bad of [/\brm\b/, /\bmv\b/, /\bchmod\b/, /\bcurl\b/, /\bwget\b/, /\bapt(-get)?\s+install\b/, /git config(?! --get)/]) {
    assert.ok(!bad.test(cmd), `probe must not contain ${bad}`);
  }
});

test('the probe output parses, and unknown lines are tolerated', () => {
  const parsed = doctor.parseProbe(
    ['tool:git=yes', 'tool:xdotool=no', 'tool:bwrap=yes', 'tool:docker=no', 'tool:podman=no',
     'name:Jack', 'email:jack@example.com', 'disk:42', 'noise:whatever', '', 'no colon here'].join('\n'),
  );
  assert.deepEqual(parsed.tools, { git: true, xdotool: false, bwrap: true, docker: false, podman: false });
  assert.equal(parsed.name, 'Jack');
  assert.equal(parsed.email, 'jack@example.com');
  assert.equal(parsed.diskGb, 42);
  // A missing value and a nonsense disk figure do not throw.
  const empty = doctor.parseProbe(null);
  assert.deepEqual(empty.tools, {});
  assert.equal(empty.diskGb, null);
  assert.equal(doctor.parseProbe('disk:soon').diskGb, null);
});

test('a healthy machine has no failures and nothing to fix', () => {
  const rows = doctor.verdicts(healthy());
  const bad = rows.filter((r) => r.state === 'fail' || r.state === 'warn');
  assert.deepEqual(bad, [], `nothing failing or warning, got ${JSON.stringify(bad)}`);
  assert.ok(rows.every((r) => r.fix === ''), 'passing checks prescribe nothing');
  assert.equal(doctor.summary(rows), 'Everything checked passes.');
});

test('every row has the same shape: what, verdict, found, fix', () => {
  for (const facts of [healthy(), {}, { shell: false }]) {
    for (const r of doctor.verdicts(facts)) {
      assert.equal(typeof r.id, 'string');
      assert.equal(typeof r.title, 'string');
      assert.ok(['ok', 'warn', 'fail', 'skip'].includes(r.state), `${r.id} state`);
      assert.equal(typeof r.note, 'string');
      assert.equal(typeof r.fix, 'string');
    }
  }
  // Ten checks, always, in a stable order — a doctor that loses a row silently is worse than none.
  assert.deepEqual(doctor.verdicts({}).map((r) => r.id),
    ['engine', 'node', 'git', 'sandbox', 'xdotool', 'hf', 'keys', 'model', 'image', 'disk']);
});

test('engine down and Node missing fail with the exact fix', () => {
  const rows = byId(doctor.verdicts({
    shell: true,
    node: { found: false },
    engine: { running: false },
    probe: null,
  }));
  assert.equal(rows.engine.state, 'fail');
  assert.match(rows.engine.fix, /Settings → Engine/);
  assert.equal(rows.node.state, 'fail');
  assert.match(rows.node.fix, /Node 24/);
});

test('a Node too old says the version it needs and where to get it', () => {
  const rows = byId(doctor.verdicts({ shell: true, node: { found: true, ok: false, major: 18, reason: 'Node 18 is too old' } }));
  assert.equal(rows.node.state, 'fail');
  assert.match(rows.node.note, /too old/);
  assert.match(rows.node.fix, /Node 24/);
});

test('git identity: unset and half-set both fail with the two config commands', () => {
  const unset = byId(doctor.verdicts({ shell: true, platform: 'linux', probe: { tools: {}, name: '', email: '', diskGb: null } }));
  assert.equal(unset.git.state, 'fail');
  assert.match(unset.git.fix, /git config --global user\.name/);
  assert.match(unset.git.fix, /git config --global user\.email/);

  const half = byId(doctor.verdicts({ shell: true, platform: 'linux', probe: { tools: {}, name: 'Jack', email: '', diskGb: null } }));
  assert.equal(half.git.state, 'fail');
  assert.match(half.git.note, /Half set/);

  const set = byId(doctor.verdicts(healthy()));
  assert.equal(set.git.state, 'ok');
  assert.equal(set.git.fix, '');
});

test('the sandbox prefers bubblewrap, accepts a container, warns on nothing', () => {
  const withBwrap = byId(doctor.verdicts(healthy()));
  assert.equal(withBwrap.sandbox.state, 'ok');
  assert.match(withBwrap.sandbox.note, /bubblewrap/);

  const container = byId(doctor.verdicts({
    shell: true, platform: 'linux',
    probe: { tools: { docker: true, podman: false, bwrap: false }, name: 'a', email: 'b', diskGb: 10 },
  }));
  assert.equal(container.sandbox.state, 'ok');
  assert.match(container.sandbox.note, /Docker/);

  const none = byId(doctor.verdicts({
    shell: true, platform: 'linux',
    probe: { tools: { docker: false, podman: false, bwrap: false }, name: 'a', email: 'b', diskGb: 10 },
  }));
  assert.equal(none.sandbox.state, 'warn');
  assert.equal(none.sandbox.fix, 'sudo apt install bubblewrap');
});

test('xdotool missing warns with the apt line; present is ok', () => {
  const facts = { shell: true, platform: 'linux', probe: { tools: { xdotool: false }, name: 'a', email: 'b', diskGb: 10 } };
  const rows = byId(doctor.verdicts(facts));
  assert.equal(rows.xdotool.state, 'warn');
  assert.equal(rows.xdotool.fix, 'sudo apt install xdotool');
  assert.equal(byId(doctor.verdicts(healthy())).xdotool.state, 'ok');
});

test('signed out is a warn that names where to sign in; keys are optional', () => {
  const rows = byId(doctor.verdicts({ ...healthy(), hfSignedIn: false, byokKeys: 0 }));
  assert.equal(rows.hf.state, 'warn');
  assert.match(rows.hf.fix, /Sign in to Hugging Face/);
  assert.equal(rows.keys.state, 'skip', 'no own keys is not a fault');
  assert.match(rows.keys.note, /free tiers need none/);
});

test('optional servers: absent skips, broken fails, ready is ok', () => {
  const absent = byId(doctor.verdicts(healthy()));
  assert.equal(absent.model.state, 'skip');
  assert.equal(absent.image.state, 'skip');

  const broken = byId(doctor.verdicts({ ...healthy(), localModel: { state: 'error', detail: 'port in use' } }));
  assert.equal(broken.model.state, 'fail');
  assert.match(broken.model.note, /port in use/);
  assert.match(broken.model.fix, /Settings → Local models/);

  const ready = byId(doctor.verdicts({
    ...healthy(),
    localModel: { state: 'ready', repo: 'Qwen/Qwen2.5-0.5B-Instruct', port: 8080 },
    imageServer: { found: true, path: '/home/u/sd-server' },
  }));
  assert.equal(ready.model.state, 'ok');
  assert.match(ready.model.note, /8080/);
  assert.equal(ready.image.state, 'ok');
});

test('disk space fails under 5 GB, warns under 20, ok above', () => {
  const at = (gb) => byId(doctor.verdicts({ ...healthy(), probe: { ...healthy().probe, diskGb: gb } })).disk;
  assert.equal(at(3).state, 'fail');
  assert.match(at(3).fix, /Free up space/);
  assert.equal(at(12).state, 'warn');
  assert.equal(at(120).state, 'ok');
  assert.equal(at(null).state, 'skip');
});

test('a browser build skips every shell check instead of failing it', () => {
  const rows = byId(doctor.verdicts({ shell: false }));
  for (const id of ['engine', 'node', 'git', 'sandbox', 'xdotool', 'disk']) {
    assert.equal(rows[id].state, 'skip', `${id} skips without a shell`);
  }
  assert.equal(rows.hf.state, 'warn', 'no shell does not hide the HF check');
});

test('windows skips the POSIX probes but still checks the engine', () => {
  const rows = byId(doctor.verdicts({ shell: true, platform: 'windows' }));
  for (const id of ['git', 'sandbox', 'xdotool']) assert.equal(rows[id].state, 'skip', `${id} skipped on windows`);
  assert.equal(rows.engine.state, 'fail', 'the engine is still checked');
});

test('summary counts what needs fixing; the report marks and prescribes', () => {
  const rows = doctor.verdicts({ shell: true, node: { found: false }, engine: { running: false }, probe: null });
  const fails = rows.filter((r) => r.state === 'fail').length;
  assert.ok(fails >= 2);
  assert.match(doctor.summary(rows), /to fix/);
  assert.equal(doctor.summary(doctor.verdicts(healthy())), 'Everything checked passes.');

  const text = doctor.report(rows);
  assert.match(text, /FAIL {2}Bundled engine/);
  assert.match(text, /fix: Settings → Engine/);
  // The report is built from rows only — there is no field that could carry a key.
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['fix', 'id', 'note', 'state', 'title']);
});

test('the screen wears it: card in Settings, Doctor in System, wide, styled', () => {
  const card = read('desktop', 'src', 'components', 'DoctorCard.tsx');
  assert.match(card, /doctor\.verdicts\(/, 'the card renders the pure verdicts');
  assert.match(card, /doctor\.probeCommand\(\)/, 'the probe comes from doctor.js');
  assert.match(card, /doctor\.report\(rows\)/, 'Copy report sends the same rows');
  assert.match(card, /hasShell\(\)/, 'no shell, no probe');

  const settings = read('desktop', 'src', 'screens', 'SettingsScreen.tsx');
  assert.match(settings, /<DoctorCard \/>/);
  assert.match(settings, /import DoctorCard from '\.\.\/components\/DoctorCard'/);

  const groups = require('../desktop/src/settings-groups.js');
  const system = groups.GROUPS.find((g) => g.id === 'system');
  assert.ok(system.sections.includes('Doctor'), 'Doctor has a group');
  assert.equal(groups.groupOf('Doctor'), 'system');
  assert.equal(groups.isWide('Doctor'), true, 'rows list, not a value card');

  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.doctor-rows', '.doctor-row', '.doctor-dot', '.doctor-state', '.doctor-fix']) {
    assert.ok(css.includes(sel + ' {'), `index.css has ${sel}`);
  }
});
