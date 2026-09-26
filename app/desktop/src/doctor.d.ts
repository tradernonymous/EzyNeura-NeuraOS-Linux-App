/** The Doctor's verdicts (UMD, shared with node:test): facts in, rows out. */
export interface DoctorRow {
  id: string;
  title: string;
  /** ok: fine. warn: works, degraded. fail: broken. skip: not applicable here. */
  state: 'ok' | 'warn' | 'fail' | 'skip';
  /** What was found. */
  note: string;
  /** The command or the app setting that fixes it; '' when there is nothing to fix. */
  fix: string;
}

export interface DoctorFacts {
  shell?: boolean;
  node?: { found?: boolean; ok?: boolean; major?: number; path?: string; reason?: string } | null;
  engine?: { running?: boolean; port?: number; url?: string } | null;
  localModel?: { state?: string; repo?: string; file?: string; port?: number; detail?: string } | null;
  imageServer?: { found?: boolean; path?: string } | null;
  hfSignedIn?: boolean;
  byokKeys?: number;
  probe?: ProbeFacts | null;
  platform?: 'linux' | 'windows';
}

export interface ProbeFacts {
  tools: Record<string, boolean>;
  name: string;
  email: string;
  diskGb: number | null;
}

/** The one read-only shell line the doctor probes with. */
export declare function probeCommand(): string;
export declare function parseProbe(stdout: string | null | undefined): ProbeFacts;
export declare function verdicts(facts: DoctorFacts): DoctorRow[];
export declare function summary(rows: DoctorRow[]): string;
export declare function report(rows: DoctorRow[]): string;
