// Quick actions for a picture already drawn (Adobe Express's one-click
// edits): rotate by a quarter turn, flip, centre-crop to a shape's ratio,
// adjust brightness, contrast and saturation. Everything happens on a
// canvas in this window -- no service, no upload, no key; the picture
// never leaves the PC, exactly like the local draw it may have come from.
//
// The maths is pure and node-tested here; the canvas is the screen's half,
// following one plan:
//
//   canvas.width = plan.width; canvas.height = plan.height;
//   ctx.filter = plan.filter || 'none';
//   ctx.translate(plan.width / 2, plan.height / 2);
//   ctx.rotate(plan.angle); ctx.scale(plan.sx, plan.sy);
//   ctx.drawImage(img, plan.src.x, plan.src.y, plan.src.width, plan.src.height,
//                 -plan.src.width / 2, -plan.src.height / 2,
//                 plan.src.width, plan.src.height);
//
// UMD (see images.js); pure, node-tested.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UImageAdjust = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** ctx.filter's own sane ceiling: 300%. */
  var MAX_FILTER = 3;

  function clamp(value, low, high) {
    var n = Number(value);
    if (!isFinite(n)) n = low;
    return Math.min(high, Math.max(low, n));
  }

  /** A percent for a filter knob: 0-300, whole numbers, bad input to 0. */
  function percent(value) {
    return Math.round(clamp(value, 0, MAX_FILTER * 100));
  }

  /** Quarter turns, normalised: rotating by -1 is rotating by 3. */
  function turnsOf(rotate) {
    var n = Math.trunc(Number(rotate) || 0);
    return ((n % 4) + 4) % 4;
  }

  /** The largest centred rectangle of ratio rw:rh that fits in w x h. */
  function cropRect(w, h, rw, rh) {
    var W = Math.max(1, Math.floor(Number(w) || 0));
    var H = Math.max(1, Math.floor(Number(h) || 0));
    var R = (Number(rw) || 1) / (Number(rh) || 1);
    var width = W;
    var height = Math.round(W / R);
    if (height > H || height < 1) {
      height = H;
      width = Math.round(H * R);
    }
    width = Math.max(1, Math.min(W, width));
    height = Math.max(1, Math.min(H, height));
    return { x: Math.floor((W - width) / 2), y: Math.floor((H - height) / 2), width: width, height: height };
  }

  /** 'brightness(1.2) contrast(0.8)' -- '' when nothing is asked for. */
  function filterString(adjust) {
    var a = adjust || {};
    var parts = [];
    var b = percent(a.brightness == null ? 100 : a.brightness) / 100;
    var c = percent(a.contrast == null ? 100 : a.contrast) / 100;
    var s = percent(a.saturation == null ? 100 : a.saturation) / 100;
    if (b !== 1) parts.push('brightness(' + b + ')');
    if (c !== 1) parts.push('contrast(' + c + ')');
    if (s !== 1) parts.push('saturate(' + s + ')');
    return parts.join(' ');
  }

  /**
   * One plan for the canvas dance above: the source rectangle (a centre
   * crop, or the whole picture), the output size (rotation swaps the
   * sides), the angle, the flips and the filter. Every field composes --
   * each has a neutral value -- so one button is one plan.
   */
  function plan(spec) {
    var s = spec || {};
    var w = Math.max(1, Math.floor(Number(s.width) || 0));
    var h = Math.max(1, Math.floor(Number(s.height) || 0));
    var src = s.crop ? cropRect(w, h, s.crop.w, s.crop.h) : { x: 0, y: 0, width: w, height: h };
    var turns = turnsOf(s.rotate);
    return {
      src: src,
      width: turns % 2 ? src.height : src.width,
      height: turns % 2 ? src.width : src.height,
      angle: (turns * Math.PI) / 2,
      sx: s.flipH ? -1 : 1,
      sy: s.flipV ? -1 : 1,
      filter: filterString(s.adjust),
    };
  }

  /** What the note under the new picture says was done. */
  function label(spec) {
    var s = spec || {};
    var bits = [];
    var turns = turnsOf(s.rotate);
    if (turns === 1) bits.push('rotated 90° right');
    if (turns === 2) bits.push('rotated 180°');
    if (turns === 3) bits.push('rotated 90° left');
    if (s.flipH) bits.push('flipped horizontally');
    if (s.flipV) bits.push('flipped vertically');
    if (s.crop && s.crop.label) bits.push('cropped to ' + s.crop.label);
    if (s.adjust && filterString(s.adjust)) bits.push('adjusted');
    return bits.length ? bits.join(', ') : 'unchanged';
  }

  return {
    MAX_FILTER: MAX_FILTER,
    percent: percent,
    turnsOf: turnsOf,
    cropRect: cropRect,
    filterString: filterString,
    plan: plan,
    label: label,
  };
});
