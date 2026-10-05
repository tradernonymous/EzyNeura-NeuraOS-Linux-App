/** The deck's outline: titles per slide and moving one (UMD, node-tested). */
export interface OutlineEntry {
  index: number;
  title: string;
}

export interface SlideSpan {
  start: number;
  end: number;
}

export declare const TITLE_MAX: number;
export declare function spansOf(html: string): SlideSpan[];
export declare function outlineOf(html: string): OutlineEntry[];
/** The page with slide `from` moved to `to`; unchanged when that is no move. */
export declare function moveSlide(html: string, from: number, to: number): string;
