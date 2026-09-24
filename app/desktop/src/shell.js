// The app frame's memory and the project sidebar's grouping (the Claude Code
// flow: every chat belongs to a folder, and history is read by folder).
//
// Pure functions over the chat list, so the grouping, the filters and the
// "damaged storage" cases are tested without a DOM, the way chats.js and
// threads.js are. The components render the answers.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeAI4UShell = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** '1' when the person hid the sidebar (Ctrl+B); anything else shows it. */
  var SIDEBAR_KEY = 'freeai4u.sidebar.hidden';
  /** The folders new chats were started in, newest first. */
  var RECENT_KEY = 'freeai4u.projects.recent';
  /** Which project groups are folded shut. */
  var FOLDED_KEY = 'freeai4u.projects.folded';
  var MAX_RECENT = 8;
  /** A group shows this many chats before "Show more". */
  var PAGE = 8;
  /** What the home group is called: chats about nothing in particular. */
  var HOME_LABEL = 'NeuraOS home';
  /** The folder the shell makes for those chats, under the home directory. */
  var HOME_FOLDER = 'NeuraOS';

  function storage(store) {
    return store || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  }

  function readHidden(store) {
    try { return storage(store).getItem(SIDEBAR_KEY) === '1'; } catch (e) { return false; }
  }

  function writeHidden(value, store) {
    try { storage(store).setItem(SIDEBAR_KEY, value ? '1' : '0'); } catch (e) { /* a sidebar that forgets is still a sidebar */ }
  }

  /** A project is a folder path; anything else is the home group (''). */
  function cleanProject(value) {
    var s = typeof value === 'string' ? value.trim() : '';
    return s.length > 1024 ? '' : s;
  }

  /** The last path segment, whichever slash the platform uses; '' -> home. */
  function projectName(path) {
    var p = cleanProject(path).replace(/[\\/]+$/, '');
    if (!p) return HOME_LABEL;
    var parts = p.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  }

  function readRecent(store) {
    try {
      var raw = JSON.parse(storage(store).getItem(RECENT_KEY) || '[]');
      return Array.isArray(raw) ? raw.map(cleanProject).filter(Boolean).slice(0, MAX_RECENT) : [];
    } catch (e) { return []; }
  }

  /** The list with `path` at the front, once, and the oldest dropped. */
  function remember(list, path) {
    var p = cleanProject(path);
    var rest = (Array.isArray(list) ? list : []).map(cleanProject).filter(function (x) { return x && x !== p; });
    return (p ? [p] : []).concat(rest).slice(0, MAX_RECENT);
  }

  function writeRecent(list, store) {
    try { storage(store).setItem(RECENT_KEY, JSON.stringify(remember(list, ''))); } catch (e) { /* optional */ }
  }

  function readFolded(store) {
    try {
      var raw = JSON.parse(storage(store).getItem(FOLDED_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(function (k) { return typeof k === 'string'; }).slice(0, 200) : [];
    } catch (e) { return []; }
  }

  function writeFolded(list, store) {
    try { storage(store).setItem(FOLDED_KEY, JSON.stringify(list.slice(0, 200))); } catch (e) { /* optional */ }
  }

  function toggleFolded(list, key) {
    var at = list.indexOf(key);
    var next = list.slice();
    if (at >= 0) next.splice(at, 1); else next.push(key);
    return next;
  }

  /** The group a chat belongs to: its folder, or home when it has none. */
  function projectOf(session, home) {
    var p = cleanProject(session && session.project);
    if (!p || p === cleanProject(home)) return '';
    return p;
  }

  function matches(session, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    if (String(session.title || '').toLowerCase().indexOf(q) >= 0) return true;
    return (session.messages || []).some(function (m) { return String(m.content || '').toLowerCase().indexOf(q) >= 0; });
  }

  /**
   * groups(sessions, options) -> [{ key, title, path, items, running }]
   *
   * Pinned chats first, then one group per folder, ordered by the newest
   * chat in each, with the home group last. Within a group the newest is
   * first. A chat appears once. options: { query, filter: 'all'|'running'|
   * 'pinned', busy: Set<id>, pinned: [id], home }.
   */
  function groups(sessions, options) {
    var o = options || {};
    var busy = o.busy || new Set();
    var pinnedIds = Array.isArray(o.pinned) ? o.pinned : [];
    var filter = o.filter || 'all';
    var list = (sessions || []).filter(function (s) {
      if (!s || !matches(s, o.query)) return false;
      if (filter === 'running') return busy.has(s.id);
      if (filter === 'pinned') return pinnedIds.indexOf(s.id) >= 0;
      return true;
    }).slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var byId = {};
    list.forEach(function (s) { byId[s.id] = s; });
    var used = {};
    var out = [];
    if (filter !== 'pinned') {
      var pinned = pinnedIds.map(function (id) { return byId[id]; }).filter(Boolean);
      pinned.forEach(function (s) { used[s.id] = true; });
      if (pinned.length) out.push({ key: 'pinned', title: 'Pinned', path: null, items: pinned, running: pinned.some(function (s) { return busy.has(s.id); }) });
    }
    var byProject = {};
    var order = [];
    list.forEach(function (s) {
      if (used[s.id]) return;
      var p = projectOf(s, o.home);
      if (!byProject[p]) { byProject[p] = []; order.push(p); }
      byProject[p].push(s);
    });
    order.filter(function (p) { return p; }).forEach(function (p) {
      out.push({ key: 'project:' + p, title: projectName(p), path: p, items: byProject[p], running: byProject[p].some(function (s) { return busy.has(s.id); }) });
    });
    if (byProject['']) out.push({ key: 'home', title: HOME_LABEL, path: '', items: byProject[''], running: byProject[''].some(function (s) { return busy.has(s.id); }) });
    return out;
  }

  /** The folders the sidebar knows: recent picks first, then every folder a chat lives in. */
  function knownProjects(sessions, recent, home) {
    var seen = {};
    var out = [];
    (recent || []).forEach(function (p) { p = cleanProject(p); if (p && !seen[p]) { seen[p] = true; out.push(p); } });
    (sessions || []).slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).forEach(function (s) {
      var p = projectOf(s, home);
      if (p && !seen[p]) { seen[p] = true; out.push(p); }
    });
    return out;
  }

  /** A chat's dot: running beats everything; a chat waiting on the person is 'needs-you'. */
  function statusOf(session, busy, waiting) {
    if (busy && busy.has(session.id)) return 'running';
    if (waiting && waiting.has(session.id)) return 'needs-you';
    return 'idle';
  }

  return {
    SIDEBAR_KEY: SIDEBAR_KEY,
    RECENT_KEY: RECENT_KEY,
    FOLDED_KEY: FOLDED_KEY,
    HOME_LABEL: HOME_LABEL,
    HOME_FOLDER: HOME_FOLDER,
    MAX_RECENT: MAX_RECENT,
    PAGE: PAGE,
    readHidden: readHidden,
    writeHidden: writeHidden,
    cleanProject: cleanProject,
    projectName: projectName,
    readRecent: readRecent,
    remember: remember,
    writeRecent: writeRecent,
    readFolded: readFolded,
    writeFolded: writeFolded,
    toggleFolded: toggleFolded,
    projectOf: projectOf,
    groups: groups,
    knownProjects: knownProjects,
    statusOf: statusOf,
  };
});
