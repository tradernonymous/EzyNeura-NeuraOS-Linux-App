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
    }).sort(function (a, b) { return b.at - a.at; });

    // C1/C3: a finished run is not finished if its report misses the
    // contract the recipe stated — it moves to Needs review with the items
    // unticked, and a budget at or past 80% is said on the card. Without a
    // contract or a budget nothing here changes a card at all.
    var incomplete = [];
    done = done.filter(function (card) {
      var id = card.recipeId;
      // C3 first: a card keeps its budget whether it finishes or moves.
      var budget = Number((o.budgets || {})[id]) || 0;
      var spend = Number((o.spend || {})[id]) || 0;
      if (budget > 0 || spend > 0) {
        var bar = budgetBar(budget, spend);
        if (bar.level !== 'none') card.budget = bar;
      }
      var contract = (o.contracts || {})[id];
      var check = Array.isArray(contract) && contract.length
        ? contractCheck(contract, (o.reports || {})[id])
        : null;
      if (check) {
        card.contract = check;
        if (!check.complete) {
          incomplete.push(card);
          return false;
        }
        card.meta += ' · contract ' + check.items.filter(function (t) { return t.ok; }).length + '/' + check.items.length;
      }
      return true;
    });
    done = done.slice(0, MAX_DONE);

    // Approvals first — a person answering a card outranks reading one.
    review = review.concat(incomplete);

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

  // ---- C1: output contracts -------------------------------------------------

  function norm(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * contractCheck(contract, report) -> { items: [{ text, ok }], complete }
   *
   * C1: what the recipe says the final report must contain, ticked against
   * the report it actually produced. Substring over normalised text — a
   * contract is a person's list of must-haves, not a query language.
   */
  function contractCheck(contract, report) {
    var items = (Array.isArray(contract) ? contract : [])
      .map(function (t) { return String(t == null ? '' : t).trim(); })
      .filter(Boolean);
    var body = norm(report);
    var rows = items.map(function (text) {
      return { text: text, ok: !!body && body.indexOf(norm(text)) >= 0 };
    });
    return { items: rows, complete: rows.every(function (r) { return r.ok; }) };
  }

  // ---- C3: budgets -----------------------------------------------------------

  function formatTok(n) {
    var v = Math.max(0, Math.round(Number(n) || 0));
    return v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(v);
  }

  /**
   * budgetBar(budget, spent) -> { level: 'none'|'ok'|'near'|'over', pct, label }
   *
   * C3: an ESTIMATE — not every provider reports tokens, so the count is
   * characters/4 of the run's chat and the label says ≈. "near" is 80%:
   * the alert the plan asks for, where the card is.
   */
  function budgetBar(budget, spent) {
    var cap = Number(budget) || 0;
    var used = Math.max(0, Math.round(Number(spent) || 0));
    if (cap <= 0) return { level: 'none', pct: 0, label: used ? '≈' + formatTok(used) + ' tok' : '' };
    var ratio = used / cap;
    var pct = Math.round(ratio * 100);
    // The level comes from the ratio, not the rounded percentage: 1001/1000
    // is over, even though both round to 100%.
    var level = ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok';
    return { level: level, pct: pct, label: '≈' + formatTok(used) + ' / ' + formatTok(cap) + ' tok' };
  }

  // ---- C2: run artifacts ------------------------------------------------------

  function slugify(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function pad(n) { return (Number(n) < 10 ? '0' : '') + Number(n); }

  function stamp(at) {
    var d = new Date(at);
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  /**
   * artifactPlan(input) -> { dir, files: [{ path, text }] }
   *
   * C2: the evidence a run leaves behind, laid out under `.neuraos/runs/`
   * so a card can point at ONE folder. Everything it writes is already on
   * this machine: the report, the files the run changed, the contract it
   * was held to, and the trace lines inside the run's window. Paths are
   * relative — the screen writes them into the open folder.
   */
  function artifactPlan(input) {
    var o = input || {};
    var at = Number(o.at) > 0 ? Number(o.at) : Date.now();
    var dir = '.neuraos/runs/' + (slugify(o.recipeName) || 'run') + '-' + stamp(at);
    var head = [
      '# ' + (o.recipeName || 'Run') + ' — evidence',
      '',
      '- when: ' + new Date(at).toISOString(),
      '- status: ' + (o.ok === false ? 'failed' : 'finished'),
      o.chatId ? '- chat: ' + o.chatId : undefined,
      '',
    ].filter(function (line) { return line !== undefined; }).join('\n');
    var files = [];
    var body = head + '\n';
    if (Array.isArray(o.contract) && o.contract.length) {
      var check = contractCheck(o.contract, o.report);
      body += '\n## Contract\n\n' + check.items.map(function (i) {
        return (i.ok ? '- [x] ' : '- [ ] ') + i.text;
      }).join('\n') + '\n';
    }
    body += '\n## Report\n\n' + String(o.report || '(no report was kept for this run)') + '\n';
    files.push({ path: 'report.md', text: body });
    var changes = Array.isArray(o.changes) ? o.changes : [];
    files.push({
      path: 'changes.txt',
      text: changes.length
        ? changes.map(function (c) { return (c.kind || '') + ' ' + (c.path || ''); }).join('\n') + '\n'
        : 'no files changed\n',
    });
    if (Array.isArray(o.traces) && o.traces.length) {
      var lines = [];
      o.traces.forEach(function (t) {
        try { lines.push(JSON.stringify(t)); } catch { /* one bad line, not the file */ }
      });
      files.push({ path: 'traces.jsonl', text: lines.join('\n') + '\n' });
    }
    if (o.error) files.push({ path: 'error.txt', text: String(o.error).slice(0, 4000) + '\n' });
    return { dir: dir, files: files };
  }

  return { COLUMNS: COLUMNS, MAX_DONE: MAX_DONE, board: board, relative: relative, attention: attention, contractCheck: contractCheck, budgetBar: budgetBar, artifactPlan: artifactPlan };
});
