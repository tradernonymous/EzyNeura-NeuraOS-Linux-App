// The Doctor's sentences (D6 of docs/APP_UPGRADE_PLAN.md).
//
// src-tauri/src/doctor.rs gathers the facts; this decides what they mean and
// says it. The split is the same one diagnostics.js uses, and for the same
// reason: the wording is the whole product of a doctor, and wording that can
// only be exercised by launching the app is wording that does not get
// exercised.
//
// Three states, not two. `ok` is working, `warn` is working but something
// about it is worth knowing, and `bad` is the thing stopping the feature. The
// middle state is the one a boolean would throw away: an engine that is not
// running is fine if you never asked it to run, and a warning is what stops
// that from being reported as a fault.
//
// Every `bad` carries a `fix`. A doctor that says "Node not found" and stops
// there has done the easy half of the job; the fix is the half that saves the
// user an afternoon.
//
// Pure and UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UDoctor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var OK = 'ok';
  var WARN = 'warn';
  var BAD = 'bad';

  function check(id, label, state, detail, fix) {
    return {
      id: id,
      label: label,
      state: state,
      detail: detail || '',
      // Only ever set on `bad`. A warning suggests; it does not instruct.
      fix: state === BAD ? (fix || '') : '',
    };
  }

  /**
   * nodeCheck(facts)
   *
   * Node is the one hard requirement: without it the engine cannot run at all,
   * and everything else in the app is downstream of that. So a missing Node is
   * `bad`, and it is `bad` with a fix that names the version, because "install
   * Node" without a version is how somebody installs 18 and hits the same wall.
   */
  function nodeCheck(facts) {
    var node = (facts || {}).node || {};
    var min = (facts || {}).runtimes && facts.runtimes.min_node_major;
    if (node.found && node.ok) {
      var where = node.path ? ' at ' + node.path : '';
      return check('node', 'Node.js', OK, 'Node ' + node.major + where + '.');
    }
    if (node.found) {
      // Found but too old. Distinct from missing, and the fix differs.
      return check(
        'node', 'Node.js', BAD,
        node.reason || 'The Node on PATH is too old.',
        'Install Node ' + (min || 24) + '+ (nvm, or your distro’s NodeSource repository) and reopen NeuraOS.'
      );
    }
    return check(
      'node', 'Node.js', BAD,
      node.reason || 'No `node` found on PATH.',
      'Install Node ' + (min || 24) + '+ (nvm, or your distro’s NodeSource repository) and reopen NeuraOS.'
    );
  }

  /**
   * engineCheck(facts)
   *
   * Not running is `ok` when the app is pointed at a hosted engine instead --
   * which is the default for many users and not a fault at all. Running is
   * `ok` too. The interesting middle is a user unit that is installed but
   * inactive, which is the state that surprises people: they set NeuraOS to
   * start on login and it quietly did not.
   */
  function engineCheck(facts) {
    var engine = (facts || {}).engine || {};
    var service = engine.service || {};
    if (engine.running) {
      return check('engine', 'Engine', OK, 'Running on port ' + engine.port + '.');
    }
    if (service.available && service.enabled && !service.active) {
      // Enabled means the user asked for this, so it not running is a fault.
      return check(
        'engine', 'Engine', BAD,
        'The ' + (service.unit || 'user service') + ' is enabled to start on login but is not running.',
        'In a terminal: systemctl --user start ' + (service.unit || 'neuraos-engine') + ', and check systemctl --user status for why it stopped.'
      );
    }
    // Not enabled is the default and not worth a word: `service.available`
    // only means systemd user sessions work, which is true on nearly every
    // machine, so warning here would cry wolf on all of them.
    return check('engine', 'Engine', OK, 'Not running. NeuraOS starts it when you open a chat that needs it.');
  }

  /**
   * gitCheck(facts)
   *
   * git missing is a warning: most of the app works without it, and demanding
   * it would make a false alarm of a normal install. git present but with no
   * identity is worse than either, because every commit fails with a message
   * that looks like the app's fault, and it is the single most common reason a
   * first-time user's first commit does not work.
   */
  function gitCheck(facts) {
    var git = (facts || {}).git || {};
    if (!git.available) {
      return check('git', 'Git', WARN, 'Not installed. Commits and version history are unavailable.', '');
    }
    if (!git.name || !git.email) {
      return check(
        'git', 'Git', BAD,
        'Installed, but git does not know who you are, so every commit will fail.',
        'In a terminal: git config --global user.name "Your Name" and git config --global user.email "you@example.com".'
      );
    }
    return check('git', 'Git', OK, 'Committing as ' + git.name + ' <' + git.email + '>.');
  }

  /**
   * keysCheck(facts)
   *
   * Never `bad`. A key is optional by design -- the app works without a
   * Hugging Face token, and says so at the point of use. This is a `warn` so
   * the person setting the app up finds out now rather than when a model call
   * fails. The value is not here and cannot be: the doctor reports presence
   * only, so this is safe to paste into an issue.
   */
  function keysCheck(facts) {
    var keys = (facts || {}).keys || {};
    if (keys.hf_token) {
      return check('keys', 'Hugging Face', OK, 'Signed in. The token is in the OS keyring.');
    }
    return check(
      'keys', 'Hugging Face', WARN,
      'No token saved. Public models work; private repos and Inference Providers need one.',
      ''
    );
  }

  /**
   * toolsCheck(facts)
   *
   * The command-line tools the app's own skills shell out to. All `warn`,
   * never `bad`: a missing `ffmpeg` breaks one skill, not the app, and a
   * doctor that cried wolf about optional tools would be ignored wholesale.
   *
   * Which ones are worth naming at all is a judgement, and it is made once,
   * here, rather than by showing all seven to somebody who wants one of them.
   */
  var TOOL_LABELS = {
    git: 'git',
    curl: 'curl',
    jq: 'jq',
    rg: 'ripgrep',
    ffmpeg: 'ffmpeg',
    docker: 'Docker',
    systemctl: 'systemd',
  };
  // Only the tools the app's own skills actually reach for are named. Docker
  // and systemd are in the facts because the Doctor shows them when they are
  // present and idle, but a machine with neither did not intend to run
  // containers, so their absence is not news.
  var MENTIONED_TOOLS = ['git', 'curl', 'jq', 'rg', 'ffmpeg'];

  function toolsCheck(facts) {
    var tools = (facts || {}).tools || {};
    var missing = [];
    for (var i = 0; i < MENTIONED_TOOLS.length; i++) {
      var tool = MENTIONED_TOOLS[i];
      if (tools[tool] !== true) missing.push(TOOL_LABELS[tool] || tool);
    }
    if (!missing.length) {
      return check('tools', 'Command-line tools', OK, 'The tools skills use are all here.');
    }
    return check(
      'tools', 'Command-line tools', WARN,
      'Not installed: ' + missing.join(', ') + '. A skill that needs one will say so when used.',
      ''
    );
  }

  /**
   * runtimesCheck(facts)
   *
   * Local models are entirely optional, so this is only ever a `warn`, and
   * only when the machine has plainly been set up for them (a GPU is reported)
   * but the runtime is missing -- which is the state that looks like a bug.
   */
  function runtimesCheck(facts) {
    var runtimes = (facts || {}).runtimes || {};
    if (runtimes.llama) {
      return check('runtimes', 'Local models', OK, 'llama.cpp is installed, so local GGUF models will run.');
    }
    if (runtimes.gpu) {
      return check(
        'runtimes', 'Local models', WARN,
        'A GPU was found, but llama.cpp is not installed yet.',
        ''
      );
    }
    return check('runtimes', 'Local models', OK, 'Optional. Local models are off until you install a runtime.');
  }

  /**
   * buildChecks(facts)
   *
   * Every check, in the order a person would fix them: the hard requirement
   * first, then the things that are broken, then the things that are merely
   * worth knowing. A doctor that lists the GPU before Node is a doctor nobody
   * reads to the end.
   */
  function buildChecks(facts) {
    var checks = [
      nodeCheck(facts),
      engineCheck(facts),
      gitCheck(facts),
      keysCheck(facts),
      runtimesCheck(facts),
      toolsCheck(facts),
    ];
    var order = {};
    order[BAD] = 0;
    order[WARN] = 1;
    order[OK] = 2;
    // Array.prototype.sort is stable, so checks of the same state keep the
    // order above -- which is the order they were written in, deliberately.
    return checks.slice().sort(function (a, b) {
      return order[a.state] - order[b.state];
    });
  }

  /**
   * summarize(checks)
   *
   * The one line at the top of the card. Its job is to be true in the
   * degenerate cases: a healthy machine says so plainly rather than "0 issues"
   * with a list of green rows, and a machine with nothing set up says that,
   * which is a different message from "broken".
   */
  function summarize(checks) {
    var list = Array.isArray(checks) ? checks : [];
    var bad = 0;
    var warn = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].state === BAD) bad++;
      else if (list[i].state === WARN) warn++;
    }
    if (bad > 0) {
      return bad + (bad === 1 ? ' thing needs' : ' things need') + ' fixing before NeuraOS works properly.';
    }
    if (warn > 0) {
      return warn + (warn === 1 ? ' thing is' : ' things are') + ' worth knowing about. NeuraOS works.';
    }
    return 'Everything NeuraOS depends on is here.';
  }

  /**
   * overallState(checks)
   *
   * 'bad' if anything is bad, else 'warn', else 'ok'. Separate from summarize
   * so a card can colour itself without parsing a sentence.
   */
  function overallState(checks) {
    var list = Array.isArray(checks) ? checks : [];
    var warned = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].state === BAD) return BAD;
      if (list[i].state === WARN) warned = true;
    }
    return warned ? WARN : OK;
  }

  return {
    OK: OK,
    WARN: WARN,
    BAD: BAD,
    buildChecks: buildChecks,
    summarize: summarize,
    overallState: overallState,
  };
});
