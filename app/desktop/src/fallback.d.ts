/** The smart provider-fallback policy (UMD, shared with node:test). */
export interface FallbackAttempt {
  provider: string;
  model: string;
  label: string;
  why: string;
}

export interface FallbackPlan {
  attempts: FallbackAttempt[];
  automatic: boolean;
  note: string;
}

export declare function plan(input: {
  failure?: { kind?: string };
  provider?: string;
  model?: string;
  next?: string;
  local?: { baseUrl?: string; model?: string; ready?: boolean } | null;
}): FallbackPlan;

export declare const SWITCHABLE: string[];
export declare const MAX_ATTEMPTS: number;

// C4: the same model's own retry, before any switching.
export declare const RETRIES: number;
/** Milliseconds before retry `attempt` (0-based): 1000, 2000, 4000… capped. */
export declare function backoff(attempt: number): number;
/** "2s" — what the steps fold prints for a backoff(). */
export declare function waitLabel(ms: number): string;
/** True while `attempt` retries of the same model are still allowed. */
export declare function retryable(failure: { kind?: string } | null | undefined, attempt: number): boolean;
