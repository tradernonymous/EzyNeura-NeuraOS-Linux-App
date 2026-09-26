// C7 (upgrade plan): "Local traces. One JSONL line per model call and tool
// call, viewable in Activity, never sent anywhere."
//
// The store is this app's own localStorage key, kept AS JSONL — one line per
// event, newest last, capped — because a line is the unit you can grep and
// the file-shaped format costs nothing here. localStorage is chosen for the
// same reason as the audit log (C12): "never sent anywhere" has to be true
// by construction. There is no network call in this file, no argument that
// takes a URL, and the only reader is Activity's Traces section.
//
// What is never in a line: the prompt, the reply, tool arguments, tool
// results. A trace answers WHEN a call happened, WHICH model or tool it was,
// HOW LONG it took and WHETHER it worked — everything else can carry a
// secret, so C12's rule applies here too: the shape is a whitelist in
// `build()`, not a blacklist.
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UTraces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var KEY = 'freeai4u.traces';
  var CAP = 500;
  var MAX_TEXT = 200;

  function storage(given) {
    if (given) return given;
    try {
      var scope = typeof globalThis !== 'undefined' ? globalThis : {};
      return scope.localStorage || null;
    } catch {
      return null;
    }
  }

  function clip(value, max) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    var limit = Number(max) > 0 ? Number(max) : MAX_TEXT;
    return text.length <= limit ? text : text.slice(0, limit).trim() + '…';
  }

  /**
   * One event -> one JSON line, or '' when the event is not a trace.
   * WHITELIST: only these fields are ever written, so a caller cannot leak
   * an argument or a reply by passing one along.
   */
  function build(entry) {
    var e = entry || {};
    var row = { at: Number(e.at) > 0 ? Number(e.at) : Date.now() };
    if (e.kind === 'model') {
      row.kind = 'model';
      row.provider = clip(e.provider, 60);
      row.model = clip(e.model, 120);
      row.chars = Number(e.chars) > 0 ? Math.round(Number(e.chars)) : 0;
      row.ms = Number(e.ms) > 0 ? Math.round(Number(e.ms)) : 0;
      if (e.error) row.error = clip(e.error);
      if (e.agent) row.agent = clip(e.agent, 60);
    } else if (e.kind === 'tool') {
      row.kind = 'tool';
      row.name = clip(e.name, 80);
      row.status = clip(e.status, 20);
      row.ms = Number(e.ms) > 0 ? Math.round(Number(e.ms)) : 0;
      if (e.agent) row.agent = clip(e.agent, 60);
    } else {
      return '';
    }
    try {
      return JSON.stringify(row);
    } catch {
      return '';
    }
  }

  /** Append one event; false when there is no store or the event is nothing. */
  function append(entry, given) {
    var line = build(entry);
    if (!line) return false;
    var box = storage(given);
    if (!box) return false;
    try {
      var raw = box.getItem(KEY);
      var lines = raw ? String(raw).split('\n').filter(Boolean) : [];
      lines.push(line);
      if (lines.length > CAP) lines = lines.slice(lines.length - CAP);
      box.setItem(KEY, lines.join('\n'));
      return true;
    } catch {
      return false;
    }
  }

  /** The last `limit` events, newest first; a broken line is skipped. */
  function recent(limit, given) {
    var box = storage(given);
    if (!box) return [];
    var raw = '';
    try {
      raw = box.getItem(KEY) || '';
    } catch {
      return [];
    }
    var lines = raw ? String(raw).split('\n').filter(Boolean) : [];
    var cap = Number(limit);
    if (!Number.isFinite(cap) || cap <= 0) cap = 100;
    var out = [];
    for (var i = lines.length - 1; i >= 0 && out.length < cap; i -= 1) {
      try {
        var row = JSON.parse(lines[i]);
        if (row && row.kind) out.push(row);
      } catch {
        /* one broken line costs that line, not the log */
      }
    }
    return out;
  }

  /** Everything, for the person who wants it gone. */
  function clear(given) {
    var box = storage(given);
    if (!box) return false;
    try {
      box.removeItem(KEY);
      return true;
    } catch {
      return false;
    }
  }

  return {
    KEY: KEY,
    CAP: CAP,
    build: build,
    append: append,
    recent: recent,
    clear: clear,
  };
});
