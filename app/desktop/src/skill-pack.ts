/// <reference types="vite/client" />
// The Linux Mint pack (upgrade plan B10): the five Linux skills the PC plan
// wrote, bundled into the app at build time so a first run can offer them
// with no network at all. The source of truth stays pc/skills/linux-mint —
// these are ?raw imports of exactly those files, so the pack cannot drift
// from what scripts/check-skills.mjs lints in CI (a test pins that every
// folder is imported).
//
// Each entry is what hf-skills.js already understands: parsed frontmatter,
// `repo: bundled:…` provenance, and the raw text the installer writes
// through its textFor hook — no fetch, no layout guessing.
import bashScripting from '../../../pc/skills/linux-mint/bash-scripting/SKILL.md?raw';
import mintAdmin from '../../../pc/skills/linux-mint/mint-admin/SKILL.md?raw';
import mintHardening from '../../../pc/skills/linux-mint/mint-hardening/SKILL.md?raw';
import mintTroubleshooter from '../../../pc/skills/linux-mint/mint-troubleshooter/SKILL.md?raw';
import systemdManager from '../../../pc/skills/linux-mint/systemd-manager/SKILL.md?raw';
// UMD: loaded for its side effect, read off globalThis.
import './hf-skills.js';

const hfSkills: typeof import('./hf-skills.js') = (globalThis as any).FreeAI4UHfSkills;

/** One pack entry: installable through hf-skills.js with no network. */
export interface PackEntry {
  name: string;
  description: string;
  /** The SKILL.md body (frontmatter stripped). */
  content: string;
  /** The whole SKILL.md text — what textFor hands the installer to write. */
  text: string;
  repo: string;
  path: string;
  files: string[];
}

const RAW = [bashScripting, mintAdmin, mintHardening, mintTroubleshooter, systemdManager];

function entryFrom(text: string): PackEntry | null {
  const parsed = hfSkills.parseSkillMd(text);
  if (!parsed || !parsed.name) return null;
  return {
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    text,
    repo: 'bundled:linux-mint',
    path: 'SKILL.md',
    files: [],
  };
}

let cached: PackEntry[] | null = null;

/** The pack, parsed once. An empty array only if a bundled file will not parse. */
export function mintPack(): PackEntry[] {
  if (!cached) cached = RAW.map(entryFrom).filter((e): e is PackEntry => e !== null);
  return cached;
}

/** The folder names the pack installs to — what "installed" is counted against. */
export const MINT_PACK_NAMES = [
  'bash-scripting',
  'mint-admin',
  'mint-hardening',
  'mint-troubleshooter',
  'systemd-manager',
];
