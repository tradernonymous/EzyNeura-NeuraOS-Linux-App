// B5/B6/B9 (upgrade plan): the card shows the description's own "Do not use
// when…"; the composer ranks the top three installed candidates for the
// draft; Library renders each installed SKILL.md as a searchable, offline
// manual page. The two scoring functions are pure — the pins keep the
// screens wired to them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lint = require('../desktop/src/skill-lint.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('the description negative is found, sentence by sentence', () => {
  const found = lint.negative('Use when a disk is full. Do not use when the files are on a network drive.');
  assert.match(found, /Do not use when the files are on a network drive/);
  assert.equal(lint.negative('A skill that helps with backups and restores.'), '', 'no negative, no line');
  assert.match(lint.negative('Helps with CSV files. Never use for files over 100 MB.'), /Never use for files over 100 MB/);
  assert.match(lint.negative("Don't use with root."), /Don't use with root/);
  assert.match(lint.negative('For personal scripts, not for production services.'), /not for production services/);
  assert.equal(lint.negative(''), '');
  assert.equal(lint.negative(null), '');
  // One line, not a paragraph.
  assert.ok(lint.negative('Do not use when ' + 'x. '.repeat(200)).length <= 240);
});

test('the composer preview ranks the skills the draft points at', () => {
  const skills = [
    { name: 'disk-doctor', description: 'Fixes a full disk. Use when "disk full" or "no space left".' },
    { name: 'git-helper', description: 'Helps with git. Use when "merge conflict" or "rebase".' },
    { name: 'pdf-editor', description: 'Edits PDF forms.' },
  ];
  const picks = lint.rankCandidates('my disk is full and there is no space left on the drive', skills, 3);
  assert.ok(picks.length >= 1, 'a matching draft ranks something');
  assert.equal(picks[0].name, 'disk-doctor', 'the quoted triggers win');
  assert.ok(picks[0].score > 0 && picks[0].matched.length > 0, 'the match is explained');
  // Ordering: best first.
  for (let i = 1; i < picks.length; i += 1) assert.ok(picks[i - 1].score >= picks[i].score);
  assert.equal(lint.rankCandidates('short', skills, 3).length, 0, 'a vague draft shows nothing');
  assert.equal(lint.rankCandidates('something entirely different here', skills, 3).length, 0);
  assert.equal(lint.rankCandidates('merge conflict in my rebase right now', skills, 1).length, 1, 'limit is honoured');
  assert.equal(lint.rankCandidates('there is a merge conflict blocking the rebase', [null, {}], 3).length, 0, 'bad rows are skipped');
});

test('the Library card shows the negative and the manuals read the files', () => {
  const lib = read('app', 'desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.match(lib, /skillLint\.negative\(s\.description\)/, 'B5: the catalogue card shows it');
  assert.match(lib, /skillLint\.negative\(r\.description\)/, 'B9: the installed row shows it too');
  assert.match(lib, /openManual/, 'B9: a manual opens');
  assert.match(lib, /readLocalFile\(localRoot, dir \+ '\/SKILL\.md'\)/, 'from the open folder');
  assert.match(lib, /renderMarkdown\(manual\.text\)/, 'rendered as a readable page');
  assert.match(lib, /Search the installed skills — offline/, 'and the catalogue is searchable');
});

test('the composer previews the top candidates while the draft is written', () => {
  const composer = read('app', 'desktop', 'src', 'components', 'Composer.tsx');
  assert.match(composer, /rankCandidates\(value, rows, 3\)/, 'ranks the draft');
  assert.match(composer, /skillPicks\.length > 0/, 'shows only when there is something to show');
  assert.match(composer, /if \(sending \|\| menuKind\)/, 'not while a turn runs or a menu is open');
  assert.match(composer, /Would answer this:/, 'the row says what it is');
});

test('the pure functions and their types are exported', () => {
  assert.equal(typeof lint.negative, 'function');
  assert.equal(typeof lint.rankCandidates, 'function');
  const dts = read('app', 'desktop', 'src', 'skill-lint.d.ts');
  assert.ok(dts.includes('negative'), 'negative is typed');
  assert.ok(dts.includes('rankCandidates'), 'rankCandidates is typed');
  assert.ok(dts.includes('SkillCandidate'), 'the candidate row is typed');
});
