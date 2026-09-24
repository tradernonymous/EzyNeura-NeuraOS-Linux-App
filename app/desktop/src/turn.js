// A turn's anatomy (UI plan, phase 2): the steps a reply took, folded into
// "Worked N steps"; the files it changed; the chips offered under the last
// answer; rewinding to a message; the pinned goal. Pure functions over the
// session's messages, so all of it is node-tested without a DOM.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeAI4UTurn = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** The badge on a step row, in the words Freebuff uses: short, upper case. */
  var BADGE = { done: 'DONE', running: 'RUNNING', asking: 'NEEDS OK', denied: 'DECLINED', error: 'FAILED' };

  function badgeOf(status) {
    return BADGE[status] || String(status || '').toUpperCase();
  }

  /**
   * stepsOf(events) -> { count, running, asking, failed, label, open }
   * `open` says whether the fold should start open: while a step runs or
   * asks, yes; a finished turn folds to one line.
   */
  function stepsOf(events) {
    var list = Array.isArray(events) ? events : [];
    var out = { count: list.length, running: 0, asking: 0, failed: 0, done: 0 };
    list.forEach(function (e) {
      if (e.status === 'running') out.running += 1;
      else if (e.status === 'asking') out.asking += 1;
      else if (e.status === 'error' || e.status === 'denied') out.failed += 1;
      else if (e.status === 'done') out.done += 1;
    });
    out.label = out.running || out.asking
      ? 'Working · ' + out.count + ' step' + (out.count === 1 ? '' : 's')
      : 'Worked ' + out.count + ' step' + (out.count === 1 ? '' : 's');
    out.open = out.running > 0 || out.asking > 0;
    return out;
  }

  /** A file a tool wrote or edited: 'write' is a new or whole file, 'edit' a change inside one. */
  function changeOf(event) {
    if (!event || event.status !== 'done') return null;
    var args = event.args || {};
    if (event.name === 'write_file' && args.path) return { path: String(args.path), kind: 'write' };
    if (event.name === 'edit_file' && args.path) return { path: String(args.path), kind: 'edit' };
    return null;
  }

  /**
   * changesOf(messages) -> [{ path, kind, turns }] -- every file the chat's
   * replies changed, once each, the most recently touched last. `turns`
   * counts how many replies touched it.
   */
  function changesOf(messages) {
    var seen = {};
    var out = [];
    (messages || []).forEach(function (m, i) {
      if (!m || m.role !== 'assistant' || !Array.isArray(m.tools)) return;
      m.tools.forEach(function (e) {
        var c = changeOf(e);
        if (!c) return;
        if (seen[c.path]) {
          var hit = seen[c.path];
          hit.kind = c.kind === 'write' ? 'write' : hit.kind;
          if (hit.turn !== i) { hit.turns += 1; hit.turn = i; }
          out.splice(out.indexOf(hit), 1);
          out.push(hit);
          return;
        }
        var row = { path: c.path, kind: c.kind, turns: 1, turn: i };
        seen[c.path] = row;
        out.push(row);
      });
    });
    return out.map(function (r) { return { path: r.path, kind: r.kind, turns: r.turns }; });
  }

  /** The newest picture in the thread, whoever put it there, or ''. */
  function latestPicture(messages) {
    var list = messages || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var imgs = list[i] && list[i].images;
      if (Array.isArray(imgs) && imgs.length) return String(imgs[imgs.length - 1]);
    }
    return '';
  }

  /** What the output panel can show, and whether there is anything at all. */
  function outputOf(messages) {
    var changes = changesOf(messages);
    var picture = latestPicture(messages);
    return { changes: changes, picture: picture, any: changes.length > 0 || !!picture };
  }

  /**
   * chips(messages, options) -> [{ id, label, text }] offered under the last
   * reply. Nothing while a reply streams, nothing under a note or a failure,
   * and the code-shaped chips only when the reply had no code / the chat
   * changed files.
   */
  function chips(messages, options) {
    var o = options || {};
    var list = messages || [];
    if (o.sending || !list.length) return [];
    var last = list[list.length - 1];
    if (!last || last.role !== 'assistant' || last.note || last.error || !last.content) return [];
    var out = [
      { id: 'continue', label: 'Continue', text: 'Continue.' },
      { id: 'shorter', label: 'Shorter', text: 'Say that again in half the words.' },
      { id: 'explain', label: 'Explain', text: 'Explain that more simply, step by step.' },
    ];
    if (!/```/.test(last.content)) out.push({ id: 'code', label: 'Turn into code', text: 'Turn that into working code, with the file names.' });
    if (changesOf(list).length) {
      out.push({ id: 'review', label: 'Review changes', text: 'Review the changes you made in this chat and list any risks or mistakes.' });
      out.push({ id: 'tests', label: 'Run tests', text: "Run the project's tests and report what passed and what failed." });
    }
    return out;
  }

  /**
   * rewindTo(messages, index) -> { messages, draft } -- the thread cut before
   * the user message at `index`, and that message's text back in the box.
   * Anything but a user message leaves the thread alone.
   */
  function rewindTo(messages, index) {
    var list = messages || [];
    var m = list[index];
    if (!m || m.role !== 'user' || m.note) return { messages: list, draft: null };
    return { messages: list.slice(0, index), draft: String(m.content || '').split('\n--- attached ---')[0].replace(/\s+$/, '') };
  }

  /** The pinned goal as a system line, or '' when there is none. */
  function goalPrompt(goal) {
    var g = String(goal || '').trim().slice(0, 500);
    return g ? 'The user\'s goal for this whole conversation: ' + g + '\nKeep every reply in service of it.' : '';
  }

  return {
    BADGE: BADGE,
    badgeOf: badgeOf,
    stepsOf: stepsOf,
    changeOf: changeOf,
    changesOf: changesOf,
    latestPicture: latestPicture,
    outputOf: outputOf,
    chips: chips,
    rewindTo: rewindTo,
    goalPrompt: goalPrompt,
  };
});
