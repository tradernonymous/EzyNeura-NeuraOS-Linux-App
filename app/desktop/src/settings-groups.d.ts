/** Settings groups and shortcut categories (UMD, node-tested). */
export interface SettingsGroup { id: string; label: string; hint: string; sections: string[]; }
export interface ShortcutCategory { id: 'navigation' | 'chat' | 'global' | 'tools'; label: string; hint: string; }
export interface ShortcutRow { id: string; label: string; keys: string; category?: string; custom?: boolean; fixed?: boolean; change?: () => void; reset?: () => void; }
export declare const GROUPS: SettingsGroup[];
export declare const WIDE: string[];
export declare const SHORTCUT_CATEGORIES: ShortcutCategory[];
export declare const PEEK: number;
export declare function groupOf(title: string): string;
export declare function isWide(title: string): boolean;
export declare function counts(titles: string[]): Array<{ id: string; label: string; hint: string; count: number }>;
export declare function groupForSearch(titlesHit: string[], current: string): string;
export declare function categoryOf(id: string): ShortcutCategory['id'];
export declare function categorise<T extends { id: string; category?: string }>(rows: T[]): Record<ShortcutCategory['id'], T[]>;
