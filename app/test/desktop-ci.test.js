// The build chain itself (the perf/reliability foundation phase).
//
// What this pins, and why each one is worth a test:
//
//   - the gate and the release call ONE build, so they cannot drift. It had
//     already happened: three copies of the same steps, of which only the gate
//     ran the skill lint and only the release could pass with clippy red.
//   - the gates are real. clippy is `-D warnings` with no continue-on-error,
//     because "reported, not enforced" is how a lint rots into no lint at all.
//   - Cargo.lock is committed and the build is --locked, so the .deb people
//     install is the one this tree describes.
//   - the frontend has a size ceiling, because it is embedded in the binary.
//
// The bundle checker is exercised against a temporary dist rather than the
// real one: the real build needs more memory than a test run should assume,
// and the checker's whole job is the comparison, which a fake tree proves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const workflows = path.join(ROOT, '.github', 'workflows');

test('the gate and the release build the app the same way, in one place', () => {
  const gate = fs.readFileSync(path.join(workflows, 'linux.yml'), 'utf8');
  const release = fs.readFileSync(path.join(workflows, 'release.yml'), 'utf8');
  const shared = path.join('.github', 'workflows', 'desktop-build.yml');
  assert.ok(fs.existsSync(path.join(workflows, 'desktop-build.yml')), 'the shared build exists');
  assert.match(gate, /uses: \.\/\.github\/workflows\/desktop-build\.yml/);
  assert.match(release, /uses: \.\/\.github\/workflows\/desktop-build\.yml/);

  // Neither caller may grow its own build again. Each of these was a line in
  // the copies that drifted; if one reappears, it is a second implementation.
  // release.yml may install dependencies once, for `tauri signer` alone -- it
  // needs that CLI and nothing else, and it runs no postinstall.
  for (const step of [/cargo/, /tauri build/, /npx tsc/, /vite build/, /node --test/]) {
    assert.doesNotMatch(release, step, `release.yml calls the shared build instead of running ${step} itself`);
    assert.doesNotMatch(gate, step, `linux.yml calls the shared build instead of running ${step} itself`);
  }
  assert.doesNotMatch(gate, /npm ci/, 'linux.yml installs nothing of its own');
  assert.doesNotMatch(
    release.replace(/npm ci --ignore-scripts/, ''),
    /npm ci/,
    'the only npm install in release.yml is the one for the signer',
  );
});

test('the checks that were reported instead of enforced are now gates', () => {
  const build = fs.readFileSync(path.join(workflows, 'desktop-build.yml'), 'utf8');
  // clippy, as a gate: -D warnings, and not soft-failed anywhere. Matched as a
  // YAML key, so the prose above it can still explain what used to be there.
  assert.match(build, /cargo clippy .*--all-targets -- -D warnings/);
  assert.doesNotMatch(build, /^\s*continue-on-error:/m, 'no step in the build is soft-failed');
  // The lockfile makes both rust invocations reproducible.
  assert.match(build, /cargo test --locked/);
  assert.match(build, /cargo clippy --locked/);
  // Dependency audits on both ecosystems, the tests, and the skill lint.
  assert.match(build, /npm audit --audit-level=high/);
  assert.match(build, /cargo audit/);
  assert.match(build, /node --test/);
  assert.match(build, /scripts\/check-skills\.mjs/);
  assert.match(build, /npx tsc --noEmit/);
  // rustfmt stays reported rather than enforced: the imported tree is not
  // formatted, and reformatting it wholesale would fight every sync-upstream.
  assert.match(build, /cargo fmt .*--check/);
  // And the built binary has to start a window, not just link.
  assert.match(build, /scripts\/screenshot-smoke-test\.sh/);
});

test('actions are pinned to commit SHAs, so a moved tag cannot change a release build', () => {
  // Every workflow, not just the build chain: a policy with one exception is
  // the drift this phase exists to remove. The Rust toolchain itself stays a
  // moving selector on purpose (see desktop-build.yml) -- it is the action that
  // is pinned, not the compiler it installs.
  for (const file of ['linux.yml', 'release.yml', 'desktop-build.yml', 'screenshots.yml']) {
    const text = fs.readFileSync(path.join(workflows, file), 'utf8');
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0, `${file} uses some actions`);
    for (const ref of uses) {
      // A local path (./.github/workflows/...) is a file, not an action.
      if (ref.startsWith('./')) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${file}: ${ref} is pinned to a full commit SHA`);
    }
  }
});

test('Cargo.lock is committed, so a build is reproducible from this tree', () => {
  const ignore = read('.gitignore');
  assert.doesNotMatch(ignore, /^\s*app\/desktop\/src-tauri\/Cargo\.lock\s*$/m, 'the lockfile is not ignored');
  assert.ok(
    fs.existsSync(path.join(ROOT, 'app', 'desktop', 'src-tauri', 'Cargo.lock')),
    'the lockfile is in the tree',
  );
});

test('the frontend has a size ceiling, and the build checks it', () => {
  const build = fs.readFileSync(path.join(workflows, 'desktop-build.yml'), 'utf8');
  assert.match(build, /scripts\/check-bundle-size\.mjs/, 'the gate runs the size check');
  const budget = JSON.parse(read('scripts', 'bundle-budget.json'));
  assert.ok(budget.totalBytes > 0 && budget.largestAssetBytes > 0, 'both limits are set');
  assert.ok(
    budget.largestAssetBytes <= budget.totalBytes,
    'the largest-asset limit is meaningful under the total',
  );
  assert.ok(typeof budget.note === 'string' && budget.note.length > 0, 'the ceiling says why it is what it is');
});

test('the build asks for the heap it needs, instead of dying at Node’s default', () => {
  // Monaco (986 ESM modules) and mermaid are both lazy at runtime but must be
  // transformed at build time, which overruns Node's default heap on a small
  // machine. The flag is passed to node directly, not as a shell env prefix,
  // so the same script works on Windows, where upstream still builds.
  const pkg = JSON.parse(read('app', 'desktop', 'package.json'));
  assert.match(pkg.scripts.build, /--max-old-space-size=\d+/, 'the build sets its own heap');
  assert.doesNotMatch(pkg.scripts.build, /NODE_OPTIONS=/, 'not a shell prefix: Windows builds this too');
});

test('the bundle checker passes a tree in budget and fails one over it', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'neuraos-dist-'));
  const budget = JSON.parse(read('scripts', 'bundle-budget.json'));
  const run = () =>
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-bundle-size.mjs'), '--dist', dist], {
      encoding: 'utf8',
    });
  try {
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'x'.repeat(1024));
    assert.match(run(), /within budget/);

    // One asset over the largest-asset ceiling fails, and says which file.
    fs.writeFileSync(path.join(dist, 'assets', 'runaway.js'), Buffer.alloc(budget.largestAssetBytes + 1024, 0x61));
    let failed = null;
    try {
      run();
    } catch (e) {
      failed = e;
    }
    assert.ok(failed, 'an oversized asset fails the gate');
    assert.match(String(failed.stderr), /runaway\.js/);
    assert.match(String(failed.stderr), /over budget/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
