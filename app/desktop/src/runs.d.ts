/** The Runs board (UMD, node-tested). */

export interface ContractCheck {
  items: Array<{ text: string; ok: boolean }>;
  complete: boolean;
}

export interface BudgetBar {
  level: 'none' | 'ok' | 'near' | 'over';
  pct: number;
  label: string;
}

export interface RunCard { id: string; kind: 'recipe' | 'chat' | 'approval' | 'run'; title: string; meta: string; at: number; ok?: boolean; chatId?: string; recipeId?: string; approvalId?: string; /** C1: the recipe's contract, ticked against the report. */ contract?: ContractCheck; /** C3: the run's spend against the recipe's budget. */ budget?: BudgetBar; }
export interface RunColumn { id: 'queued' | 'running' | 'review' | 'done'; label: string; hint: string; cards: RunCard[]; }
export interface BoardInput { pending?: any[]; busy?: Set<string> | string[]; sessions?: any[]; recipes?: any[]; runs?: Record<string, any>; nextRun?: (recipe: any, last: number | null | undefined, now: number) => number | null; scheduleLabel?: (recipe: any) => string; now?: number;
  /** C1: recipeId -> what the final report must contain. */
  contracts?: Record<string, string[]>;
  /** C1: recipeId -> the report the run produced (its last answer). */
  reports?: Record<string, string>;
  /** C3: recipeId -> token ceiling, and the run's approximate spend. */
  budgets?: Record<string, number>;
  spend?: Record<string, number>;
}
export declare const COLUMNS: Array<{ id: RunColumn['id']; label: string; hint: string }>;
export declare const MAX_DONE: number;
export declare function board(input: BoardInput): RunColumn[];
export declare function relative(at: number, now: number): string;
export declare function attention(columns: RunColumn[]): number;
/** C1: tick the contract against the report. */
export declare function contractCheck(contract: string[] | null | undefined, report: string | null | undefined): ContractCheck;
/** C3: the spend against the budget — an estimate, marked ≈ on the card. */
export declare function budgetBar(budget: number | null | undefined, spent: number | null | undefined): BudgetBar;
/** C2: the evidence folder a run keeps under `.neuraos/runs/`. */
export declare function artifactPlan(input: {
  recipeName?: string;
  at?: number;
  ok?: boolean;
  chatId?: string;
  report?: string;
  contract?: string[];
  changes?: Array<{ kind?: string; path?: string }>;
  traces?: any[];
  error?: string;
}): { dir: string; files: Array<{ path: string; text: string }> };
