// The deck's outline: what each slide is called, and moving one.
//
// Deck mode shows a filmstrip of the canvas's <section class="slide">
// elements (the layers panel every design app has, at deck size): a click
// jumps to a slide, the arrows move it. Both need the same facts -- a title
// per slide, and the page with one slide re-spliced -- and both must agree
// with what the exporter sees, so the scanner is the same nesting-aware one
// exports.js uses (a slide may contain a nested <section>).
//
// UMD (see stage.js); pure strings, node-tested.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UDesignOutline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var OPEN = /<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>/gi;
  var TAG = /<(\/?)section\b[^>]*>/gi;
  /** Titles longer than this are cut at a word boundary. */
  var TITLE_MAX = 60;

  /** Every slide's [start, end) span in the page, nested sections counted (exports.js's scanner). */
  function spansOf(html) {
    var src = String(html || '');
    var out = [];
    var m;
    OPEN.lastIndex = 0;
    while ((m = OPEN.exec(src))) {
      var depth = 1;
      TAG.lastIndex = m.index + m[0].length;
      var t;
      while (depth && (t = TAG.exec(src))) depth += t[1] ? -1 : 1;
      out.push({ start: m.index, end: t ? t.index + t[0].length : src.length });
      OPEN.lastIndex = out[out.length - 1].end;
    }
    return out;
  }

  function decode(text) {
    return String(text || '')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&');
  }

  /** A slide's title: its first heading (h1-h3) or <strong>, else its first words. */
  function titleOf(outer, index) {
    var body = String(outer || '').replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, '');
    var m = /<(h[1-3]|strong)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body)
      || /<(p|li|figcaption|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
    var flat = decode((m ? m[2] : body).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!flat) return 'Slide ' + (index + 1);
    if (flat.length <= TITLE_MAX) return flat;
    return flat.slice(0, TITLE_MAX - 3).replace(/\s+\S*$/, '') + '…';
  }

  /** The deck's outline: one {index, title} per slide, in document order. */
  function outlineOf(html) {
    var src = String(html || '');
    return spansOf(src).map(function (span, i) {
      return { index: i, title: titleOf(src.slice(span.start, span.end), i) };
    });
  }

  /**
   * The page with slide `from` moved to `to`: the slide's span cut out and
   * spliced back around the slide it lands beside. Anything else -- same
   * slide, out of range, no slides -- is the page unchanged.
   */
  function moveSlide(html, from, to) {
    var src = String(html || '');
    var spans = spansOf(src);
    var n = spans.length;
    if (!(from >= 0) || !(to >= 0) || from >= n || to >= n || from === to) return src;
    var cut = spans[from];
    // The anchor is the slide at `to` either way: before it when moving up,
    // after it when moving down. Never the cut itself (from !== to).
    var anchor = spans[to];
    var at = to < from ? anchor.start : anchor.end;
    var len = cut.end - cut.start;
    var restAt = at > cut.start ? at - len : at;
    var rest = src.slice(0, cut.start) + src.slice(cut.end);
    return rest.slice(0, restAt) + src.slice(cut.start, cut.end) + rest.slice(restAt);
  }

  return { TITLE_MAX: TITLE_MAX, spansOf: spansOf, outlineOf: outlineOf, moveSlide: moveSlide };
});
