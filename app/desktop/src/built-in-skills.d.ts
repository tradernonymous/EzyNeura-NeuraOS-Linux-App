/** The app's built-in meta skills (B11): text that ships with the app, never fetched. */

export interface BuiltInSkill {
  name: string;
  description: string;
  body: string;
  /** The full SKILL.md (frontmatter + body), as it would be written to disk. */
  skillMd: string;
}

export declare const CONCISE: BuiltInSkill;

/** The system line a turn carries while the composer's Concise pill is on. */
export declare function conciseLine(): string;
