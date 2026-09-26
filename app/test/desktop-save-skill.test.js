// B12 (upgrade plan): a finished chat becomes a SKILL.md in .neuraos/skills,
// through the same B3 lint an install passes. B4: two installed skills that
// claim the same triggers are flagged in Library, and keeping both takes a
// written reason. save-as-skill.js and skill-lint.js are pure; the pins keep
// the Library wired to them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const save = require('../desktop/src/save-as-skill.js');
const lint = require('../desktop/src/skill-lint.js');
const hfSkills = require('../desktop/src/hf-skills.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const chat = (title, messages) => ({ id: 'c1', title, messages });
const say = (role, content) => ({ role, content });

const LONG_ASK = 'How do I rotate the logs on this Mint box without losing the last lines of the running service?';

test('the slug is one kebab-case segment the lint will accept as a name', () => {
  assert.equal(save.slugFrom('Fix the SSH config!'), 'fix-the-ssh-config');
  assert.equal(save.slugFrom('  Ünïcode and…dots  '), 'n-code-and-dots');
  assert.equal(save.slugFrom('---keep---this---'), 'keep-this');
  assert.equal(save.slugFrom('a'.repeat(100)).length <= 64, true);
  assert.equal(save.slugFrom('   '), '');
  assert.match(save.slugFrom('Mixed CASE 42'), /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('only real turns become skill text: no notes, no shell echoes, no empty', () => {
  const turns = save.turnsOf(chat('t', [
    say('user', 'hello'),
    { role: 'assistant', content: 'note text', note: true },
    { role: 'user', content: 'ls -la', shell: true },
    say('assistant', '   '),
    say('assistant', 'hi'),
  ]));
  assert.deepEqual(turns, [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }]);
  assert.deepEqual(save.turnsOf({ messages: 'nope' }), []);
});

test('build: ask becomes the description, exchange becomes the body, lint decides', () => {
  const built = save.build(chat('Rotate the logs', [
    say('user', LONG_ASK),
    say('assistant', 'Use `journalctl --vacuum-time=14d`; the service keeps running.'),
    say('user', 'and for the .log files?'),
    say('assistant', 'logrotate runs daily from /etc/logrotate.conf.'),
  ]));
  assert.ok(!('error' in built), JSON.stringify(built));
  assert.equal(built.slug, 'rotate-the-logs');
  assert.equal(built.name, built.slug, 'name is the folder, as B3 requires');
  assert.equal(built.description, LONG_ASK, 'the first ask, collapsed to one line');
  assert.match(built.body, /^# Rotate the logs/);
  assert.match(built.body, /## The ask/);
  assert.match(built.body, /### Ask\n\nHow do I rotate/);
  assert.match(built.body, /logrotate runs daily/);

  // The rendered file parses back into exactly what was linted.
  const text = save.render(built);
  const parsed = hfSkills.parseSkillMd(text);
  assert.equal(parsed.name, built.slug);
  assert.equal(parsed.description, built.description);
  assert.equal(parsed.content.trim(), built.body.trim());
  const findings = lint.lintSkill({
    name: parsed.name, folderName: built.slug, description: parsed.description,
    body: parsed.content, files: ['SKILL.md'],
  });
  assert.deepEqual(findings.errors, [], 'what we render passes the gate we already have');
});

test('build refuses what the lint refuses — a saved skill rides in every prompt', () => {
  assert.match(save.build(chat('x', [say('assistant', 'no question here')])).error, /no question/);
  // Two chats with the same ask: the duplicate-description rule fires.
  const first = save.build(chat('One', [say('user', LONG_ASK), say('assistant', 'done')]));
  const second = save.build(
    chat('Two', [say('user', LONG_ASK), say('assistant', 'done differently')]),
    { others: [first.description] },
  );
  assert.match(second.error, /Not saved: /);
  assert.match(second.error, /word for word/);
});

test('the body is capped, so a long chat still fits the lint', () => {
  const many = [];
  for (let i = 0; i < 60; i += 1) {
    many.push(say('user', `question ${i} ` + 'x'.repeat(4000)));
    many.push(say('assistant', `answer ${i} ` + 'y'.repeat(4000)));
  }
  const built = save.build(chat('Big chat', [say('user', LONG_ASK), ...many]));
  assert.ok(!('error' in built), JSON.stringify(built).slice(0, 200));
  assert.ok(built.body.split('\n').length <= save.MAX_BODY_LINES, 'under the line cap');
  const findings = lint.lintSkill({
    name: built.slug, folderName: built.slug, description: built.description,
    body: built.body, files: ['SKILL.md'],
  });
  assert.deepEqual(findings.errors, [], 'the caps keep it installable');
});

test('B4: collisions are found, and one key names a pair however it was found', () => {
  const a = { name: 'alpha', description: 'Handles "disk full" and "no space" situations on this PC.' };
  const b = { name: 'beta', description: 'Deals with "no space" and "disk full" by cleaning up.' };
  const rows = [a, b, { name: 'gamma', description: 'Turns screenshots into SVG diagrams of a page.' }];
  const collisions = lint.lintRouting(rows);
  assert.equal(collisions.length, 1);
  assert.deepEqual([collisions[0].a, collisions[0].b], ['alpha', 'beta']);
  assert.ok(collisions[0].shared.includes('disk') && collisions[0].shared.includes('space'),
    `the words they fight over: ${collisions[0].shared.join(', ')}`);
  assert.equal(lint.pairKey('alpha', 'beta'), lint.pairKey('beta', 'alpha'), 'one handle for the pair');
  assert.notEqual(lint.pairKey('alpha', 'beta'), lint.pairKey('alpha', 'gamma'));
});

test('the Library wears both: the reason box, the save button, the lint in between', () => {
  const screen = read('desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.match(screen, /skillLint\.lintRouting\(rows\)/, 'B4 flags the pair');
  assert.match(screen, /skillLint\.pairKey\(c\.a, c\.b\)/);
  assert.match(screen, /Why keep both\? \(a written reason\)/, 'B4 keeps only with a reason');
  assert.match(screen, /keepReasons\(next\)/, 'the reason is persisted');
  assert.match(screen, /saveSkill\.build\(/, 'B12 builds before it writes');
  assert.match(screen, /'error' in built/, 'the lint gate is honoured');
  assert.match(screen, /saveSkill\.render\(built\)/);
  assert.match(screen, /Save as skill/);
  assert.match(screen, /hfSkills\.rememberInstalled\(/, 'the saved skill joins the record');
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.skill-routing', '.skill-warn', '.skill-reason']) assert.ok(css.includes(sel), `index.css has ${sel}`);
});
