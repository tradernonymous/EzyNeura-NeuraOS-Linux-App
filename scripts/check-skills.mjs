#!/usr/bin/env node
// Lint every SKILL.md this repository ships (docs/PC_UPGRADE_PLAN.md P4.5):
// the repo's own skills in .claude/skills/ and the packs for a PC under
// pc/skills/. The limits follow the Claude Code skills reference and the
// checks claude-skills-collection runs on its 348 skills:
//   - frontmatter with name and description
//   - name in kebab-case and equal to the folder name
//   - description on one line, at most 1024 characters
//   - body at most 500 lines
//   - relative links and ${CLAUDE_SKILL_DIR} paths resolve
//   - no two skills in one pack share two or more trigger words
// Usage: node scripts/check-skills.mjs [dir ...]   (exit 1 on any finding)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DIRS = ['.claude/skills', 'pc/skills/linux-mint', 'pc/skills/pc-ops'];
const MAX_DESC = 1024;
const MAX_BODY_LINES = 500;
// Words that decide nothing on their own; a trigger made only of these is no trigger.
const GENERIC = new Set(['linux', 'pc', 'machine', 'server', 'system', 'help', 'fix', 'check', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'this', 'when', 'use', 'run', 'my', 'me', 'i', 'is', 'are', 'it', 'what', 'whats', 'how', 'why', 'can', 'do', 'does', 'show', 'going', 'everything', 'something', 'wrong', 'ok', 'up', 'down', 'keeps', 'should', 'need', 'needed', 'am', 'was', 'before', 'after', 'now', 'all', 'some', 'any', 'get', 'set', 'add', 'make', 'new', 'no', 'not']);

function skillDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md')));
}

export function parseSkill(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const front = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv && !line.startsWith(' ')) { key = kv[1]; front[key] = kv[2]; }
    else if (key && /^\s+\S/.test(line)) front[key] += ' ' + line.trim();
  }
  return { front, body: m[2] };
}

/** Words in quotes in a description are its triggers ("disk full", "systemctl"). */
export function triggers(description) {
  const out = new Set();
  for (const q of description.matchAll(/["“]([^"”]{2,40})["”]/g)) {
    for (const w of q[1].toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9+]+/)) if (w && !GENERIC.has(w)) out.add(w);
  }
  return out;
}

export function lintSkill(path) {
  const findings = [];
  const folder = basename(dirname(path));
  const text = readFileSync(path, 'utf8');
  const parsed = parseSkill(text);
  if (!parsed) return [`${path}: no frontmatter block`];
  const { front, body } = parsed;
  if (!front.name) findings.push(`${path}: frontmatter has no name`);
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(front.name)) findings.push(`${path}: name "${front.name}" is not kebab-case`);
    if (front.name !== folder) findings.push(`${path}: name "${front.name}" is not the folder name "${folder}"`);
  }
  if (!front.description) findings.push(`${path}: frontmatter has no description`);
  else {
    if (front.description.length > MAX_DESC) findings.push(`${path}: description is ${front.description.length} characters (max ${MAX_DESC})`);
    if (/^description:.*\n\s+\S/m.test(text.split('\n---')[0])) findings.push(`${path}: description spans more than one line`);
  }
  const lines = body.split(/\r?\n/).length;
  if (lines > MAX_BODY_LINES) findings.push(`${path}: body is ${lines} lines (max ${MAX_BODY_LINES})`);
  for (const link of body.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
    const target = join(dirname(path), link[1].split('#')[0]);
    if (!existsSync(target)) findings.push(`${path}: link to ${link[1]} does not resolve`);
  }
  for (const ref of body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^\s`'")]+)/g)) {
    if (!existsSync(join(dirname(path), ref[1]))) findings.push(`${path}: \${CLAUDE_SKILL_DIR}/${ref[1]} does not exist`);
  }
  return findings;
}

/** Every pack listed here is installed into one ~/.claude/skills, so their triggers must not collide across packs either. */
export const TOGETHER = ['pc/skills/linux-mint', 'pc/skills/pc-ops'];

export function lintPack(dir) {
  return lintDirs([dir]);
}

export function lintDirs(dirs) {
  const findings = [];
  const seen = [];
  for (const skill of dirs.flatMap(skillDirs)) {
    const path = join(skill, 'SKILL.md');
    findings.push(...lintSkill(path));
    const parsed = parseSkill(readFileSync(path, 'utf8'));
    if (parsed?.front.description) seen.push({ path, words: triggers(parsed.front.description) });
  }
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const shared = [...seen[i].words].filter((w) => seen[j].words.has(w));
      if (shared.length >= 2) findings.push(`${seen[i].path} and ${seen[j].path} share the triggers ${shared.join(', ')}: the router cannot tell them apart`);
    }
  }
  return findings;
}

export function lint(dirs = DEFAULT_DIRS) {
  const findings = [];
  let count = 0;
  for (const dir of dirs) {
    const abs = resolve(ROOT, dir);
    count += skillDirs(abs).length;
    findings.push(...lintPack(abs));
  }
  // The packs that share one install folder, checked as one (only the collisions are new here).
  const together = TOGETHER.filter((d) => dirs.includes(d)).map((d) => resolve(ROOT, d));
  if (together.length > 1) findings.push(...lintDirs(together).filter((f) => f.includes('share the triggers') && !findings.includes(f)));
  return { count, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { count, findings } = lint(process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_DIRS);
  for (const f of findings) console.error(f);
  console.log(`${count} skills checked, ${findings.length} findings`);
  process.exit(findings.length ? 1 : 0);
}
