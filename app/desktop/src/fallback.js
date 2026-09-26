// Smart provider fallback: when a model fails for a reason a DIFFERENT model
// would not, decide what to try next -- and decide in advance whether the app
// may do it without asking.
//
// The rule this file exists for is the one the desktop can do and the web app
// cannot: a local llama.cpp server is private, free and not rate-limited, so
// when a remote provider rate-limits a turn, the local model is the obvious
// next attempt -- and switching to it is the one case where the user should
// not have to click anything. Every OTHER switch is offered, not taken: a
// remote model answering instead of the one that was chosen is a different
// answer from a different model, and that is the user's call.
//
// UMD like the repo's other shared modules: node gets module.exports, the
// bundled app gets the global.
(function (root, factory) {
  // Unconditional global publish -- see chats.js for why the traditional
  // fallback-branch UMD shape breaks in a Vite production bundle.
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UFallback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // The kinds a different model can plausibly fix. The rest are about THIS
  // request or THIS key: a context overflow follows the request wherever it
  // goes, and a refused prompt is refused by the next model too.
  var SWITCHABLE = ['rate-limit', 'overloaded', 'timeout', 'network'];

  var MAX_ATTEMPTS = 2;

  // C4: before any switching, the SAME model gets one more chance, after a
  // pause. A rate limit or an overload is usually measured in seconds, so a
  // retry that waits beats a retry that does not -- and a retry that SAYS it
  // is waiting beats both, which is why backoff() and waitLabel() are here
  // next to plan(): the steps fold shows the wait as a step.
  var RETRIES = 1;
  var BASE_BACKOFF = 1000;
  var MAX_BACKOFF = 8000;

  /**
   * Milliseconds to wait before retry number `attempt` (0-based): 1s, 2s, 4s…
   * capped. Deterministic on purpose -- a test can assert it, and a person
   * reading the step sees the number the code used.
   */
  function backoff(attempt) {
    var n = Number(attempt);
    if (!isFinite(n) || n < 0) n = 0;
    return Math.min(MAX_BACKOFF, BASE_BACKOFF * Math.pow(2, Math.floor(n)));
  }

  /** "2s" -- what the steps fold prints for a backoff(). */
  function waitLabel(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1000) return Math.round(n) + 'ms';
    var s = n / 1000;
    return (Math.round(s * 10) / 10) + 's';
  }

  /**
   * Whether the SAME model may be tried again after `attempt` retries:
   * only for the kinds a moment of waiting can fix, and only while the
   * retry budget lasts. Anything that already ran (a tool round that
   * happened before the failure) is the caller's to refuse -- re-running a
   * turn that executed something would execute it twice.
   */
  function retryable(failure, attempt) {
    var kind = text((failure || {}).kind);
    if (SWITCHABLE.indexOf(kind) < 0) return false;
    var n = Number(attempt);
    if (!isFinite(n) || n < 0) n = 0;
    return Math.floor(n) < RETRIES;
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  /** A local model, if there is a running one to attempt. */
  function localAttempt(local) {
    if (!local) return null;
    if (local.ready === false) return null;
    var base = text(local.baseUrl);
    var model = text(local.model);
    if (!base || !model) return null;
    return {
      provider: 'local',
      model: model,
      label: 'your local model (' + model + ')',
      why: 'it runs on this machine, so a remote limit does not touch it',
    };
  }

  /**
   * What to do about a failed turn.
   *
   * input.failure  — the object failure.attribute() built (kind is what matters)
   * input.provider — the provider the turn was asked of
   * input.model    — the model the turn was asked of
   * input.next     — the next model in the picker order (failure.nextModel)
   * input.local    — the running local server, if any ({ baseUrl, model })
   *
   * Returns { attempts, automatic, note }:
   *   attempts  — ordered, never the model that just failed, never more than 2
   *   automatic — true only when the first attempt is the local model: it is
   *               the same request to a private server, so there is nothing to
   *               consent to. Anything else is offered in the failure card.
   *   note      — one sentence for when `automatic` runs
   */
  function plan(input) {
    var opts = input || {};
    var kind = text((opts.failure || {}).kind) || 'unknown';
    var provider = text(opts.provider);
    var model = text(opts.model);
    var attempts = [];

    if (SWITCHABLE.indexOf(kind) < 0) {
      return { attempts: [], automatic: false, note: '' };
    }

    // The handoff the app may take on its own is remote -> local, and only
    // that: a local turn that failed is already the local server, so the next
    // thing to try is another model, and choosing one is the user's call.
    var handoff = false;
    var own = localAttempt(opts.local);
    if (own && provider !== 'local') {
      attempts.push(own);
      handoff = true;
    }

    // The provider ladder's own answer: one step along the list the picker
    // shows, sent to the provider that was already chosen.
    var next = text(opts.next);
    if (next && next !== model) {
      attempts.push({
        provider: provider === 'local' ? 'local' : provider,
        model: next,
        label: 'the next model in the list (' + next + ')',
        why: 'the picker order is the engine operator’s, and one step is the smallest change',
      });
    }

    attempts = attempts.slice(0, MAX_ATTEMPTS);
    var automatic = !!(handoff && attempts.length);
    var note = automatic
      ? 'The remote model was ' + (kind === 'rate-limit' ? 'rate-limited' : kind.replace(/-/g, ' ')) +
        ' — answered by ' + attempts[0].label + ' instead.'
      : '';

    return { attempts: attempts, automatic: automatic, note: note };
  }

  return {
    SWITCHABLE: SWITCHABLE,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    RETRIES: RETRIES,
    backoff: backoff,
    waitLabel: waitLabel,
    retryable: retryable,
    plan: plan,
  };
});
