/** Settings backup and restore (UMD, shared with node:test). */
export interface SettingsBackup {
  version: number;
  at: string;
  values: Record<string, string>;
  skippedSecrets: string[];
}
export interface BackupImportResult {
  restored: string[];
  skipped: string[];
  errors: string[];
}
export declare const VERSION: number;
export declare const KNOWN_KEYS: string[];
export declare function denied(key: unknown): boolean;
export declare function exportBackup(store: {
  getItem(k: string): string | null;
  keys?(): string[];
  length?: number;
  key?(i: number): string | null;
}): SettingsBackup;
export declare function importBackup(
  doc: unknown,
  store: { setItem(k: string, v: string): void },
): BackupImportResult;
