// C5 (upgrade plan, L6): "Parallel runs: several agents on one task, each in
// its own git worktree. The Activity board compares them, and you merge the
// winner." This module is the comparison half. ParallelScreen feeds it the
// numstat each run leaves behind when it finishes; the Activity board reads
// back a table of which run touched which file, by how much, and where two
// runs collided — the facts a person needs to pick a winner before pressing
// Merge on the Parallel screen.
//
// Store: this app's own localStorage key, like the audit log and the traces,
// so the comparison survives the worktrees being discarded and there is no
// network call anywhere in this file. All parsing is pure (parseNumstat,
// compare, batches) and takes an injectable storage where mutation happens,
// so every rule here is testable without a shell or a browser.
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UParallelCompare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var KEY = 'freeai4u.parallel.compare';
  /** Four agents a batch (MAX_AGENTS), a handful of batches back. */
  var CAP_ENTRIES = 40;
  /** A run this big is a wall of text, not a comparison; the totals still count. */
  var MAX_FILES = 400;
  var MAX_PATH = 400;

  function storage(given) {
    if (given) return given;
    try {
      var scope = typeof globalThis !== 'undefined' ? globalThis : {};
      return scope.localStorage || null;
    } catch {
      return null;
    }
  }

  /** The one shell line a run's numbers come from: everything is staged by
   * statCommand() already; numstat is git's machine-readable "add, del,
   * path" (the --stat bars a person reads are not for parsing). */
  function numstatCommand() {
    return 'git add -A && git diff --cached --numstat HEAD';
  }

  /**
   * git diff --numstat output -> [{ path, add, del, binary }].
   * Lines are `added<TAB>deleted<TAB>path`; a `-` count means binary (no
   * line counts — recorded as binary, not zero lines). Anything that does
   * not match (the summary line, warnings) is skipped, never guessed at.
   */
  function parseNumstat(text) {
    var out = [];
    var seen = Object.create(null);
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      if (!line) return;
      var parts = line.split('\t');
      if (parts.length < 3) return;
      if (!/^(\d+|-)$/.test(parts[0]) || !/^(\d+|-)$/.test(parts[1])) return;
      var path = parts.slice(2).join('\t').trim();
      if (!path || path.indexOf(' files changed') >= 0) return;
      if (seen[path]) return;
      seen[path] = true;
      var binary = parts[0] === '-' || parts[1] === '-';
      out.push({
        path: path.length > MAX_PATH ? path.slice(0, MAX_PATH) + '…' : path,
        add: parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0,
        del: parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0,
        binary: binary || undefined,
      });
    });
    return out.slice(0, MAX_FILES);
  }

  /** A run's own score: how many files, how much added and removed. */
  function totals(files) {
    var t = { files: 0, add: 0, del: 0 };
    (files || []).forEach(function (f) {
      t.files += 1;
      t.add += Number(f && f.add) || 0;
      t.del += Number(f && f.del) || 0;
    });
    return t;
  }

  /** WHITELIST: only these fields are ever written, one entry per run. */
  function build(entry) {
    var e = entry || {};
    if (!e.slug) return null;
    var files = Array.isArray(e.files) ? e.files.slice(0, MAX_FILES).map(function (f) {
      var row = {
        path: String(f && f.path || '').slice(0, MAX_PATH),
        add: Math.max(0, Math.round(Number(f && f.add) || 0)),
        del: Math.max(0, Math.round(Number(f && f.del) || 0)),
      };
      if (f && f.binary) row.binary = true;
      return row.path ? row : null;
    }).filter(Boolean) : [];
    var row = {
      batch: String(e.batch || 'batch'),
      at: Number(e.at) > 0 ? Math.round(Number(e.at)) : Date.now(),
      slug: String(e.slug).slice(0, 80),
      branch: String(e.branch || '').slice(0, 120),
      task: String(e.task || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      ms: Math.max(0, Math.round(Number(e.ms) || 0)),
      status: String(e.status || '').slice(0, 24),
      files: files,
    };
    if (e.root) row.root = String(e.root).slice(0, 1024);
    if (e.merged) row.merged = true;
    return row;
  }

  function read(box) {
    if (!box) return [];
    try {
      var raw = box.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function write(box, list) {
    if (!box) return false;
    try {
      box.setItem(KEY, JSON.stringify(list.slice(-CAP_ENTRIES)));
      return true;
    } catch {
      return false;
    }
  }

  /** One run's finish (or a Merge marking it) -> the store, replacing an
   * earlier record of the same run in the same batch. */
  function record(entry, given) {
    var row = build(entry);
    if (!row) return false;
    var box = storage(given);
    if (!box) return false;
    var list = read(box);
    var at = -1;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].batch === row.batch && list[i].slug === row.slug) at = i;
    }
    if (at >= 0) list.splice(at, 1);
    list.push(row);
    return write(box, list);
  }

  /** The Parallel screen pressed Merge on this run. */
  function markMerged(batch, slug, given) {
    var box = storage(given);
    if (!box) return false;
    var list = read(box);
    var found = false;
    list.forEach(function (row) {
      if (row && row.batch === batch && row.slug === slug) { row.merged = true; found = true; }
    });
    return found ? write(box, list) : false;
  }

  /** The run was discarded (its worktree is gone); a merged run's record
   * stays, because the work itself is now in the main tree. */
  function remove(batch, slug, given) {
    var box = storage(given);
    if (!box) return false;
    var next = read(box).filter(function (row) {
      return !(row && row.batch === batch && row.slug === slug);
    });
    return write(box, next);
  }

  /** Stored runs, newest first; with a folder given, only its runs. */
  function list(root, given) {
    var out = read(storage(given)).slice().reverse();
    if (!root) return out;
    return out.filter(function (row) { return !row || !row.root || row.root === root; });
  }

  /** Group a (newest-first) list into batches, newest batch first. */
  function batches(entries) {
    var order = [];
    var by = {};
    (entries || []).forEach(function (row) {
      if (!row || !row.batch) return;
      if (!by[row.batch]) { by[row.batch] = { batch: row.batch, at: row.at || 0, runs: [] }; order.push(row.batch); }
      var g = by[row.batch];
      g.runs.push(row);
      if ((row.at || 0) > g.at) g.at = row.at;
    });
    return order.map(function (id) { return by[id]; });
  }

  /**
   * The comparison itself: one column per run, one row per file, cells
   * aligned to the columns (null = this run did not touch the file). Rows
   * are sorted so files touched by MORE THAN ONE run come first — the
   * collisions are the whole reason to compare before merging.
   */
  function compare(runs) {
    var list = runs || [];
    var columns = list.map(function (row) {
      return {
        slug: row.slug,
        task: row.task,
        branch: row.branch,
        status: row.status,
        merged: !!row.merged,
        ms: row.ms,
        totals: totals(row.files),
      };
    });
    var paths = [];
    var cells = {};
    list.forEach(function (row, i) {
      (row.files || []).forEach(function (f) {
        if (!f || !f.path) return;
        if (!cells[f.path]) { cells[f.path] = new Array(list.length).fill(null); paths.push(f.path); }
        cells[f.path][i] = { add: f.add, del: f.del, binary: !!f.binary };
      });
    });
    var rows = paths.map(function (path) {
      var line = cells[path];
      return { path: path, cells: line, by: line.filter(Boolean).length };
    });
    rows.sort(function (a, b) {
      if (b.by !== a.by) return b.by - a.by;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    return { columns: columns, rows: rows, overlap: rows.filter(function (r) { return r.by >= 2; }).length };
  }

  /** Everything for one folder (or everything, with no folder). */
  function clear(root, given) {
    var box = storage(given);
    if (!box) return false;
    var list = read(box);
    var next = root ? list.filter(function (row) { return !(row && row.root === root); }) : [];
    return write(box, next);
  }

  return {
    KEY: KEY,
    CAP_ENTRIES: CAP_ENTRIES,
    MAX_FILES: MAX_FILES,
    numstatCommand: numstatCommand,
    parseNumstat: parseNumstat,
    totals: totals,
    build: build,
    record: record,
    markMerged: markMerged,
    remove: remove,
    list: list,
    batches: batches,
    compare: compare,
    clear: clear,
  };
});
