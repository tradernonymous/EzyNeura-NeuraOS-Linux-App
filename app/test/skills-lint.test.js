// The skill linter (scripts/check-skills.mjs, docs/PC_UPGRADE_PLAN.md P4.5)
// runs on every SKILL.md the repository ships, and catches what it claims.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../../scripts/check-skills.mjs');

test('every shipped skill passes the linter', async () => {
  const { lint } = await load();
  const { count, findings } = lint();
  assert.deepEqual(findings, []);
  assert.ok(count >= 15, `${count} skills found`);
});

test('the linter catches a bad name, a long description, a dead link and a trigger collision', async () => {
  const { lintPack, triggers } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  const write = (folder, front, body = '# x\n') => {
    fs.mkdirSync(path.join(dir, folder));
    fs.writeFileSync(path.join(dir, folder, 'SKILL.md'), `---\n${front}\n---\n${body}`);
  };
  write('good-one', 'name: good-one\ndescription: Fix "disk full" and "inode" trouble.');
  write('Bad_Name', 'name: Bad_Name\ndescription: ' + 'x'.repeat(1100), '[dead](nowhere.md)\n');
  write('twin', 'name: twin\ndescription: Also "disk full" and "inode" trouble.');
  const findings = lintPack(dir);
  assert.ok(findings.some((f) => f.includes('not kebab-case')));
  assert.ok(findings.some((f) => f.includes('characters (max 1024)')));
  assert.ok(findings.some((f) => f.includes('does not resolve')));
  assert.ok(findings.some((f) => f.includes('share the triggers')));
  assert.deepEqual([...triggers('Se déclenche avec "Linux lent", "df", "dmesg".')], ['lent', 'df', 'dmesg']);
});
