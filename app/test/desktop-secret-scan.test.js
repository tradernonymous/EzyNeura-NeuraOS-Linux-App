// D1 (upgrade plan): "Secrets never travel." The gate scans what was built —
// dist, the .deb, the AppImage — and fails on a token or key, reporting the
// file and the pattern name but never the matched text. This test plants a
// fake secret and runs the real script, so the redaction is behaviour, not
// a comment.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const SCRIPT = path.join(ROOT, 'scripts', 'check-dist-secrets.mjs');

const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
};

test('a planted secret fails the scan — and the report never contains it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  try {
    const token = 'hf_' + 'aB3'.repeat(12);
    fs.writeFileSync(path.join(dir, 'bundle.js'), `const endpoint = 'https://x.y';\nconst key = '${token}';\n`);
    const clean = run(['--dist', dir]);
    assert.equal(clean.code, 1, 'a real token fails the job');
    assert.match(clean.out, /Hugging Face token/, 'the pattern is named');
    assert.match(clean.out, /bundle\.js/, 'the file is named');
    assert.ok(!clean.out.includes(token), `the secret itself must not appear in logs: ${clean.out}`);

    fs.rmSync(path.join(dir, 'bundle.js'));
    const empty = run(['--dist', dir]);
    assert.equal(empty.code, 0, 'a clean tree passes');
    assert.match(empty.out, /no tokens or keys found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the patterns cover the providers the app can hold keys for', () => {
  const src = read('scripts', 'check-dist-secrets.mjs');
  for (const name of [
    'Hugging Face token', 'GitHub token', 'Slack token', 'AWS access key id',
    'Google API key', 'private key block', 'assigned secret',
  ]) assert.ok(src.includes(`'${name}'`), `pattern ${name} is checked`);
  // Public keys are not secrets: ssh-ed25519 and minisign must never trip it.
  assert.ok(!/ssh-ed25519/.test(src), 'no public-key pattern');
  assert.match(src, /never the match/, 'redaction is stated where hits are printed');
  assert.match(src, /h\.file\} — \$\{h\.pattern\}/, 'the report is file + pattern name only');
});

test('the gate runs in CI over dist and both bundles', () => {
  const wf = read('.github', 'workflows', 'desktop-build.yml');
  assert.match(wf, /Secrets never travel \(scan the built assets and bundles\)/);
  assert.match(wf, /check-dist-secrets\.mjs --dist app\/desktop\/dist/);
  assert.match(wf, /--deb '\S*bundle\/deb\/\*\.deb'/);
  assert.match(wf, /--appimage '\S*bundle\/appimage\/\*\.AppImage'/);
});
