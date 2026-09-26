/** C5: the Activity board's comparison of parallel worktree runs. */

export interface NumstatFile {
  path: string;
  add: number;
  del: number;
  /** Binary file: git reports no line counts. */
  binary?: boolean;
}

export interface ParallelEntry {
  /** The batch of tasks these runs were started together in. */
  batch: string;
  /** The open folder the worktrees were made from (an exact match filters). */
  root?: string;
  at: number;
  slug: string;
  branch: string;
  task: string;
  ms: number;
  status: string;
  merged?: boolean;
  files: NumstatFile[];
}

export interface CompareTotals {
  files: number;
  add: number;
  del: number;
}

export interface CompareColumn {
  slug: string;
  task: string;
  branch: string;
  status: string;
  merged: boolean;
  ms: number;
  totals: CompareTotals;
}

export interface CompareCell {
  add: number;
  del: number;
  binary: boolean;
}

export interface CompareRow {
  path: string;
  /** One slot per column, in order: null when that run left the file alone. */
  cells: (CompareCell | null)[];
  /** How many runs touched it — rows sort by this, collisions first. */
  by: number;
}

export interface CompareTable {
  columns: CompareColumn[];
  rows: CompareRow[];
  /** Rows touched by two or more runs. */
  overlap: number;
}

export interface CompareBatch {
  batch: string;
  at: number;
  runs: ParallelEntry[];
}

export declare const KEY: string;
export declare const CAP_ENTRIES: number;
export declare const MAX_FILES: number;

/** The shell line a run's numbers come from (git's machine-readable numstat). */
export declare function numstatCommand(): string;
/** `git diff --numstat` output -> files; unmatched lines are skipped, never guessed. */
export declare function parseNumstat(text: string): NumstatFile[];
/** A run's own score. */
export declare function totals(files: NumstatFile[]): CompareTotals;
/** Write one run's finish (whitelisted fields only); false without a store. */
export declare function record(entry: Partial<ParallelEntry> & { slug?: string }, storage?: any): boolean;
/** The Parallel screen pressed Merge on this run. */
export declare function markMerged(batch: string, slug: string, storage?: any): boolean;
/** The run was discarded; a merged run's record stays. */
export declare function remove(batch: string, slug: string, storage?: any): boolean;
/** Stored runs, newest first; with a folder, only that folder's. */
export declare function list(root?: string, storage?: any): ParallelEntry[];
/** Group a newest-first list into batches, newest batch first. */
export declare function batches(entries: ParallelEntry[]): CompareBatch[];
/** One column per run, one row per file, collisions sorted first. */
export declare function compare(runs: ParallelEntry[]): CompareTable;
/** Erase one folder's records (or everything, with no folder). */
export declare function clear(root?: string, storage?: any): boolean;
