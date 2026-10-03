#!/usr/bin/env node
// Deterministic frontend design audit: the no-model half of the UI polish
// pass (U46, docs/UPGRADE_PLAN_03OCT.md, after pbakaus/impeccable's 61
// detector rules — Apache-2.0 — and in the same spirit as this repo's own
// check-skills.mjs: what a script can decide, a model should not be asked).
//
// Six rules, each cheap enough to run on every push, each pointing at a
// concrete fix. Nothing here judges taste; taste is U31/U32's human pass.
// Usage: node scripts/design-audit.mjs [dir ...]   (exit 1 on any finding)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DIRS = ['app/desktop/src'];

// Hex colours belong in the token layer, not scattered through components:
// theme.ts, the design tokens, and third-party assets are the allowlist.
const COLOR_ALLOW = /(^|\/)(theme\.ts|tokens\.css|tokens\.json|assets\/)/;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

// The a11y session raised the 9px text; keep it raised.
const TINY_FONT = /font-size\s*:\s*([0-9.]+)px/gi;

// A clickable div/span is a button wearing a disguise: keyboard and Orca
// users cannot reach it without a role and a tab stop.
const CLICKABLE_NO_ROLE = /<(div|span)([^>]*\bonClick=[^>]*)>/g;

// Images without alt text are holes in the Orca pass (decorative images
// say alt="" explicitly, which this rule accepts).
const IMG_NO_ALT = /<img(?![^>]*\balt=)[^>]*>/g;

// !important anywhere outside the token layer means the cascade stopped
// being the source of truth; the fix is a better selector, not a hammer.
const IMPORTANT = /!important/g;

export function auditText(rel, text) {
  const findings = [];
  const push = (line, rule, detail) => findings.push({ file: rel, line, rule, detail });
  const lines = text.split('\n');
  const isStyle = /\.(css|tsx|ts)$/.test(extname(rel)) || extname(rel) === '';
  lines.forEach((content, i) => {
    const line = i + 1;
    if (!isStyle) return;
    if (!COLOR_ALLOW.test(rel)) {
      const hexes = content.match(HEX);
      if (hexes) push(line, 'token-color', 'hardcoded ' + hexes[0] + ' — move to theme.ts/tokens');
    }
    let m;
    TINY_FONT.lastIndex = 0;
    while ((m = TINY_FONT.exec(content))) {
      if (parseFloat(m[1]) < 12) push(line, 'tiny-font', m[0] + ' — minimum is 12px');
    }
    if (IMPORTANT.test(content) && !COLOR_ALLOW.test(rel)) push(line, 'important', '!important — fix the selector instead');
  });
  // JSX structure rules only make sense in components.
  if (/\.tsx$/.test(rel)) {
    let m;
    CLICKABLE_NO_ROLE.lastIndex = 0;
    while ((m = CLICKABLE_NO_ROLE.exec(text))) {
      const tag = m[0];
      if (!/\brole=/.test(tag) || !/\btabIndex=/.test(tag)) {
        const at = text.slice(0, m.index).split('\n').length;
        push(at, 'clickable', '<' + m[1] + ' onClick without role + tabIndex — use a <button>');
      }
    }
    IMG_NO_ALT.lastIndex = 0;
    while ((m = IMG_NO_ALT.exec(text))) {
      const at = text.slice(0, m.index).split('\n').length;
      push(at, 'img-alt', '<img> without alt — decorative images say alt=\"\"');
    }
  }
  return findings;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== 'dist') walk(p, out); }
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

export function auditDirs(dirs, baseline) {
  let findings = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, [])) {
      findings = findings.concat(auditText(file.replace(ROOT + '/', ''), readFileSync(file, 'utf8')));
    }
  }
  return findings;
}

// Importing this module (node:test does) must not run the audit: only the
// CLI entry point below may exit the process.
const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  const dirs = (process.argv[2] ? process.argv.slice(2) : DEFAULT_DIRS).map((d) => resolve(ROOT, d));
  const findings = auditDirs(dirs);
  // The repo's own baseline, grandfathered so a new tree does not fail on the
  // first run for sins it inherited: every finding above this count fails.
  // Lower it as U31/U32 fixes land; the direction is down, never up.
  const BASELINE = parseInt(process.env.DESIGN_AUDIT_BASELINE || '0', 10);
  for (const f of findings) console.log(`${f.file}:${f.line} [${f.rule}] ${f.detail}`);
  console.log(`${findings.length} design-audit finding(s), baseline ${BASELINE}`);
  if (findings.length > BASELINE) {
    console.log('Above baseline: fix the findings or, if a rule is wrong, change the rule with a reason.');
    process.exit(1);
  }
}
