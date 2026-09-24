/** The Runs board (UMD, node-tested). */
export interface RunCard { id: string; kind: 'recipe' | 'chat' | 'approval' | 'run'; title: string; meta: string; at: number; ok?: boolean; chatId?: string; recipeId?: string; approvalId?: string; }
export interface RunColumn { id: 'queued' | 'running' | 'review' | 'done'; label: string; hint: string; cards: RunCard[]; }
export interface BoardInput { pending?: any[]; busy?: Set<string> | string[]; sessions?: any[]; recipes?: any[]; runs?: Record<string, any>; nextRun?: (recipe: any, last: number | null | undefined, now: number) => number | null; scheduleLabel?: (recipe: any) => string; now?: number; }
export declare const COLUMNS: Array<{ id: RunColumn['id']; label: string; hint: string }>;
export declare const MAX_DONE: number;
export declare function board(input: BoardInput): RunColumn[];
export declare function relative(at: number, now: number): string;
export declare function attention(columns: RunColumn[]): number;
