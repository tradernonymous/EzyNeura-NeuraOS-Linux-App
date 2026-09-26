/** C7: local JSONL traces — one line per model or tool call, never sent. */

export interface TraceModel {
  at: number;
  kind: 'model';
  provider?: string;
  model?: string;
  chars?: number;
  ms?: number;
  /** The failure's first words, clipped — never a prompt or a reply. */
  error?: string;
  /** Set when the call was a sub-agent's. */
  agent?: string;
}

export interface TraceTool {
  at: number;
  kind: 'tool';
  name?: string;
  status?: string;
  ms?: number;
  agent?: string;
}

export type TraceEntry = TraceModel | TraceTool;

export declare const KEY: string;
export declare const CAP: number;

/**
 * One event -> one JSON line, or '' for an event that is not a trace.
 * Only the fields the interfaces above name are ever written: extra keys a
 * caller passes along (an argument, a reply) are dropped, not serialised.
 */
export declare function build(entry: { kind?: string; [key: string]: unknown }): string;
/** Append one event to the local JSONL store; false when there is no store. */
export declare function append(entry: { kind?: string; [key: string]: unknown }, storage?: any): boolean;
/** The last `limit` events, newest first. */
export declare function recent(limit?: number, storage?: any): TraceEntry[];
/** Erase the store. */
export declare function clear(storage?: any): boolean;
