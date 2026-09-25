// The skill rules the install flow runs before a byte lands (upgrade plan
// B2/B3/B4/B7): the context cost of a skill, the lint (the same rules
// scripts/check-skills.mjs enforces on this repo's own packs), routing
// collisions between two skills, and the tools a skill needs with the apt
// line for each. skill-lint.js is pure; hf-skills.js must refuse to install
// what the lint rejects; the screen must show the price.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lint = require('../desktop/src/skill-lint.js');
const hfSkills = require('../desktop/src/hf-skills.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const goodSkill = {
  name: 'disk-doctor',
  folderName: 'disk-doctor',
  description: 'Frees disk space when the "disk full" warning appears. Use when "no space left" shows.',
  body: '## Steps\n\n1. `df -h`\n2. Clean the cache.\n',
};

test('a good skill passes the lint with no findings at all', () => {
  const findings = lint.lintSkill(goodSkill);
  assert.deepEqual(findings.errors, []);
  assert.deepEqual(findings.warnings, []);
});

test('the lint blocks what check-skills.mjs would fail on this repo for', () => {
  const parsed = lint.lintSkill({ ...goodSkill, name: 'Disk Doctor' });
  assert.ok(parsed.errors.some((e) => /not kebab-case/.test(e)), 'name must be kebab-case');
  const named = lint.lintSkill({ ...goodSkill, name: 'disk-doctor', folderName: 'other-folder' });
  assert.ok(named.errors.some((e) => /not the folder name/.test(e)), 'name must equal the folder');
  const long = lint.lintSkill({ ...goodSkill, description: 'x'.repeat(1100) });
  assert.ok(long.errors.some((e) => /max 1024/.test(e)));
  const empty = lint.lintSkill({ ...goodSkill, body: '' });
  assert.ok(empty.errors.some((e) => /body is empty/.test(e)));
  const huge = lint.lintSkill({ ...goodSkill, body: Array.from({ length: 501 }, (_, i) => 'line ' + i).join('\n') });
  assert.ok(huge.errors.some((e) => /max 500/.test(e)));
  const duplicate = lint.lintSkill({ ...goodSkill, others: [goodSkill.description] });
  assert.ok(duplicate.errors.some((e) => /word for word/.test(e)), 'a duplicate description blocks');
});

test('raw text: missing frontmatter and unknown keys are findings', () => {
  assert.ok(lint.lintSkill({ text: 'no frontmatter here' }).errors.some((e) => /frontmatter/.test(e)));
  const unknown = lint.lintSkill({
    text: '---\nname: disk-doctor\ndescription: "disk full" and "no space left" here, long enough to pass\nmystery-key: 1\n---\nBody.\n',
  });
  assert.ok(unknown.errors.some((e) => /unknown frontmatter key "mystery-key"/.test(e)));
});

test('a dead relative link blocks when the file list says it is dead', () => {
  const skill = { ...goodSkill, body: 'See [the guide](references/guide.md) and [the site](https://example.com).', files: ['references/other.md'] };
  const findings = lint.lintSkill(skill);
  assert.ok(findings.errors.some((e) => /references\/guide\.md/.test(e)), 'the dead link is named');
  assert.ok(!findings.errors.some((e) => /example\.com/.test(e)), 'an absolute link is not checked');
});

test('warnings warn without blocking: a short description, no quoted trigger', () => {
  const findings = lint.lintSkill({ ...goodSkill, description: 'Cleans disks.' });
  assert.deepEqual(findings.errors, []);
  assert.ok(findings.warnings.some((w) => /description is short/.test(w)));
  assert.ok(findings.warnings.some((w) => /no quoted trigger/.test(w)));
});

test('the context cost is (name + description) / 4 + 12, and the total warns past the budget', () => {
  const cost = lint.contextCost(goodSkill);
  assert.equal(cost.tokens, Math.ceil((goodSkill.name.length + goodSkill.description.length) / 4) + 12);
  const small = lint.catalogCost([goodSkill]);
  assert.equal(small.over, false);
  const many = lint.catalogCost(Array.from({ length: 40 }, (_, i) => ({ name: 'skill-' + i, description: 'x'.repeat(200) })));
  assert.equal(many.over, true, 'the running total knows when it is over budget');
  assert.equal(many.budget, lint.TOKEN_BUDGET);
});

