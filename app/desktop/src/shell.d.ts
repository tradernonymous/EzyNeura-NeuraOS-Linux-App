/** The app frame's memory and the project sidebar's grouping (UMD, node-tested). */
export interface ProjectGroup {
  key: string;
  title: string;
  /** null for Pinned, '' for home, else the folder path. */
  path: string | null;
  items: any[];
  running: boolean;
}
export type SidebarFilter = 'all' | 'running' | 'pinned';
export interface GroupOptions {
  query?: string;
  filter?: SidebarFilter;
  busy?: Set<string>;
  pinned?: string[];
  home?: string;
}
type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void } | null;
export declare const SIDEBAR_KEY: string;
export declare const RECENT_KEY: string;
export declare const FOLDED_KEY: string;
export declare const HOME_LABEL: string;
export declare const HOME_FOLDER: string;
export declare const MAX_RECENT: number;
export declare const PAGE: number;
export declare function readHidden(store?: Store): boolean;
export declare function writeHidden(value: boolean, store?: Store): void;
export declare function cleanProject(value: unknown): string;
export declare function projectName(path: string): string;
export declare function readRecent(store?: Store): string[];
export declare function remember(list: string[], path: string): string[];
export declare function writeRecent(list: string[], store?: Store): void;
export declare function readFolded(store?: Store): string[];
export declare function writeFolded(list: string[], store?: Store): void;
export declare function toggleFolded(list: string[], key: string): string[];
export declare function projectOf(session: any, home?: string): string;
export declare function groups(sessions: any[], options?: GroupOptions): ProjectGroup[];
export declare function knownProjects(sessions: any[], recent: string[], home?: string): string[];
export declare function statusOf(session: any, busy?: Set<string>, waiting?: Set<string>): 'running' | 'needs-you' | 'idle';
