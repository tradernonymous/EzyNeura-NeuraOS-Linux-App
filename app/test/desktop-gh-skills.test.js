// B1/B8 (upgrade plan): skills from any GitHub repository — a marketplace
// file or a plain <name>/SKILL.md layout — installed through the same
// hf-skills.js plan, lint and ceilings as an HF skill, with the skill's
// references/ folder beside it. gh-skills.js is pure around an injectable
// fetch; the pins keep the Library wired to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gh = require('../desktop/src/gh-skills.js');
const hfSkills = require('../desktop/src/hf-skills.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const SKILL_MD = [
  '---',
  'name: repo-skill',
  'description: Does a thing from a GitHub repository, with enough words to be a real description for the lint.',
  '---',
  '',
  'Use this skill when the thing needs doing. See [notes](references/notes.md).',
  '',
].join('\n');

/** fetch that answers by exact URL; anything else 404s. */
const fakeFetch = (routes) => async (url) => {
  const key = String(url);
  const hit = routes[key];
  if (hit === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  if (typeof hit === 'string') return { ok: true, status: 200, text: async () => hit, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => hit, text: async () => '' };
};

test('a repository is parsed with its host checked, and a branch can be named', () => {
  assert.deepEqual(gh.parseRepo('https://github.com/acme/skills'), { owner: 'acme', repo: 'skills', ref: '' });
  assert.deepEqual(gh.parseRepo('https://github.com/acme/skills/tree/main/sub'), { owner: 'acme', repo: 'skills', ref: '' });
  assert.deepEqual(gh.parseRepo('https://github.com/acme/skills.git'), { owner: 'acme', repo: 'skills', ref: '' });
  assert.deepEqual(gh.parseRepo('git@github.com:acme/skills.git'), { owner: 'acme', repo: 'skills', ref: '' });
  assert.deepEqual(gh.parseRepo('acme/skills'), { owner: 'acme', repo: 'skills', ref: '' });
  assert.deepEqual(gh.parseRepo('acme/skills#dev'), { owner: 'acme', repo: 'skills', ref: 'dev' });
  for (const bad of ['https://gitlab.com/a/b', 'ext::sh -c evil', '-u', 'https://github.com/a', 'a/b c', 'acme/skills#bad ref', '']) {
    assert.ok(gh.parseRepo(bad).error, `refuses ${JSON.stringify(bad)}`);
  }
});

test('raw URLs encode one segment at a time and never escape the base', () => {
  const base = gh.rawBase('acme', 'skills', 'dev');
  assert.equal(base, 'https://raw.githubusercontent.com/acme/skills/dev');
  assert.equal(gh.rawFileUrl(base, 'my skill/SKILL.md'), 'https://raw.githubusercontent.com/acme/skills/dev/my%20skill/SKILL.md');
  assert.equal(gh.rawFileUrl(base + '/', 'a/b.md'), 'https://raw.githubusercontent.com/acme/skills/dev/a/b.md');
});

test('a marketplace offers its plugins’ skills; junk is skipped, nothing usable is null', () => {
  const text = JSON.stringify({
    name: 'pack',
    plugins: [
      { name: 'one', skills: ['./skills/alpha', 'skills/beta/SKILL.md'] },
      { name: 'two', skills: [{ name: 'Gamma skill', path: 'gamma' }, {}, ''] },
    ],
  });
  assert.deepEqual(gh.parseMarketplace(text), [
    { name: 'one / alpha', dir: 'skills/alpha' },
    { name: 'one / beta', dir: 'skills/beta' },
    { name: 'Gamma skill', dir: 'gamma' },
  ]);
  assert.equal(gh.parseMarketplace('not json'), null);
  assert.equal(gh.parseMarketplace(JSON.stringify({ plugins: [] })), null);
  assert.equal(gh.parseMarketplace(JSON.stringify({ plugins: [{ name: 'x', skills: [''] }] })), null);
});

test('the plain layout is every SKILL.md in the tree, root included', () => {
  assert.deepEqual(gh.skillsInTree(['SKILL.md', 'b/SKILL.md', 'a/SKILL.md', 'a/README.md', 'x/y/SKILL.md']), [
    { name: 'SKILL.md', dir: '' },
    { name: 'a', dir: 'a' },
    { name: 'b', dir: 'b' },
    { name: 'y', dir: 'x/y' },
  ].sort((x, y) => (x.name < y.name ? -1 : 1)));
  // sorted by name: SKILL.md, a, b, y — 'S' < 'a' in ASCII.
  assert.deepEqual(gh.skillsInTree(['SKILL.md', 'a/SKILL.md']).map((b) => b.name), ['SKILL.md', 'a']);
});

test('references/ files ride along with their skill, relative to its folder', () => {
  assert.deepEqual(
    gh.referencesInTree(['a/references/notes.md', 'a/references/deep/more.md', 'b/references/x.md', 'a/SKILL.md'], 'a'),
    ['references/deep/more.md', 'references/notes.md'],
  );
  assert.deepEqual(gh.referencesInTree(['references/one.md', 'other/references/two.md'], ''), ['references/one.md']);
  assert.deepEqual(gh.referencesInTree(['a/refs/x.md'], 'a'), []);
});

test('discover reads one tree: marketplace first, plain layout after, bundles capped', async () => {
  const found = await gh.discover('https://github.com/acme/skills', fakeFetch({
    'https://api.github.com/repos/acme/skills': { default_branch: 'trunk' },
    'https://api.github.com/repos/acme/skills/git/trees/trunk?recursive=1': {
      tree: [
        { path: 'skills/alpha/SKILL.md', type: 'blob' },
        { path: 'skills/alpha/references/notes.md', type: 'blob' },
        { path: 'skills/alpha/references/deep/x.md', type: 'blob' },
        { path: 'skills/alpha/img/pic.png', type: 'blob' },
        { path: 'skills/alpha', type: 'tree' },
      ],
    },
  }));
  assert.equal(found.source, 'github:acme/skills');
  assert.equal(found.ref, 'trunk');
  assert.equal(found.rawBase, 'https://raw.githubusercontent.com/acme/skills/trunk');
  assert.deepEqual(found.bundles, [
    { name: 'alpha', dir: 'skills/alpha', references: ['references/deep/x.md', 'references/notes.md'] },
  ]);
});

test('a marketplace in the tree is what gets offered, and needs no layout guessing', async () => {
  const market = JSON.stringify({ plugins: [{ name: 'suite', skills: ['pack/one', 'pack/two'] }] });
  const found = await gh.discover('acme/suite', fakeFetch({
    'https://api.github.com/repos/acme/suite': { default_branch: 'main' },
    'https://api.github.com/repos/acme/suite/git/trees/main?recursive=1': {
      tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob' },
        { path: 'pack/one/SKILL.md', type: 'blob' },
        { path: 'pack/two/SKILL.md', type: 'blob' },
        { path: 'decoy/SKILL.md', type: 'blob' },
      ],
    },
    'https://raw.githubusercontent.com/acme/suite/main/.claude-plugin/marketplace.json': market,
  }));
  assert.deepEqual(found.bundles.map((b) => b.dir), ['pack/one', 'pack/two'], 'the marketplace decides, not the tree');
});

