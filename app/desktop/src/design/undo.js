// The studio's undo: one working stack beside the version timeline.
//
// The timeline (versions.js) is a record, not a working set: it grows with
// every AI turn, edit and restore, and reads as history. Undo needs the last
// few of those as working state -- what was on the canvas before the change
// at hand, and what undo put away when redo is asked for -- so it lives here,
// pure, with the screen applying each step as an ordinary versioned change
// ("Undo" rows in History, nothing hidden and nothing lost). mark() on any
// new change forgets the redo future, exactly as every editor has taught.
//
// UMD (see stage.js); pure, node-tested.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UDesignUndo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** How far back undo reaches; versions.js keeps the deeper record. */
  var MAX = 40;

  function initial() {
    return { past: [], future: [] };
  }

  /**
   * A change is coming: the page as it was goes on the stack, and the redo
   * future clears. The page the caller passes is the one BEFORE the change;
   * an empty page, or the same one twice in a row, is not a step.
   */
  function mark(state, html) {
    var past = (state && state.past) || [];
    if (!html || past[past.length - 1] === html) return state || initial();
    return { past: past.concat([html]).slice(-MAX), future: [] };
  }

  function canUndo(state) {
    return !!(state && state.past && state.past.length);
  }

  function canRedo(state) {
    return !!(state && state.future && state.future.length);
  }

  /** Step back: the previous page, and the current one kept for redo. */
  function undo(state, present) {
    if (!canUndo(state) || !present) return null;
    var past = state.past.slice(0, -1);
    return {
      state: { past: past, future: [present].concat(state.future).slice(0, MAX) },
      present: state.past[state.past.length - 1],
    };
  }

  /** Step forward again: the page undo put away. */
  function redo(state, present) {
    if (!canRedo(state)) return null;
    return {
      state: { past: (present ? state.past.concat([present]) : state.past).slice(-MAX), future: state.future.slice(1) },
      present: state.future[0],
    };
  }

  return { MAX: MAX, initial: initial, mark: mark, canUndo: canUndo, canRedo: canRedo, undo: undo, redo: redo };
});
