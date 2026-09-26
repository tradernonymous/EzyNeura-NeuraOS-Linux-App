// The Doctor (upgrade plan D6): one screen that checks everything NeuraOS
// depends on and, for every failure, says the fix. This module is the pure
// half -- the facts arrive as plain data, the answer is rows -- so node:test
// can walk every verdict without a Tauri window and the screen only gathers.
//
// The shape of a row never changes: what was checked, whether it passed, what
// was found, and (when it did not pass) the exact command or the exact place
// in the app that fixes it. A check that does not apply on this machine is
// 'skip', not 'ok': optional things passing quietly is how a doctor turns
// into decoration.
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UDoctor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // One shell line for everything that is a presence or a config read. It is
  // read-only by construction: `command -v`, `git config --get`, `df`.
  function probeCommand() {
    return (
      'for t in git xdotool bwrap docker podman; do ' +
      'command -v "$t" >/dev/null 2>&1 && echo "tool:$t=yes" || echo "tool:$t=no"; done; ' +
      'echo "name:$(git config --get user.name 2>/dev/null)"; ' +
      'echo "email:$(git config --get user.email 2>/dev/null)"; ' +
      "df --output=avail -B1073741824 . 2>/dev/null | tail -1 | tr -d ' ' | sed 's/^/disk:/'"
    );
  }

  /** The probe's stdout parsed into facts. Tolerates every line it does not know. */
  function parseProbe(stdout) {
    var out = { tools: {}, name: '', email: '', diskGb: null };
    var lines = String(stdout == null ? '' : stdout).split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var at = lines[i].indexOf(':');
      if (at <= 0) continue;
      var key = lines[i].slice(0, at).trim();
      var value = lines[i].slice(at + 1).trim();
      // A tool line is `tool:git=yes`: the first colon ends the key at
      // "tool", so the name arrives inside the value.
      if (key === 'tool') {
        var eq = value.indexOf('=');
        if (eq > 0) out.tools[value.slice(0, eq).trim()] = value.slice(eq + 1).trim() === 'yes';
      } else if (key === 'name') out.name = value;
      else if (key === 'email') out.email = value;
      else if (key === 'disk') {
        var gb = Number(value);
        if (Number.isFinite(gb)) out.diskGb = gb;
      }
    }
    return out;
  }

  // The apt package for the probes the doctor runs. Duplicated from
  // skill-lint.js on purpose: the doctor must not fail to answer because a
  // different module did not load, and these four lines are stable.
  var APT = { git: 'git', xdotool: 'xdotool', bwrap: 'bubblewrap', docker: 'docker.io', podman: 'podman' };

  function row(id, title, state, note, fix) {
    return { id: id, title: title, state: state, note: note || '', fix: fix || '' };
  }

  /**
   * verdicts(facts)
   *
   * facts.shell       the Tauri shell is present (false in a plain browser)
   * facts.node        EngineNode from the shell: { found, ok, major, reason }
   * facts.engine      EngineStatus: { running, port, url }
   * facts.localModel  LocalModelStatus: { state, repo, file, ... }
   * facts.imageServer LocalServerFacts: { found, path }
   * facts.hfSignedIn  a Hugging Face token or OAuth session is present
   * facts.byokKeys    how many of the user's own provider keys are in the keyring
   * facts.probe       parseProbe(...) of the probe command, or null
   * facts.platform    'linux' | 'windows' (windows skips the POSIX probes)
   *
   * Every row: { id, title, state: ok|warn|fail|skip, note, fix }.
   */
  function verdicts(facts) {
    var f = facts || {};
    var shell = f.shell !== false;
    var probe = f.probe || null;
    var platform = f.platform || 'linux';
    var rows = [];

    // The engine: the app is a shell without it.
    if (!shell) {
      rows.push(row('engine', 'Bundled engine', 'skip', 'This window has no shell (a plain browser build).'));
    } else if (f.engine && f.engine.running) {
      rows.push(row('engine', 'Bundled engine', 'ok', 'Running on ' + (f.engine.url || '127.0.0.1:' + f.engine.port) + '.'));
    } else {
      rows.push(row('engine', 'Bundled engine', 'fail', 'Not running.', 'Settings → Engine → “Run the engine on this machine”.'));
    }

    // Node: what the engine runs on.
    if (!shell) {
      rows.push(row('node', 'Node.js (for the engine)', 'skip', 'This window has no shell.'));
    } else if (f.node && f.node.ok) {
      rows.push(row('node', 'Node.js (for the engine)', 'ok', 'Node ' + f.node.major + ' at ' + (f.node.path || 'PATH') + '.'));
    } else if (f.node && f.node.found) {
      rows.push(row('node', 'Node.js (for the engine)', 'fail', f.node.reason || ('Node ' + f.node.major + ' is too old; the engine needs 24+.'),
        'Settings → Engine downloads Node 24 (sha256-checked), or install Node 24 or newer.'));
    } else {
      rows.push(row('node', 'Node.js (for the engine)', 'fail', f.node && f.node.reason ? f.node.reason : 'No Node found on PATH, in a login shell, or under ~/.nvm.',
        'Settings → Engine downloads Node 24, or: sudo apt install nodejs'));
    }

    // Git identity: every commit the app makes carries it.
    if (!shell || platform === 'windows' || !probe) {
      rows.push(row('git', 'Git identity', 'skip', 'Not probed on this build.'));
    } else if (probe.name && probe.email) {
      rows.push(row('git', 'Git identity', 'ok', probe.name + ' <' + probe.email + '>.'));
    } else if (probe.name || probe.email) {
      rows.push(row('git', 'Git identity', 'fail', 'Half set: ' + (probe.name || 'no user.name') + ', ' + (probe.email || 'no user.email') + '.',
        'git config --global user.name "Your Name"\ngit config --global user.email "you@example.com"'));
    } else {
      rows.push(row('git', 'Git identity', 'fail', 'Not set; git will refuse to commit.',
        'git config --global user.name "Your Name"\ngit config --global user.email "you@example.com"'));
    }

    // The command sandbox: one of the three, in that order of preference.
    if (!shell || platform === 'windows' || !probe) {
      rows.push(row('sandbox', 'Command sandbox', 'skip', 'Not probed on this build.'));
    } else if (probe.tools.bwrap) {
      rows.push(row('sandbox', 'Command sandbox', 'ok', 'bubblewrap: the project read-write, the host read-only, no network.'));
    } else if (probe.tools.docker || probe.tools.podman) {
      rows.push(row('sandbox', 'Command sandbox', 'ok', (probe.tools.docker ? 'Docker' : 'Podman') + ' container sandbox (bubblewrap is lighter: sudo apt install bubblewrap).'));
    } else {
      rows.push(row('sandbox', 'Command sandbox', 'warn', 'Nothing found: agent commands run unsandboxed.', 'sudo apt install bubblewrap'));
    }

    // Voice Type and desktop control need xdotool on X11.
    if (!shell || platform === 'windows' || !probe) {
      rows.push(row('xdotool', 'Voice Type and desktop control', 'skip', 'Not probed on this build.'));
    } else if (probe.tools.xdotool) {
      rows.push(row('xdotool', 'Voice Type and desktop control', 'ok', 'xdotool is on PATH.'));
    } else {
      rows.push(row('xdotool', 'Voice Type and desktop control', 'warn', 'xdotool is missing: Voice Type cannot type into other apps.', 'sudo apt install xdotool'));
    }

    // Hugging Face access: the free tier the app leads with.
    if (f.hfSignedIn) {
      rows.push(row('hf', 'Hugging Face access', 'ok', 'Signed in; Inference Providers are available.'));
    } else {
      rows.push(row('hf', 'Hugging Face access', 'warn', 'Not signed in: the free Hugging Face models are unavailable.',
        'Library → Sign in to Hugging Face (a token works too; Test it there).'));
    }

    // The user's own keys are optional by design.
    if (f.byokKeys > 0) {
      rows.push(row('keys', 'Your own provider keys', 'ok', f.byokKeys + ' key' + (f.byokKeys === 1 ? '' : 's') + ' in the OS keyring.'));
    } else {
      rows.push(row('keys', 'Your own provider keys', 'skip', 'None — the free tiers need none. Add one in Settings → Providers.'));
    }

    // Local model server: optional, so absent is a skip and broken is a fail.
    if (f.localModel && f.localModel.state === 'ready') {
      rows.push(row('model', 'Local model server', 'ok', (f.localModel.repo || f.localModel.file || 'a model') + ' is serving on port ' + f.localModel.port + '.'));
    } else if (f.localModel && f.localModel.state === 'error') {
      rows.push(row('model', 'Local model server', 'fail', f.localModel.detail || 'The server failed to start.',
        'Settings → Local models → stop it, then Start again; the log says why.'));
    } else {
      rows.push(row('model', 'Local model server', 'skip', 'Not running — optional. Settings → Local models sets one up on this PC.'));
    }

    // Image server (stable-diffusion.cpp): optional the same way.
    if (f.imageServer && f.imageServer.found) {
      rows.push(row('image', 'Image server (this PC)', 'ok', 'Found at ' + (f.imageServer.path || 'the usual places') + '.'));
    } else {
      rows.push(row('image', 'Image server (this PC)', 'skip', 'Not found — optional. Create → Image → Choose sd-server.'));
    }

    // Disk space: model downloads are multi-GB.
    if (probe && probe.diskGb != null) {
      if (probe.diskGb < 5) {
        rows.push(row('disk', 'Free disk space', 'fail', probe.diskGb + ' GB free — a model download will not fit.',
          'Free up space in the home folder (ncdu or the Mint menu’s Disk Usage viewer).'));
      } else if (probe.diskGb < 20) {
        rows.push(row('disk', 'Free disk space', 'warn', probe.diskGb + ' GB free — one large model at most.'));
      } else {
        rows.push(row('disk', 'Free disk space', 'ok', probe.diskGb + ' GB free.'));
      }
    } else {
      rows.push(row('disk', 'Free disk space', 'skip', 'Not probed on this build.'));
    }

    return rows;
  }

  /** One line over the rows: what to tell the person. */
  function summary(rows) {
    var list = rows || [];
    var fail = list.filter(function (r) { return r.state === 'fail'; }).length;
    var warn = list.filter(function (r) { return r.state === 'warn'; }).length;
    if (fail && warn) return fail + ' to fix, ' + warn + ' worth knowing about.';
    if (fail) return fail + ' to fix.';
    if (warn) return warn + ' worth knowing about.';
    return 'Everything checked passes.';
  }

  /** The report as text, for the Copy button (never includes secrets by construction: there are none in the rows). */
  function report(rows) {
    return (rows || []).map(function (r) {
      var mark = r.state === 'ok' ? 'ok  ' : r.state === 'skip' ? 'skip' : r.state === 'warn' ? 'warn' : 'FAIL';
      return mark + '  ' + r.title + ' — ' + (r.note || '') + (r.fix ? '\n      fix: ' + r.fix.replace(/\n/g, '\n           ') : '');
    }).join('\n');
  }

  return {
    probeCommand: probeCommand,
    parseProbe: parseProbe,
    verdicts: verdicts,
    summary: summary,
    report: report,
  };
});
