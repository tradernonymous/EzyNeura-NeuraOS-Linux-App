/** What a skill costs and whether it is worth installing (UMD, shared with node:test). */
export interface SkillLintFindings {
  /** Errors block the install. */
  errors: string[];
  /** Warnings are shown beside the install and never block. */
  warnings: string[];
}

export interface SkillLintInput {
  /** The raw SKILL.md; when present everything can be checked. */
  text?: string;
  name?: string;
  /** The folder the skill installs into (name must equal it). */
  folderName?: string;
  description?: string;
  body?: string;
  /** The files the skill says it ships (for link resolution). */
  files?: string[];
  /** Descriptions of already-installed skills (the duplicate rule). */
  others?: string[];
}

export interface RoutingCollision {
  a: string;
  b: string;
  shared: string[];
  generic: string[];
}

export interface PrereqRow {
  tool: string;
  found: boolean;
  /** The apt line for a missing tool, '' for one that is found. */
  fix: string;
}

export declare const MAX_DESC: number;
export declare const MAX_BODY_LINES: number;
/** The running total warns past this many tokens of every prompt. */
export declare const TOKEN_BUDGET: number;

export declare function parseSkill(text: string | null | undefined): { front: Record<string, string>; body: string } | null;
export declare function triggers(description: string | null | undefined): Set<string>;

export interface SkillCandidate {
  name: string;
  description: string;
  /** Trigger words weigh 3, the name 2, description words 1. */
  score: number;
  /** The draft's words that scored, for the chip's tooltip. */
  matched: string[];
}
/** The description's "do not use when…" sentence, or '' (B5, display only). */
export declare function negative(description: string | null | undefined): string;
/** The top skills a draft points at, best first; [] for a vague draft (B6). */
export declare function rankCandidates(
  draft: string | null | undefined,
  skills: Array<{ name?: string; description?: string } | null | undefined>,
  limit?: number,
): SkillCandidate[];
export declare function lintSkill(input: SkillLintInput): SkillLintFindings;
export declare function lintRouting(skills: Array<{ name: string; description: string }>): RoutingCollision[];
/** B4: one order-independent key for a collision pair (the written reason's handle). */
export declare function pairKey(a: string, b: string): string;
export declare function contextCost(skill: { name?: string; description?: string }): { tokens: number; chars: number };
export declare function catalogCost(
  skills: Array<{ name?: string; description?: string }>,
  budget?: number,
): { tokens: number; count: number; budget: number; over: boolean };
export declare function prereqTools(text: string | null | undefined): string[];
export declare function prereqReport(text: string | null | undefined, onPath: Set<string> | string[]): PrereqRow[];
export declare function toolFix(tool: string): string;
