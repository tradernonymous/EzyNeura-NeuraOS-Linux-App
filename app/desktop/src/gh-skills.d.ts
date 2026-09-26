/** Skills from any GitHub repository (upgrade plan B1) with references (B8). */

export interface GhRepo {
  owner: string;
  repo: string;
  /** Branch or tag; '' means the repository's default branch. */
  ref: string;
}

export interface GhBundle {
  name: string;
  /** The skill's folder inside the repo; '' for a SKILL.md at the root. */
  dir: string;
  /** Paths relative to the skill folder, under its references/ (B8). */
  references?: string[];
}

export interface GhFound {
  owner: string;
  repo: string;
  ref: string;
  /** Every file is fetched from here (raw.githubusercontent.com/<o>/<r>/<ref>). */
  rawBase: string;
  /** 'github:owner/repo' — the install record's provenance and error words. */
  source: string;
  bundles: GhBundle[];
}

export interface GhEntry {
  name: string;
  description: string;
  content: string;
  /** References relative to the skill folder (B8); carried into the lint. */
  files: string[];
  repo: string;
  rawBase: string;
  /** SKILL.md's path inside the repo. */
  path: string;
  source: string;
  ref: string;
}

/** owner/repo, a github.com URL, or git@github.com:owner/repo — host checked. */
export declare function parseRepo(input: string): (GhRepo & { error?: undefined }) | { error: string };

export declare function treeUrl(owner: string, repo: string, ref?: string): string;
export declare function rawBase(owner: string, repo: string, ref?: string): string;
export declare function rawFileUrl(base: string, relPath: string): string;
export declare function parseTree(json: unknown): string[];
export declare function parseMarketplace(text: string): GhBundle[] | null;
export declare function skillsInTree(paths: string[]): GhBundle[];
export declare function referencesInTree(paths: string[], dir: string): string[];

/** One tree call: marketplace or plain layout, plus every references/ file. */
export declare function discover(input: string, fetchImpl?: typeof fetch): Promise<GhFound | { error: string }>;

/** Raw text or null. */
export declare function fetchText(url: string, fetchImpl?: typeof fetch): Promise<string | null>;

/** The install entry hf-skills.js understands, or null when SKILL.md will not parse. */
export declare function toEntry(bundle: GhBundle, found: GhFound, text: string | null): GhEntry | null;

export declare const MAX_BUNDLES: number;
