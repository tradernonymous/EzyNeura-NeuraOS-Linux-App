// A write that follows typing must not become a disk write per keystroke.
// The chat store is rewritten whole and encrypted on every save, so before
// this the composer's onChange meant one encrypt-and-write per character.
// This is the layer between: the newest value wins while typing, the write
// happens when the typing pauses, and flush() is the promise that the words
// are on disk before anything that depends on it (sending, switching chats,
// closing the window). Pure (node-tested).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UPersist = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * A debounced writer. schedule() remembers the newest value and starts the
   * clock; when the clock runs out (or someone calls flush) the newest value
   * is written once. A value scheduled during the write itself is written on
   * the next tick, not lost.
   *
   * @param {{write: (value: any) => void, delay?: number, onWrite?: (value: any) => void}} opts
   *   write: does the I/O. delay: pause in ms before a scheduled write runs
   *   (default 250; 0 writes immediately). onWrite: called after each write,
   *   for tests and counters.
   */
  function createDebouncedWrite(opts) {
    var options = opts || {};
    var write = options.write;
    if (typeof write !== 'function') throw new Error('createDebouncedWrite needs a write(value)');
    var delay = typeof options.delay === 'number' && options.delay >= 0 ? options.delay : 250;
    var timer = null;
    var queued = null;
    var owed = false;

    function run() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!owed) return false;
      var value = queued;
      queued = null;
      owed = false;
      write(value);
      if (typeof options.onWrite === 'function') options.onWrite(value);
      return true;
    }

    function schedule(value) {
      queued = value;
      owed = true;
      if (delay === 0) {
        run();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
    }

    /** Write `value` now, dropping anything queued: the queued copy is older,
     *  and writing it after this one would put stale state back on disk. */
    function writeNow(value) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      queued = null;
      owed = false;
      write(value);
      if (typeof options.onWrite === 'function') options.onWrite(value);
    }

    return {
      schedule: schedule,
      /** Write now if anything is owed; true when a write happened. */
      flush: run,
      writeNow: writeNow,
      /** True when a write is owed. */
      pending: function () {
        return owed;
      },
      /** Forget what is owed. Never use this to avoid a write on a path that
       *  matters -- flush() is the honest way to leave. */
      cancel: function () {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        queued = null;
        owed = false;
      },
    };
  }

  /**
   * The patch-shape rule ChatScreen needs: a patch of only `draft` is typing
   * and may wait; anything else (messages, title, provider...) is an event
   * worth writing at once. Pure so the rule is testable without the screen.
   */
  function isTypingPatch(patch) {
    var keys = Object.keys(patch || {});
    if (!keys.length) return false;
    return keys.every(function (k) {
      return k === 'draft';
    });
  }

  return {
    createDebouncedWrite: createDebouncedWrite,
    isTypingPatch: isTypingPatch,
  };
});
