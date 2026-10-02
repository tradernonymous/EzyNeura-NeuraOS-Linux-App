/** Judging a skill before installing it: context cost (B2) and lint (B3, B4, B5). */
export declare const MAX_DESCRIPTION: number;
export declare const MAX_BODY_LINES: number;
export declare const SHORT_DESCRIPTION: number;
export declare const KNOWN_KEYS: string[];

export interface SkillCost {
  name?: string;
  description?: string;
}
/** The tokens a skill adds to *every* prompt once installed. */
export declare function contextCostTokens(skill: SkillCost | null | undefined): number;
/** "~84 tokens" -- short enough to sit on an install button. */
export declare function contextCostLabel(tokens: number): string;
/** Where a running total sits against a budget: 'ok' | 'warn' | 'over'. */
export declare function contextBudgetStatus(total: number, budget?: number): 'ok' | 'warn' | 'over';

export interface ParsedFrontmatter {
  /** Every key as written, in order, so an unknown one is visible. */
  keys: string[];
  name: string;
  description: string;
  body: string;
  raw: string;
  /** A description (or other value) folded onto a second line. */
  descriptionMultiline: boolean;
}
export declare function parseFrontmatter(text: unknown): ParsedFrontmatter | null;

export interface InstalledSkillSummary {
  name?: string;
  description?: string;
}
export interface LintResult {
  /** These stop the install: the skill does not work. */
  errors: string[];
  /** These do not: the skill installs, but may never be chosen. */
  warnings: string[];
  parsed: ParsedFrontmatter | null;
}
export interface LintOptions {
  /** The folder it will install into, to check the name against. */
  folder?: string;
  /** Already on this machine, to catch a duplicate description. */
  installed?: InstalledSkillSummary[];
  /** Whether a repo-relative path this skill links to exists. Omit to skip. */
  hasFile?: (repoPath: string) => boolean;
}
export declare function lintSkill(text: unknown, opts?: LintOptions): LintResult;

export interface CatalogueEntry extends SkillCost {
  /** The SKILL.md text, if the caller has it; `content` is accepted too. */
  text?: string;
  content?: string;
}
export interface LintCatalogueOptions {
  folderFor?: (entry: CatalogueEntry) => string | undefined;
  installed?: InstalledSkillSummary[];
  hasFileFor?: (entry: CatalogueEntry) => ((repoPath: string) => boolean) | undefined;
}
export interface NamedLintResult {
  name: string;
  errors: string[];
  warnings: string[];
}
/** Lints a whole catalogue, including the two rules that need more than one skill. */
export declare function lintSkills(list: CatalogueEntry[], opts?: LintCatalogueOptions): NamedLintResult[];

/** The words in quotes in a description, minus the ones that decide nothing. */
export declare function triggers(description: unknown): string[];
/** The triggers two descriptions share, which is what makes them compete (B4). */
export declare function sharedTriggers(a: unknown, b: unknown): string[];
/** The "Do not use when ..." clause of a description, or '' (B5). */
export declare function negativeTriggers(description: unknown): string;
