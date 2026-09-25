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

/**
 * Every `run:` body in a workflow, as the shell will see it. A `run:` one-liner
 * is its own body; a `run: |` block is the lines indented under it.
 */
function runBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].trim();
    if (inline && !inline.startsWith('|') && !inline.startsWith('>')) {
      out.push({ line: i + 1, body: inline, inline: true });
      continue;
    }
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') {
        body.push('');
        continue;
      }
      if (line.length - line.trimStart().length <= indent) break;
      body.push(line);
    }
    out.push({ line: i + 1, body: body.join('\n'), inline: false });
    i = j - 1;
  }
  return out;
}

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

test('every run: block in every workflow is valid shell', () => {
  // Two checks, because they catch different things.
  //
  // `bash -n` catches a block that is not shell at all. It is happy with
  // ${{ ... }} expressions, and it does not expand command substitutions, so
  // on its own it is not enough (see the second check).
  let checked = 0;
  for (const file of fs.readdirSync(workflows).filter((f) => f.endsWith('.yml'))) {
    for (const block of runBlocks(fs.readFileSync(path.join(workflows, file), 'utf8'))) {
      try {
        execFileSync('bash', ['-n'], { input: block.body, stdio: ['pipe', 'ignore', 'pipe'] });
      } catch (e) {
        assert.fail(`${file}:${block.line} is not valid shell:\n${block.body}\n${e.stderr || e.message}`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 10, `${checked} run: blocks checked`);
});

test('no run: one-liner hides a command substitution behind escaped quotes', () => {
  // This exists because of a real CI failure, and `bash -n` did NOT catch it:
  //
  //   run: echo "version=$(node -p \"require('./package.json').version\")" >> "$GITHUB_OUTPUT"
  //
  // In a plain YAML scalar `\"` has no meaning, so the backslashes reach the
  // shell literally, and bash only discovers the syntax error when it performs
  // the substitution at run time -- "syntax error near unexpected token '('",
  // on the runner, about a minute into the build. `bash -n` parses the line
  // fine because it defers substitutions, so the rule is about the shape
  // instead: a `run:` that interpolates `$(` is written as a block scalar,
  // where the shell sees the quoting the author actually typed.
  for (const file of fs.readdirSync(workflows).filter((f) => f.endsWith('.yml'))) {
    for (const block of runBlocks(fs.readFileSync(path.join(workflows, file), 'utf8'))) {
      if (block.inline && block.body.includes('$(')) {
        assert.fail(
          `${file}:${block.line} interpolates $( in a one-liner; use a block scalar (run: |):\n${block.body}`,
        );
      }
    }
  }
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

test('the budget holds an entry ceiling and per-chunk baselines, both from a real build', () => {
  // The entry (index.html + the entry chunk + its CSS) is what the first
  // window needs; the per-chunk baselines are what catches a lazy dependency
  // quietly doubling while the total still fits. Both are measured, and both
  // are keyed by the chunk name with Vite's hash groups stripped.
  const budget = JSON.parse(read('scripts', 'bundle-budget.json'));
  assert.ok(budget.entryBytes > 0, 'the first window has its own ceiling');
  assert.ok(budget.entryBytes < budget.totalBytes, 'the entry is a slice of the total');
  assert.equal(typeof budget.assetGrowth, 'object', 'growth tolerance is stated, not implied');
  assert.ok(budget.assetGrowth.ratio > 0 && budget.assetGrowth.bytes > 0);
  const assets = budget.assets || {};
  assert.ok(Object.keys(assets).length >= 5, `${Object.keys(assets).length} chunks recorded`);
  for (const key of Object.keys(assets)) {
    assert.doesNotMatch(key, /-[A-Za-z0-9_-]{6,}\.[a-z]+$/, `${key} is a stem, not a hashed filename`);
    assert.ok(assets[key] > 0, `${key} has a size`);
  }
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

test('a chunk that quietly doubles fails the gate; ordinary churn passes it', () => {
  // The per-chunk rule: a chunk may grow by the larger of 25% or 512 KB
  // before the gate asks for a deliberate re-record. The budget this runs
  // against is written by --write into a temp file (so the repo's own budget
  // is never clobbered by a test), then its total/asset ceilings are raised
  // so this test is about the growth rule alone and not the ceilings.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuraos-growth-'));
  const dist = path.join(dir, 'dist');
  const budgetFile = path.join(dir, 'budget.json');
  const run = (extra = []) =>
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-bundle-size.mjs'), '--dist', dist, '--budget', budgetFile, ...extra], { encoding: 'utf8' });
  try {
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    // A real-shaped entry chunk and one lazy chunk, both above the 100 KB
    // recording floor. Vite's hash on each name must not survive into keys.
    fs.writeFileSync(path.join(dist, 'assets', 'index-DMM81zh4.js'), Buffer.alloc(200 * 1024, 0x61));
    fs.writeFileSync(path.join(dist, 'assets', 'lazy-Zz99Yy88.js'), Buffer.alloc(150 * 1024, 0x62));
    run(['--write']);
    let recorded = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    assert.deepEqual(Object.keys(recorded.assets).sort(), ['index.js', 'lazy.js'], 'keys are hash-free stems');
    assert.ok(recorded.entryBytes > 200 * 1024, 'the entry is measured (html + entry chunk)');
    recorded.totalBytes = 64 * 1024 * 1024; // ceilings out of the way
    recorded.largestAssetBytes = 64 * 1024 * 1024;
    recorded.entryBytes = 64 * 1024 * 1024;
    fs.writeFileSync(budgetFile, JSON.stringify(recorded, null, 2));

    // Churn within tolerance: +200 KB on a 150 KB chunk is under the 512 KB floor.
    fs.writeFileSync(path.join(dist, 'assets', 'lazy-Zz99Yy88.js'), Buffer.alloc(350 * 1024, 0x62));
    assert.match(run(), /within budget/, 'ordinary churn passes');

    // Doubling: +600 KB is past the floor, so the growth rule fails and names it.
    fs.writeFileSync(path.join(dist, 'assets', 'lazy-Zz99Yy88.js'), Buffer.alloc(750 * 1024, 0x62));
    let failed = null;
    try {
      run();
    } catch (e) {
      failed = e;
    }
    assert.ok(failed, 'a chunk that doubles fails the gate');
    assert.match(String(failed.stderr), /the lazy\.js chunk grew from/, 'and says which chunk grew');

    // A deliberate re-record is the way out, and the gate passes after it.
    run(['--write']);
    assert.match(run(), /within budget/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the entry ceiling fails when the first window outgrows it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuraos-entry-'));
  const dist = path.join(dir, 'dist');
  const budgetFile = path.join(dir, 'budget.json');
  const run = (extra = []) =>
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-bundle-size.mjs'), '--dist', dist, '--budget', budgetFile, ...extra], { encoding: 'utf8' });
  try {
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-DMM81zh4.js'), Buffer.alloc(100 * 1024, 0x61));
    run(['--write']);
    const recorded = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    // Grow only the entry chunk; the per-chunk rule is loosened so the entry
    // check is the one this test is about.
    recorded.assetGrowth = { ratio: 10, bytes: 64 * 1024 * 1024 };
    fs.writeFileSync(budgetFile, JSON.stringify(recorded, null, 2));
    fs.writeFileSync(path.join(dist, 'assets', 'index-DMM81zh4.js'), Buffer.alloc(1024 * 1024, 0x61));
    let failed = null;
    try {
      run();
    } catch (e) {
      failed = e;
    }
    assert.ok(failed, 'an oversized entry fails the gate');
    assert.match(String(failed.stderr), /the entry \(first window\)/);
    assert.ok(recorded.entryBytes < 1024 * 1024, 'the ceiling it broke was the recorded one');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
