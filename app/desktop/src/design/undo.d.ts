/** The studio's undo/redo working stack, beside the version timeline (UMD, node-tested). */
export interface UndoState {
  past: string[];
  future: string[];
}

export interface UndoStep {
  state: UndoState;
  present: string;
}

export declare const MAX: number;
export declare function initial(): UndoState;
/** Record the page as it was before a change; clears the redo future. */
export declare function mark(state: UndoState, html: string): UndoState;
export declare function canUndo(state: UndoState): boolean;
export declare function canRedo(state: UndoState): boolean;
/** Step back, or null when there is nothing to step back to. */
export declare function undo(state: UndoState, present: string): UndoStep | null;
/** Step forward again, or null when the future is empty. */
export declare function redo(state: UndoState, present: string): UndoStep | null;
