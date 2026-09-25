/** Debounced writes: typing is not a disk write per keystroke (UMD, shared with node:test). */
export interface DebouncedWrite<T> {
  /** Remember the newest value and start the clock. */
  schedule(value: T): void;
  /** Write now if anything is owed; true when a write happened. */
  flush(): boolean;
  /** Write this value now, dropping any queued (older) one. */
  writeNow(value: T): void;
  /** True when a write is owed. */
  pending(): boolean;
  /** Forget what is owed. */
  cancel(): void;
}

export declare function createDebouncedWrite<T>(opts: {
  write: (value: T) => void;
  /** Pause in ms before a scheduled write runs (default 250; 0 writes immediately). */
  delay?: number;
  onWrite?: (value: T) => void;
}): DebouncedWrite<T>;

/** True when a session patch is only the composer draft (typing), which may wait to be saved. */
export declare function isTypingPatch(patch: Record<string, unknown> | null | undefined): boolean;
