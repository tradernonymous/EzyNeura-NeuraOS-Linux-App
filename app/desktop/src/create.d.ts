/** The Create space: modes, template cards, engine groups (UMD, node-tested). */
export type CreateModeId = 'page' | 'deck' | 'post' | 'image' | 'edit';
export interface CreateMode { id: CreateModeId; label: string; screen: 'design' | 'images'; viewport?: string; task?: 'generate' | 'edit'; hint: string; }
export interface CreateTemplate { id: string; label: string; mode: CreateModeId; sketch: string; brief: string; }
export interface EngineGroup { id: 'local' | 'cloud'; label: string; rows: any[]; }
export declare const MODES: CreateMode[];
export declare const TEMPLATES: CreateTemplate[];
export declare function modeAt(id: string): CreateMode | null;
export declare function modeFor(screen: 'design' | 'images', detail?: { viewport?: string; task?: string }): CreateModeId;
export declare function templateAt(id: string): CreateTemplate | null;
export declare function cardsFor(screen: 'design' | 'images'): CreateTemplate[];
export declare function engineGroups(rows: any[]): EngineGroup[];