test('discover fails in words: no skills, rate limit, unknown repository', async () => {
  const none = await gh.discover('acme/empty', fakeFetch({
    'https://api.github.com/repos/acme/empty': { default_branch: 'main' },
    'https://api.github.com/repos/acme/empty/git/trees/main?recursive=1': { tree: [{ path: 'README.md', type: 'blob' }] },
  }));
  assert.match(none.error, /no SKILL\.md/);

  const limited = await gh.discover('acme/skills', async (url) => {
    if (String(url).includes('/repos/acme/skills')) return { ok: false, status: 403, json: async () => ({}), text: async () => '' };
    throw new Error('unreachable');
  });
  assert.match(limited.error, /rate limit/);

  const gone = await gh.discover('acme/skills', async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }));
  assert.match(gone.error, /not found/);

  assert.match((await gh.discover('not a repo', fakeFetch({}))).error, /github\.com URLs/);
  assert.match((await gh.discover('', fakeFetch({}))).error, /Paste a GitHub repository/);
});

test('toEntry carries provenance, rawBase and references into the install plan', () => {
  const found = {
    owner: 'acme', repo: 'skills', ref: 'trunk',
    rawBase: 'https://raw.githubusercontent.com/acme/skills/trunk',
    source: 'github:acme/skills',
    bundles: [],
  };
  const entry = gh.toEntry({ name: 'repo-skill', dir: 'skills/repo-skill', references: ['references/notes.md'] }, found, SKILL_MD);
  assert.equal(entry.name, 'repo-skill');
  assert.equal(entry.repo, 'github:acme/skills');
  assert.equal(entry.rawBase, found.rawBase);
  assert.equal(entry.path, 'skills/repo-skill/SKILL.md');
  assert.deepEqual(entry.files, ['references/notes.md']);
  // The plan hf-skills.js will write, references included.
  const plan = hfSkills.planInstall(entry);
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.files.map((f) => [f.repoPath, f.target]), [
    ['skills/repo-skill/SKILL.md', '.neuraos/skills/repo-skill/SKILL.md'],
    ['skills/repo-skill/references/notes.md', '.neuraos/skills/repo-skill/references/notes.md'],
  ]);
  assert.equal(gh.toEntry({ name: 'x', dir: 'x' }, found, 'not a skill'), null);
  assert.equal(gh.toEntry({ name: 'x', dir: 'x' }, found, null), null);
});

