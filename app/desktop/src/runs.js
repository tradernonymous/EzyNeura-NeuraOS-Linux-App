// Runs (UI plan, phase 6): everything queued, running, waiting on a person
// or finished, as one board -- the vibe-kanban idea. Pure: the screen hands
// in what the modules that own the facts already report (recipes.js,
// threads.js, the chat store), and gets columns of cards back.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeAI4URuns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var COLUMNS = [
    { id: 'queued', label: 'Queued', hint: 'Scheduled, next run first' },
    { id: 'running', label: 'Running', hint: 'Answering right now' },
    { id: 'review', label: 'Needs review', hint: 'Waiting on your OK' },
    { id: 'done', label: 'Done', hint: 'Newest first' },
  ];
  var MAX_DONE = 20;

  /**
   * board(input) -> [{ id, label, hint, cards: [{ id, kind, title, meta, at, ok, chatId, recipeId }] }]
   * input: { pending: PendingApproval[], busy: Set<chatId>|string[], sessions: ChatSession[],
   *          recipes: Recipe[], runs: {recipeId: RunEntry}, nextRun(recipe, last, now), scheduleLabel(recipe), now }
   */
  function board(input) {
    var o = input || {};
    var now = Number(o.now) || Date.now();
    var busy = o.busy instanceof Set ? o.busy : new Set(o.busy || []);
    var sessions = Array.isArray(o.sessions) ? o.sessions : [];
    var runs = o.runs || {};
    var byId = {};
    sessions.forEach(function (s) { if (s && s.id) byId[s.id] = s; });

    var queued = (o.recipes || []).filter(function (r) { return r && r.schedule && r.schedule.enabled !== false; }).map(function (r) {
      var last = runs[r.id] && runs[r.id].at;
      var next = typeof o.nextRun === 'function' ? o.nextRun(r, last, now) : null;
      return { id: 'q:' + r.id, kind: 'recipe', title: r.name, meta: (typeof o.scheduleLabel === 'function' ? o.scheduleLabel(r) : '') + (next ? ' · next ' + relative(next, now) : ''), at: next || 0, recipeId: r.id };
    }).sort(function (a, b) { return (a.at || Infinity) - (b.at || Infinity); });

    var running = Array.from(busy).map(function (id) {
      var s = byId[id];
      return { id: 'r:' + id, kind: 'chat', title: (s && s.title) || 'A chat', meta: s && s.model ? s.model : 'answering', at: (s && s.updatedAt) || now, chatId: id };
    });

    var review = (o.pending || []).map(function (p) {
      return { id: 'p:' + p.id, kind: 'approval', title: p.recipeName + ': ' + p.tool, meta: p.summary || p.asks || 'needs your OK', at: p.at || now, approvalId: p.id, recipeId: p.recipeId };
    });

    var done = Object.keys(runs).map(function (recipeId) {
      var e = runs[recipeId] || {};
      var r = (o.recipes || []).filter(function (x) { return x && x.id === recipeId; })[0];
      return { id: 'd:' + recipeId + ':' + (e.at || 0), kind: 'run', title: (r && r.name) || recipeId, meta: (e.ok ? 'ok' : (e.error || 'failed')) + ' · ' + relative(e.at || 0, now), at: e.at || 0, ok: !!e.ok, chatId: e.chatId, recipeId: recipeId };
    }).sort(function (a, b) { return b.at - a.at; }).slice(0, MAX_DONE);

    return [
      { id: 'queued', label: COLUMNS[0].label, hint: COLUMNS[0].hint, cards: queued },
      { id: 'running', label: COLUMNS[1].label, hint: COLUMNS[1].hint, cards: running },
      { id: 'review', label: COLUMNS[2].label, hint: COLUMNS[2].hint, cards: review },
      { id: 'done', label: COLUMNS[3].label, hint: COLUMNS[3].hint, cards: done },
    ];
  }

  /** '3m', 'in 2h', '4d ago': a time relative to now, short. */
  function relative(at, now) {
    var d = Number(at) - Number(now);
    var abs = Math.abs(d);
    var unit = abs < 3600000 ? [Math.max(1, Math.round(abs / 60000)), 'm'] : abs < 86400000 ? [Math.round(abs / 3600000), 'h'] : [Math.round(abs / 86400000), 'd'];
    var word = unit[0] + unit[1];
    return d > 0 ? 'in ' + word : word + ' ago';
  }

  /** How many cards need a person right now: the badge. */
  function attention(columns) {
    var col = (columns || []).filter(function (c) { return c.id === 'review'; })[0];
    return col ? col.cards.length : 0;
  }

  return { COLUMNS: COLUMNS, MAX_DONE: MAX_DONE, board: board, relative: relative, attention: attention };
});
