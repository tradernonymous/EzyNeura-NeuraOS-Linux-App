/** Save a finished chat as a SKILL.md, through the B3 lint first (UMD). */

export interface SaveChat {
  title?: string;
  messages: Array<{
    role: string;
    content: string;
    note?: boolean;
    shell?: boolean;
  }>;
}

export interface BuiltSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
  /** Lint warnings that did not block the save. */
  warnings: string[];
}

export interface BuildOpts {
  /** Descriptions of installed skills, for the lint's duplicate rule. */
  others?: string[];
}

/** The folder: kebab-case, one segment, at most 64 characters. */
export declare function slugFrom(title: string | undefined, fallback?: string): string;

/** The chat's real turns: user and assistant only, no notes or shell lines. */
export declare function turnsOf(chat: SaveChat): Array<{ role: string; text: string }>;

/** Build the skill, lint-gated; `{ error }` with the reason when refused. */
export declare function build(chat: SaveChat, opts?: BuildOpts): BuiltSkill | { error: string };

/** The SKILL.md text: frontmatter, then the body. */
export declare function render(skill: Partial<BuiltSkill>): string;

export declare const MAX_DESC: number;
export declare const MAX_BODY_LINES: number;
