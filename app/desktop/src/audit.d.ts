/** C12: the approval audit log, kept where the model's tools cannot reach. */

export interface AuditEntry {
  at: number;
  /** The tool that asked (run_command, write_file, …). */
  tool: string;
  /** The card's human summary — never the raw arguments (they may hold secrets). */
  summary: string;
  decision: 'allowed' | 'denied' | 'edited' | 'always' | 'stopped' | string;
  /** The folder the decision belonged to; '' for none. */
  project: string;
}

export interface AuditStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export declare const KEY: string;
export declare const MAX: number;

export declare function read(storage?: AuditStore | null): AuditEntry[];
/** Append one decision; the oldest fall off past MAX. Returns the stored row (or null with no tool). */
export declare function record(entry: Partial<AuditEntry>, storage?: AuditStore | null): AuditEntry | null;
/** Newest first. */
export declare function recent(storage?: AuditStore | null, limit?: number): AuditEntry[];
/** The decision in words: 'allowed, edited', 'always allowed', … */
export declare function wordFor(decision: string): string;
