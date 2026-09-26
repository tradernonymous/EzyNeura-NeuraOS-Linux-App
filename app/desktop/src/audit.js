// C12 (upgrade plan): an audit log the agent cannot touch. Every approval
// decision — allowed, denied, edited, always, stopped — is appended to a
// log shown in Activity, and the place it lives is chosen for exactly one
// property: the model has no tool that reaches it. Not a file in the open
// folder (read_file would read it), not somewhere a shell command could cat
// it without asking (the app's own localStorage is outside every path the
// agent's tools address), and appending happens in the app, not through
// anything the model can invoke.
//
// What is recorded is the decision and the card's summary — never the
// arguments themselves, because a command line or a file's content can
// carry a secret, and "secrets never travel" includes the app's own logs.
//
// UMD like the repo's other shared modules; the storage is injected so
// node:test can exercise the cap without a browser.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UAudit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KEY = 'freeai4u.audit.log';
  // Long enough to answer "what was approved last week", short enough that
  // the log cannot become the thing that fills the store.
  var MAX = 500;
  var MAX_SUMMARY = 300;

  function store(given) {
    if (given) return given;
    try {
      return (typeof globalThis !== 'undefined' && globalThis.localStorage) || null;
    } catch {
      return null;
    }
  }

  function read(storage) {
    var box = store(storage);
    if (!box) return [];
    try {
      var parsed = JSON.parse(box.getItem(KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * record(entry, storage) -> the stored entry.
   *
   *   entry.tool      the tool that asked (run_command, write_file, …)
   *   entry.summary   the card's human line — a path or a command, never args
   *   entry.decision  allowed | denied | edited | always | stopped
   *   entry.project   the folder the decision belonged to ('' for none)
   *
   * A malformed entry is dropped rather than corrupting the log, and the
   * oldest entries fall off past MAX.
   */
  function record(entry, storage) {
    var e = entry || {};
    var row = {
      at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : Date.now(),
      tool: String(e.tool || '').slice(0, 120),
      summary: String(e.summary || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY),
      decision: String(e.decision || 'allowed').slice(0, 24),
      project: String(e.project || '').slice(0, 512),
    };
    if (!row.tool) return null;
    var box = store(storage);
    if (!box) return row;
    try {
      var rows = read(box);
      rows.push(row);
      while (rows.length > MAX) rows.shift();
      box.setItem(KEY, JSON.stringify(rows));
    } catch {
      /* a full or blocked store costs the log, never the approval itself */
    }
    return row;
  }

  /** Newest first, which is how Activity shows it. */
  function recent(storage, limit) {
    var rows = read(storage);
    var n = typeof limit === 'number' && limit > 0 ? limit : rows.length;
    return rows.slice().reverse().slice(0, n);
  }

  /** The decision in words a person reads on the row. */
  var WORDS = {
    allowed: 'allowed',
    denied: 'denied',
    edited: 'allowed, edited',
    always: 'always allowed',
    project: 'allowed for this project',
    stopped: 'stopped',
  };

  function wordFor(decision) {
    return WORDS[String(decision || '')] || String(decision || '');
  }

  return {
    KEY: KEY,
    MAX: MAX,
    read: read,
    record: record,
    recent: recent,
    wordFor: wordFor,
  };
});
