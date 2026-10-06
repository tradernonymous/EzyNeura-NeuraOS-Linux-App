// The Create space (UI plan, phase 4): Design and Images in one screen with
// a mode switch, and the template gallery its empty state shows. Pure, so
// the modes and the cards are node-tested; the screens render them.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeAI4UCreate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** The five modes: which screen each opens, and the frame or task it sets. */
  var MODES = [
    { id: 'page', label: 'Page', screen: 'design', viewport: 'desktop', hint: 'A landing page, a dashboard, a form' },
    { id: 'deck', label: 'Deck', screen: 'design', viewport: 'deck', hint: 'Slides, one section.slide each' },
    { id: 'post', label: 'Post', screen: 'design', viewport: 'phone', hint: 'A social post, a story, a banner' },
    { id: 'image', label: 'Image', screen: 'images', task: 'generate', hint: 'Draw a picture from words' },
    { id: 'edit', label: 'Edit image', screen: 'images', task: 'edit', hint: 'Change a picture you choose' },
  ];

  /**
   * The two exclusive tabs over those modes: Design (the studio) and Image
   * (the picture tools). One tab is on at a time; a tab's modes are the
   * sub-switch inside it.
   */
  var TABS = [
    { id: 'design', screen: 'design', label: 'Design', hint: 'Pages, decks and posts — prompt to canvas, then refine' },
    { id: 'image', screen: 'images', label: 'Image', hint: 'Draw and change pictures — workflows, queue, gallery' },
  ];

  /** The empty state's cards: a brief the box takes, or a mode to switch to. */
  var TEMPLATES = [
    { id: 'landing', label: 'Landing page', mode: 'page', sketch: 'hero', brief: 'A landing page for {{the product}}: a hero with one headline and one call to action, three benefits, a short FAQ, a footer.' },
    { id: 'dashboard', label: 'Dashboard', mode: 'page', sketch: 'grid', brief: 'A dashboard for {{what it tracks}}: a header with the period picker, four stat tiles, one chart, a table of the latest rows.' },
    { id: 'deck', label: 'Deck', mode: 'deck', sketch: 'slides', brief: 'A ten-slide deck about {{the topic}}: title, the problem, the idea, how it works, proof, the ask.' },
    { id: 'post', label: 'Social post', mode: 'post', sketch: 'square', brief: 'A square social post announcing {{the news}}: one line that stops the scroll, a supporting line, the brand mark.' },
    { id: 'mobile', label: 'App screen', mode: 'post', sketch: 'grid', brief: 'A phone app screen for {{what it does}}: a header, the main action within thumb reach, one list, a bottom tab bar.' },
    { id: 'onepager', label: 'One-pager', mode: 'page', sketch: 'hero', brief: 'A one-pager about {{the subject}}: a headline, two short sections with subheads, one quote, a call to action.' },
    { id: 'email', label: 'Email', mode: 'page', sketch: 'hero', brief: 'An email announcing {{the news}}: a friendly subject line, one idea in the first screen, two short paragraphs, one button.' },
    { id: 'logo', label: 'Logo', mode: 'image', sketch: 'mark', brief: 'A minimal logo mark for {{the brand}}, flat, two colours, on a plain background, vector-like.' },
    { id: 'photo', label: 'Photo', mode: 'image', sketch: 'photo', brief: 'A photograph of {{the subject}}, natural light, shallow depth of field, 35mm.' },
    { id: 'retouch', label: 'Edit a photo', mode: 'edit', sketch: 'photo', brief: '' },
  ];

  function modeAt(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return null;
  }

  /** The tab a mode belongs to: the mode's screen, named as the tab is. */
  function tabOf(modeId) {
    var mode = modeAt(modeId);
    var screen = mode ? mode.screen : 'design';
    for (var i = 0; i < TABS.length; i++) if (TABS[i].screen === screen) return TABS[i].id;
    return 'design';
  }

  /** The sub-switch inside one tab: its own modes, in order. */
  function modesForTab(tab) {
    return MODES.filter(function (m) { return tabOf(m.id) === tab; });
  }

  /** The mode a view and a state map to: Design's viewport, Images' task. */
  function modeFor(screen, detail) {
    var d = detail || {};
    if (screen === 'images') return d.task === 'edit' ? 'edit' : 'image';
    if (d.viewport === 'deck') return 'deck';
    if (d.viewport === 'phone') return 'post';
    return 'page';
  }

  function templateAt(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
    return null;
  }

  /** The cards a screen's empty state shows: its own modes first, the rest after. */
  function cardsFor(screen) {
    var mine = TEMPLATES.filter(function (t) { return (modeAt(t.mode) || {}).screen === screen; });
    var rest = TEMPLATES.filter(function (t) { return (modeAt(t.mode) || {}).screen !== screen; });
    return mine.concat(rest);
  }

  /** The Engine pill's sections: This PC first when it exists, then Cloud. */
  function engineGroups(rows) {
    var local = [];
    var cloud = [];
    (rows || []).forEach(function (r) {
      if (!r) return;
      if (r.kind === 'local') local.push(r); else cloud.push(r);
    });
    var out = [];
    if (local.length) out.push({ id: 'local', label: 'This PC', rows: local });
    if (cloud.length) out.push({ id: 'cloud', label: 'Cloud', rows: cloud });
    return out;
  }

  return { MODES: MODES, TABS: TABS, TEMPLATES: TEMPLATES, modeAt: modeAt, modeFor: modeFor, tabOf: tabOf, modesForTab: modesForTab, templateAt: templateAt, cardsFor: cardsFor, engineGroups: engineGroups };
});
