/** The Doctor: one pass over everything NeuraOS depends on (D6). */
export declare const OK: 'ok';
export declare const WARN: 'warn';
export declare const BAD: 'bad';

/** The facts src-tauri/src/doctor.rs gathers. Nothing here is ever a secret. */
export interface DoctorFacts {
  version?: string;
  os?: string;
  arch?: string;
  node?: { found?: boolean; ok?: boolean; path?: string; major?: number; reason?: string };
  engine?: {
    running?: boolean;
    port?: number;
    service?: { available?: boolean; enabled?: boolean; active?: boolean; unit?: string; port?: number };
  };
  runtimes?: { node?: unknown; llama?: unknown; gpu?: unknown; dir?: string; min_node_major?: number };
  sd?: { found?: boolean; binary?: string; model?: string };
  git?: { available?: boolean; name?: string; email?: string };
  /** Presence only. The values never leave the keyring. */
  keys?: { hf_token?: boolean; hf_user?: boolean };
  tools?: Record<string, boolean>;
  paths?: { data_dir?: string; log_path?: string };
}

export type CheckState = 'ok' | 'warn' | 'bad';

export interface DoctorCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  /** Set only on 'bad': what to actually do about it. */
  fix: string;
}

/** Every check, worst first. */
export declare function buildChecks(facts: DoctorFacts | null | undefined): DoctorCheck[];
/** The one line at the top of the card. */
export declare function summarize(checks: DoctorCheck[] | null | undefined): string;
/** 'bad' if anything is bad, else 'warn', else 'ok'. */
export declare function overallState(checks: DoctorCheck[] | null | undefined): CheckState;
