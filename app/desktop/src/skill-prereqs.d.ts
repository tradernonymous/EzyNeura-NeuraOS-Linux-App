/** What a skill needs before it can work (B7). */
export declare const KNOWN: Record<string, { apt: string | null; label: string; note?: string }>;

export interface PrereqInput {
  /** A `compatibility:` frontmatter value: a list, or a comma/space string. */
  frontmatter?: string[] | string;
  compatibility?: string[] | string;
  /** The SKILL.md body. */
  content?: string;
}
export interface ToolRecord {
  name: string;
  label: string;
  /** The apt line that installs it on Mint, when there is a safe one. */
  apt: string | null;
  note: string;
  /** 'node' when NeuraOS can install it itself; null otherwise. */
  runtime: 'node' | null;
  known: boolean;
}
export interface PrereqCheck {
  required: string[];
  present: ToolRecord[];
  missing: ToolRecord[];
}

/** The tool names a skill declares, from frontmatter and its Prerequisites section. */
export declare function prerequisites(skill: PrereqInput | null | undefined): string[];
export declare function describe(name: unknown): ToolRecord;
/** Checks each declared tool. `isPresent` is the caller's real PATH lookup. */
export declare function checkPrerequisites(
  skill: PrereqInput | null | undefined,
  isPresent: (tool: string) => boolean,
): PrereqCheck;
/** "apt install jq", or the one-click note, or '' when nothing can be said. */
export declare function installHint(record: ToolRecord | null | undefined): string;
/** The sentence naming what is missing, or '' when everything is present. */
export declare function missingWarning(missing: ToolRecord[] | null | undefined): string;
export declare function normalize(raw: unknown): string;
