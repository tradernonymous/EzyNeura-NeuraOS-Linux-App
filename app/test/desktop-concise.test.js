// B11 (upgrade plan): Concise mode is a toggle on the composer bar backed by
// a built-in meta skill — the skill text ships with the app, and the pill
// makes its line ride the chat's turns the way Plan mode's line does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builtIn = require('../desktop/src/built-in-skills.js');
const hfSkills = require('../desktop/src/hf-skills.js');
const lint = require('../desktop/src/skill-lint.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('the meta skill is a real SKILL.md the lint would accept on disk', () => {
  const parsed = hfSkills.parseSkillMd(builtIn.CONCISE.skillMd);
  assert.ok(parsed, 'the skill parses');
  assert.equal(parsed.name, 'concise-mode');
  assert.equal(builtIn.CONCISE.name, 'concise-mode');
  assert.match(builtIn.CONCISE.skillMd, /^---\nname: concise-mode\n/);
  const findings = lint.lintSkill({
    name: parsed.name,
    folderName: 'concise-mode',
    description: parsed.description,
    body: parsed.content,
    files: ['SKILL.md'],
  });
  assert.deepEqual(findings.errors, [], `installs clean: ${findings.errors.join('; ')}`);
});

test('the line is one paragraph that says what short means', () => {
  const line = builtIn.conciseLine();
  assert.ok(line.length > 80, 'a real instruction, not a label');
  assert.ok(!line.includes('\n'), 'one line: it is one system message');
  assert.match(line, /Lead with the result/);
  assert.match(line, /no preamble/i);
  assert.equal(line, builtIn.conciseLine(), 'stable text — a prompt that changes per call would be a different feature each turn');
});

test('the pill is on the composer bar and belongs to the chat', () => {
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chat, /concise\?: boolean;/, 'the flag lives on the session, so it saves with the chat');
  assert.match(chat, /patchSession\(active\.id, \{ concise: !active\.concise \}\)/, 'one click toggles');
  assert.match(chat, /className=\{`composer-pill \$\{active\.concise \? 'is-set' : ''\}`\}/, 'it looks like the other pills');
  assert.match(chat, /aria-pressed=\{!!active\.concise\}/);
});

test('when the pill is on, the line rides the turn as a system message', () => {
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chat, /import '\.\.\/built-in-skills\.js'/, 'the skill is loaded, not re-created in the screen');
  assert.match(chat, /if \(active\.concise\) \{\s*\n\s*turns\.unshift\(\{ role: 'system', content: builtIn\.conciseLine\(\) \}\);/,
    'same unshift shape as Plan mode, beside it');
});