test('installing a GitHub entry fetches from raw base, within the same ceilings', async () => {
  const entry = {
    name: 'repo-skill',
    description: 'Does a thing from a GitHub repository, with enough words to be a real description for the lint.',
    content: 'Use this skill when the thing needs doing. See [notes](references/notes.md).',
    repo: 'github:acme/skills',
    rawBase: 'https://raw.githubusercontent.com/acme/skills/trunk',
    path: 'skills/repo-skill/SKILL.md',
    files: ['references/notes.md'],
  };
  const written = {};
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (String(url).endsWith('/skills/repo-skill/SKILL.md')) return { ok: true, text: async () => SKILL_MD };
    if (String(url).endsWith('/skills/repo-skill/references/notes.md')) return { ok: true, text: async () => 'the notes' };
    return { ok: false, status: 404, text: async () => '' };
  };
  const result = await hfSkills.installSkill(entry, {
    writeFile: async (p, t) => { written[p] = t; },
    fetchImpl,
  });
  assert.ok(seen.every((u) => u.startsWith('https://raw.githubusercontent.com/acme/skills/trunk/')), `fetched from raw base: ${seen}`);
  assert.deepEqual(Object.keys(written).sort(), [
    '.neuraos/skills/repo-skill/SKILL.md',
    '.neuraos/skills/repo-skill/references/notes.md',
  ]);
  assert.equal(written['.neuraos/skills/repo-skill/references/notes.md'], 'the notes');
  assert.equal(result.files.length, 2);

  // A missing file still fails with the file's name and its source.
  await assert.rejects(
    hfSkills.installSkill({ ...entry, files: ['references/notes.md', 'references/missing.md'] }, { writeFile: async () => {}, fetchImpl }),
    /Could not download .*references\/missing\.md from github:acme\/skills/,
  );
});

test('text the caller already holds wins over any fetch (the bundled pack)', async () => {
  const entry = {
    name: 'bundled',
    description: 'A skill the app ships with itself, described well enough to pass the install lint.',
    content: 'Use this skill when the bundled pack is wanted on this machine.',
    repo: 'bundled:linux-mint',
    path: 'bundled/SKILL.md',
    files: [],
  };
  const written = {};
  await hfSkills.installSkill(entry, {
    writeFile: async (p, t) => { written[p] = t; },
    textFor: (file) => (file.name === 'SKILL.md' ? SKILL_MD : null),
    fetchImpl: async () => { throw new Error('the network must never be touched'); },
  });
  assert.ok(written['.neuraos/skills/bundled/SKILL.md'], 'the bundled text was written');
});

test('the Library wears it: a GitHub row, the merged list, one install path', () => {
  const screen = read('desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.match(screen, /ghSkills\.discover\(input\)/);
  assert.match(screen, /ghSkills\.fetchText/);
  assert.match(screen, /ghSkills\.toEntry/);
  assert.match(screen, /\[\.\.\.hfCatalog, \.\.\.ghCatalog\]/, 'one list, one card, one install button');
  assert.match(screen, /import '\.\.\/gh-skills\.js'/);
  const css = read('desktop', 'src', 'index.css');
  assert.match(css, /\.gh-install input \{/);
});
