export interface CcePreset { id: string; label: string; kind: string; note?: string; envVar?: string; }
export declare const PRESETS: CcePreset[];
export declare const STAR_KEY: string;
export declare const DISABLED_KEY: string;
export declare const CATALOG_URL: string;
export declare function starred(): string;
export declare function setStarred(id: string): boolean;
export declare function disabled(): string[];
export declare function setDisabled(ids: string[]): boolean;
export declare function isDisabled(id: string): boolean;
export declare function toggleDisabled(id: string): string[];
export declare function catalog(fetchImpl?: any): Promise<any>;
export declare function secretKey(id: string): string;