test('two skills with the same triggers are flagged as a routing collision', () => {
  const rows = [
    { name: 'a', description: 'Handles "disk full" and "no space left".' },
    { name: 'b', description: 'Handles "disk full" and "no space left" differently.' },
    { name: 'c', description: 'Handles "memory leak" and "oom".' },
  ];
  const collisions = lint.lintRouting(rows);
  assert.equal(collisions.length, 1);
  assert.deepEqual([collisions[0].a, collisions[0].b], ['a', 'b']);
  assert.deepEqual(collisions[0].shared, ['disk', 'full', 'left', 'space'], 'the words they fight over, sorted');
});

test('the prerequisite doctor names tools and the apt line for each missing one', () => {
  const text = '---\nname: disk-doctor\ndescription: "disk full" and "no space left" here, long enough\nrequires: `rg`, `jq`, ffmpeg\n---\n## Prerequisites\n\n- `fd`\n- `xclip`\n';
  assert.deepEqual(lint.prereqTools(text), ['rg', 'jq', 'ffmpeg', 'fd', 'xclip']);
  const report = lint.prereqReport(text, new Set(['rg', 'fd']));
  assert.deepEqual(report.map((r) => [r.tool, r.found]), [
    ['rg', true], ['jq', false], ['ffmpeg', false], ['fd', true], ['xclip', false],
  ]);
  const jq = report.find((r) => r.tool === 'jq');
  assert.equal(jq.fix, 'sudo apt install jq');
  assert.equal(lint.toolFix('rg'), 'sudo apt install ripgrep', 'the fix names the package, not the binary');
  assert.equal(lint.toolFix('fd'), 'sudo apt install fd-find');
});

test('installing a skill the lint rejects writes nothing at all', async () => {
  const written = [];
  const skill = {
    name: 'Not Kebab',
    repo: 'someone/skills',
    path: 'not-kebab/SKILL.md',
    description: 'A description long enough to clear the short-description warning.',
    content: '## Steps\n\nDo things.\n',
  };
  await assert.rejects(
    hfSkills.installSkill(skill, {
      writeFile: async (p) => written.push(p),
      fetchImpl: async () => ({ ok: true, text: async () => 'x' }),
    }),
    /Refused: .*kebab-case/,
  );
  assert.deepEqual(written, [], 'the writer was never called');
});

test('installing drops .ps1 on request and gives bundled .sh the exec bit', async () => {
  const written = [];
  const execd = [];
  const skill = {
    name: 'disk-doctor',
    repo: 'someone/skills',
    path: 'disk-doctor/SKILL.md',
    description: 'Frees disk space when the "disk full" warning appears.',
    content: '## Steps\n\nDo things.\n',
    files: ['scripts/clean.sh', 'scripts/clean.ps1'],
  };
  const result = await hfSkills.installSkill(skill, {
    writeFile: async (p, text) => written.push([p, text]),
    markExecutable: async (p) => execd.push(p),
    skipPowerShell: true,
    fetchImpl: async (url) => ({ ok: true, text: async () => 'fetched ' + url }),
  });
  assert.deepEqual(written.map(([p]) => p), [
    '.neuraos/skills/disk-doctor/SKILL.md',
    '.neuraos/skills/disk-doctor/scripts/clean.sh',
  ], 'the .ps1 was dropped');
  assert.deepEqual(execd, ['.neuraos/skills/disk-doctor/scripts/clean.sh'], 'the .sh arrives executable');
  assert.equal(result.files.length, 2);
});

test('the screen wears it: the price on the button, the lint blocking, the running total', () => {
  const screen = read('desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.match(screen, /skillLint\.contextCost\(s\)/, 'each row shows what it costs');
  assert.match(screen, /~\{cost\.tokens\} tok/, 'the cost is on the button row');
  assert.match(screen, /disabled=\{busy \|\| !localRoot \|\| blocked\}/, 'lint errors block the install');
  assert.match(screen, /skillLint\.catalogCost\(/, 'the running total is shown');
  assert.match(screen, /skillLint\.prereqTools\(/, 'the tools a skill needs are listed');
  assert.match(screen, /skipPowerShell: isLinux\(\)/, '.ps1 files are dropped on Linux');
  assert.match(screen, /markExecutable:/, 'bundled .sh files get the exec bit');
});
