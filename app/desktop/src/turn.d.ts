/** A turn's anatomy: steps, changes, chips, rewind, goal (UMD, node-tested). */
export interface StepSummary { count: number; running: number; asking: number; failed: number; done: number; label: string; open: boolean; }
export interface FileChange { path: string; kind: 'write' | 'edit'; turns: number; }
export interface ReplyChip { id: string; label: string; text: string; }
export declare const BADGE: Record<string, string>;
export declare function badgeOf(status: string): string;
export declare function stepsOf(events: any[] | undefined): StepSummary;
export declare function changeOf(event: any): { path: string; kind: 'write' | 'edit' } | null;
export declare function changesOf(messages: any[]): FileChange[];
export declare function latestPicture(messages: any[]): string;
export declare function outputOf(messages: any[]): { changes: FileChange[]; picture: string; any: boolean };
export declare function chips(messages: any[], options?: { sending?: boolean }): ReplyChip[];
export declare function rewindTo(messages: any[], index: number): { messages: any[]; draft: string | null };
export declare function goalPrompt(goal: string | undefined): string;
