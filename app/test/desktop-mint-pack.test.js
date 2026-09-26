// B10 (upgrade plan): the five Linux Mint skills are bundled with the app and
// offered on the empty chat. The source of truth is pc/skills/linux-mint —
// skill-pack.ts imports those exact files (?raw), and this test walks the
// same ones: every skill parses, carries its folder as its name, and passes
// the B3 lint that gates the install, before any of it reaches a screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hfSkills = require('../desktop/src/hf-skills.js');
const lint = require('../desktop/src/skill-lint.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
// __dirname is app/test, so ROOT is app/; pc/ sits at the repository root.
const REPO = path.join(ROOT, '..');
const PACK_DIR = path.join(REPO, 'pc', 'skills', 'linux-mint');

const folders = fs.readdirSync(PACK_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

test('the pack is exactly the five Linux skills the plan named', () => {
  assert.deepEqual(folders, ['bash-scripting', 'mint-admin', 'mint-hardening', 'mint-troubleshooter', 'systemd-manager']);
});

test('every pack skill parses, owns its folder name, and passes the install lint', () => {
  const others = [];
  for (const name of folders) {
    const text = fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md'), 'utf8');
    const parsed = hfSkills.parseSkillMd(text);
    assert.ok(parsed, `${name}/SKILL.md parses`);
    assert.equal(parsed.name, name, `${name}: name is the folder`);
    const findings = lint.lintSkill({
      name: parsed.name,
      folderName: name,
      description: parsed.description,
      body: parsed.content,
      files: ['SKILL.md'],
      others,
    });
    assert.deepEqual(findings.errors, [], `${name} installs clean: ${findings.errors.join('; ')}`);
    others.push(parsed.description);
  }
  // Installed together, no two pack skills claim the same description (B4).
  const collisions = lint.lintRouting(others.map((description, i) => ({ name: folders[i], description })));
  assert.deepEqual(collisions, [], 'the pack routes without collisions');
});

test('skill-pack.ts imports every folder from pc/skills — the pack cannot drift', () => {
  const src = read('desktop', 'src', 'skill-pack.ts');
  for (const name of folders) {
    assert.ok(src.includes(`pc/skills/linux-mint/${name}/SKILL.md?raw`), `skill-pack imports ${name}`);
  }
  assert.match(src, /repo: 'bundled:linux-mint'/, 'provenance says bundled, not fetched');
  assert.match(src, /export function mintPack/);
  assert.match(src, /export const MINT_PACK_NAMES/);
  // The dev server must be allowed to serve the files (fs.allow).
  assert.match(read('desktop', 'vite.config.ts'), /'\.\.\/\.\.\/pc'/);
});

test('the offer is on the empty chat, installs through textFor, and can be dismissed', () => {
  const card = read('desktop', 'src', 'components', 'MintPackCard.tsx');
  assert.match(card, /textFor: \(file\) => \(file\.name === 'SKILL\.md' \? entry\.text : null\)/, 'no fetch: the bundled bytes are written');
  assert.match(card, /hfSkills\.rememberInstalled\(entry, result\)/, 'the record joins like any install');
  assert.match(card, /hfSkills\.installStatus\(s, records\)/, 'installed once is installed');
  assert.match(card, /writeLocalFile\(root, path, text\)/, 'into the open folder only');
  assert.match(card, /localStorage\.setItem\(DISMISS_KEY/, 'Not now lasts past this session');
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chat, /<MintPackCard root=\{openFolder\(\)\} \/>/, 'offered where the app begins');
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.first-run-offer', '.first-run-offer-title', '.first-run-offer-actions']) {
    assert.ok(css.includes(sel), `index.css has ${sel}`);
  }
});
