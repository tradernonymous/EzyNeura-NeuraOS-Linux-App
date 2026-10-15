// Settings (UI plan, phase 5): four groups instead of thirteen rows, a card
// grid, and the shortcuts sorted into categories. Pure: the screen reads its
// section titles off the DOM and asks here which group each belongs to.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeAI4USettingsGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** The groups, in nav order, and the section titles (h2 text) each holds. */
  var GROUPS = [
    { id: 'general', label: 'General', hint: 'Look, start-up, keys', sections: ['Appearance', 'Startup and desktop', 'Shortcuts'] },
    { id: 'ai', label: 'AI & Models', hint: 'Engine, services, models, memory', sections: ['Engine', 'Providers', 'Local models', 'Limits the engine enforces', 'Memory the model saved'] },
    { id: 'tools', label: 'Tools', hint: 'Connectors, credentials, voice, desktop', sections: ['Connectors', 'Credentials', 'Dictation', 'Desktop control'] },
    { id: 'system', label: 'System', hint: 'Doctor, Diagnostics, the engine shell', sections: ['Doctor', 'Diagnostics', 'Advanced'] },
  ];

  /** Sections whose card spans the whole grid: they are lists, not a value. */
  var WIDE = ['Local models', 'Connectors', 'Credentials', 'Doctor', 'Diagnostics', 'Shortcuts', 'Providers', 'Advanced', 'Engine'];

  function groupOf(title) {
    var t = String(title || '').trim();
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].sections.indexOf(t) >= 0) return GROUPS[i].id;
    }
    // A card added later lands in System rather than nowhere.
    return 'system';
  }

  function isWide(title) {
    return WIDE.indexOf(String(title || '').trim()) >= 0;
  }

  /** The nav rows with how many of `titles` each group holds (search narrows). */
  function counts(titles) {
    var by = {};
    (titles || []).forEach(function (t) { var g = groupOf(t); by[g] = (by[g] || 0) + 1; });
    return GROUPS.map(function (g) { return { id: g.id, label: g.label, hint: g.hint, count: by[g.id] || 0 }; });
  }

  /** Which group to show for a search: the first with a hit, else the current. */
  function groupForSearch(titlesHit, current) {
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      if ((titlesHit || []).some(function (t) { return groupOf(t) === g.id; })) return g.id;
    }
    return current;
  }

  /** The shortcut categories, and where each binding id lands. */
  var SHORTCUT_CATEGORIES = [
    { id: 'navigation', label: 'Navigation', hint: 'Getting around the app' },
    { id: 'chat', label: 'Chat', hint: 'In a conversation' },
    { id: 'global', label: 'Global', hint: 'From any app on this PC' },
    { id: 'tools', label: 'Tools', hint: 'Panels and modes' },
  ];
  var CATEGORY_OF = {
    palette: 'navigation', settings: 'navigation', sidebar: 'navigation', history: 'navigation', nav: 'navigation', escape: 'navigation', cheatsheet: 'navigation',
    'new-chat': 'chat', model: 'chat', 'tool-cards': 'chat',
    quick: 'global', selection: 'global', screen: 'global', voice: 'global',
    terminal: 'tools', zen: 'tools',
  };

  function categoryOf(id) {
    return CATEGORY_OF[String(id || '')] || 'tools';
  }

  /** rows -> { navigation: [...], chat: [...], global: [...], tools: [...] } in the rows' order. */
  function categorise(rows) {
    var out = {};
    SHORTCUT_CATEGORIES.forEach(function (c) { out[c.id] = []; });
    (rows || []).forEach(function (r) {
      var c = r.category && out[r.category] ? r.category : categoryOf(r.category || r.id);
      out[c].push(r);
    });
    return out;
  }

  /** How many rows a folded category card shows. */
  var PEEK = 3;

  return {
    GROUPS: GROUPS,
    WIDE: WIDE,
    SHORTCUT_CATEGORIES: SHORTCUT_CATEGORIES,
    PEEK: PEEK,
    groupOf: groupOf,
    isWide: isWide,
    counts: counts,
    groupForSearch: groupForSearch,
    categoryOf: categoryOf,
    categorise: categorise,
  };
});
