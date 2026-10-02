// The deterministic design audit (scripts/design-audit.mjs, U46): six rules,
// each pinned here in both directions -- a violation is reported, and clean
// code stays clean -- so a rule change is a deliberate edit, not drift.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../scripts/design-audit.mjs');

test('hardcoded colours are flagged outside the token layer', async () => {
  const { auditText } = await load();
  const found = auditText('src/components/Card.tsx', 'const c = "#8B6CFF";');
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'token-color');
  const clean = auditText('src/theme.ts', 'const c = "#8B6CFF";');
  assert.equal(clean.length, 0);
});

test('sub-12px text is flagged, 12px and up is not', async () => {
  const { auditText } = await load();
  assert.equal(auditText('src/index.css', '.x{font-size: 10px}')[0].rule, 'tiny-font');
  assert.equal(auditText('src/index.css', '.x{font-size: 12px}').length, 0);
});

test('clickable divs need role and tabIndex, buttons do not', async () => {
  const { auditText } = await load();
  const bad = auditText('src/A.tsx', '<div onClick={go}>x</div>');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].rule, 'clickable');
  const ok = auditText('src/A.tsx', '<div onClick={go} role="button" tabIndex={0}>x</div>');
  assert.equal(ok.length, 0);
  const btn = auditText('src/A.tsx', '<button onClick={go}>x</button>');
  assert.equal(btn.length, 0);
});

test('images need alt, empty alt counts as a decision', async () => {
  const { auditText } = await load();
  assert.equal(auditText('src/A.tsx', '<img src="a.png">')[0].rule, 'img-alt');
  assert.equal(auditText('src/A.tsx', '<img src="a.png" alt="">').length, 0);
  assert.equal(auditText('src/A.tsx', '<img src="a.png" alt="logo">').length, 0);
});

test('!important is flagged outside the token layer', async () => {
  const { auditText } = await load();
  assert.equal(auditText('src/A.css', '.x{color:red !important}')[0].rule, 'important');
  assert.equal(auditText('src/tokens.css', '.x{color:red !important}').length, 0);
});
