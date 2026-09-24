/** Task decks for the Code screen (UMD, node-tested). */
export interface Task { id: string; label: string; template: string; hint?: string; custom?: boolean; }
export interface Deck { id: string; label: string; icon: string; hint: string; tasks: Task[]; }
export interface SlashRow { id: string; label: string; deck: string; hint: string; template: string; }
export declare const DIR: string;
export declare const DECKS: Deck[];
export declare function decks(): Deck[];
export declare function deckAt(id: string): Deck | null;
export declare function blanks(text: string): string[];
export declare function firstBlank(text: string): { start: number; end: number } | null;
export declare function fill(template: string, answers?: Record<string, string>): string;
export declare function fileNameOf(label: string): string;
export declare function parseCustom(name: string, text: string): Task | null;
export declare function customFile(label: string, template: string, hint?: string): { path: string; text: string };
export declare function slashRows(query: string, custom?: Task[], limit?: number): SlashRow[];
export declare function isSlash(text: string): boolean;
