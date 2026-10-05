/** Quick actions for a picture already drawn (UMD, node-tested). */
export interface Adjust {
  /** 0-300, 100 neutral. */
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

export interface CropSpec {
  w: number;
  h: number;
  label?: string;
}

export interface AdjustSpec {
  width?: number;
  height?: number;
  /** Quarter turns; negative wraps (−1 is 3). */
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  crop?: CropSpec | null;
  adjust?: Adjust | null;
}

export interface SrcRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AdjustPlan {
  src: SrcRect;
  width: number;
  height: number;
  angle: number;
  sx: number;
  sy: number;
  filter: string;
}

export declare const MAX_FILTER: number;
export declare function percent(value: unknown): number;
export declare function turnsOf(rotate: unknown): number;
export declare function cropRect(w: number, h: number, rw: number, rh: number): SrcRect;
export declare function filterString(adjust: Adjust | null | undefined): string;
export declare function plan(spec: AdjustSpec): AdjustPlan;
export declare function label(spec: AdjustSpec): string;
