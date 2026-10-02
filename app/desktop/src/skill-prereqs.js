// What a skill needs before it can work (B7 of docs/APP_UPGRADE_PLAN.md).
//
// A skill that shells out to a tool the machine does not have fails at the
// moment it is chosen, in the middle of a task, with whatever error the tool
// chose to print. That is the worst time to find out. The fix is to know it
// before the install, where the answer is still cheap.
//
// A skill declares its prerequisites in one of two ways, and both are read
// here:
//
//   - a `compatibility:` key in the frontmatter, listing tools;
//   - a "Prerequisites" (or "Requirements") section in the body, naming tools.
//
// Neither is authoritative -- only the machine is -- so this module's job ends
// at *naming* what to check. `checkPrerequisites` takes a lookup function from
// the caller, because only the Rust side can ask the real PATH, and this stays
// pure so node:test can drive it with a fake machine.
//
// Pure and UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4USkillPrereqs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // The tools the app knows something useful about: the apt line that installs
  // it on Debian/Ubuntu (this is a Mint app), and -- where the app ships one --
  // the runtime key from runtimes.rs, so the card can offer a one-click install
  // instead of a command line the user has to know.
  //
  // Deliberately short. A table of every tool in the world is a table that is
  // wrong the day a package is renamed, and a wrong apt line is worse than no
  // apt line: it sends the user to a command that fails. A tool that is not
  // here is still checked on PATH, and simply gets no install hint.
  var KNOWN = {
    node: { apt: 'nodejs', label: 'Node.js' },
    npm: { apt: 'npm', label: 'npm' },
    nvm: { apt: null, label: 'nvm', note: 'Install nvm from its own script; it is not in apt.' },
    python3: { apt: 'python3', label: 'Python 3' },
    pip3: { apt: 'python3-pip', label: 'pip' },
    git: { apt: 'git', label: 'git' },
    curl: { apt: 'curl', label: 'curl' },
    jq: { apt: 'jq', label: 'jq' },
    docker: { apt: 'docker.io', label: 'Docker' },
    ffmpeg: { apt: 'ffmpeg', label: 'ffmpeg' },
    ollama: { apt: null, label: 'Ollama', note: 'Install from ollama.com, or let NeuraOS install it.' },
    llama: { apt: 'llama.cpp', label: 'llama.cpp' },
    'llama-server': { apt: 'llama.cpp', label: 'llama.cpp server' },
    rg: { apt: 'ripgrep', label: 'ripgrep' },
    grep: { apt: 'grep', label: 'grep' },
    make: { apt: 'build-essential', label: 'build tools' },
    gcc: { apt: 'build-essential', label: 'build tools' },
    sqlite3: { apt: 'sqlite3', label: 'sqlite3' },
    systemctl: { apt: null, label: 'systemd', note: 'Not a package: it is part of the system, and NeuraOS only uses it for timers.' },
    flatpak: { apt: 'flatpak', label: 'flatpak' },
    rsync: { apt: 'rsync', label: 'rsync' },
    unzip: { apt: 'unzip', label: 'unzip' },
    tar: { apt: null, label: 'tar', note: 'Part of the base system; only absent on a stripped image.' },
  };

  // Section headings that mean "this is where I list what I need".
  var PREREQ_HEADINGS = /^#{1,6}\s*(prerequisites|requirements|dependencies|before you start)\b/i;

  // A tool name as written in prose: a word, possibly with a version, possibly
  // with a leading "the". Versions are dropped, because PATH lookup asks
  // whether `git` is there, not whether exactly 2.43.0 is.
  function toolNames(text) {
    var out = [];
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^[\s>*+-]+/, '');
      if (!line) continue;
      // Backticked names are the author saying "this is a program name".
      var codes = line.match(/`([^`\s]+)`/g);
      if (codes) {
        for (var c = 0; c < codes.length; c++) {
          var name = normalize(codes[c].replace(/`/g, ''));
          if (name && out.indexOf(name) < 0) out.push(name);
        }
        continue;
      }
      // Otherwise take a leading "tool: description" or "tool - description".
      var lead = line.match(/^([A-Za-z][\w.+-]{1,30})\s*[:(-]/);
      if (lead) {
        var n = normalize(lead[1]);
        if (n && out.indexOf(n) < 0) out.push(n);
      }
    }
    return out;
  }

  function normalize(raw) {
    var name = String(raw == null ? '' : raw)
      .trim()
      .toLowerCase()
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[<>=~^]+\s*[\w.]+\s*$/, '')   // a trailing version constraint
      .replace(/^v/, '')
      .trim();
    // Not a program name: a sentence fragment, a path, a URL.
    if (!name || name.length > 30) return '';
    if (/[\s/\\]/.test(name)) return '';
    if (!/^[a-z][\w.+-]*$/.test(name)) return '';
    // Words that appear in a Prerequisites section as prose rather than as a
    // program. Keeping these would tell the user to install a package called
    // "internet" or "sudo".
    if (PROSE[name]) return '';
    return name;
  }

  var PROSE = {};
  [
    'internet', 'connection', 'sudo', 'root', 'bash', 'shell', 'terminal',
    'python', 'api', 'key', 'token', 'account', 'credentials', 'network',
    'disk', 'space', 'permission', 'access', 'read', 'write', 'linux', 'macos',
    'windows', 'editor', 'editorconfig', 'optional', 'note', 'warning',
  ].forEach(function (word) { PROSE[word] = true; });

  /**
   * prerequisites(skill)
   *
   * The tool names a skill declares, from its frontmatter and its body.
   * Deduped, in the order first seen, because that is the order the author
   * wrote them in and the order worth showing.
   */
  function prerequisites(skill) {
    var entry = skill || {};
    var found = [];
    var front = entry.frontmatter || entry.compatibility;
    if (Array.isArray(front)) {
      found = found.concat(front);
    } else if (front) {
      found = found.concat(String(front).split(/[\s,]+/));
    }

    var body = String(entry.content == null ? '' : entry.content);
    var inSection = false;
    var lines = body.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^#{1,6}\s/.test(line)) {
        // A heading ends the section as surely as a new one starts it.
        inSection = PREREQ_HEADINGS.test(line);
        continue;
      }
      if (inSection) found = found.concat(toolNames(line));
    }

    var out = [];
    for (var j = 0; j < found.length; j++) {
      var name = normalize(found[j]);
      if (name && out.indexOf(name) < 0) out.push(name);
    }
    return out;
  }

  /**
   * describe(name)
   *
   * What can be said about one tool without asking the machine: its label, its
   * apt line if there is one, and whether NeuraOS can install it itself.
   *
   * `runtime` is the one-click case. Only Node is offered, because it is the
   * only runtime runtimes.rs actually installs, and offering a button that
   * cannot work is worse than no button.
   */
  function describe(name) {
    var key = String(name == null ? '' : name).toLowerCase();
    var known = KNOWN[key] || {};
    return {
      name: key,
      label: known.label || key,
      apt: known.apt || null,
      note: known.note || '',
      runtime: key === 'node' ? 'node' : null,
      known: !!KNOWN[key],
    };
  }

  /**
   * checkPrerequisites(skill, isPresent)
   *
   * Asks the machine about each declared tool. `isPresent(toolName)` is the
   * caller's real PATH lookup -- injected, so this stays pure and so a caller
   * on a platform without a shell can pass something else.
   *
   * Returns { required, present, missing }. `missing` carries the describe()
   * record for each absent tool, so a card can render the apt line without
   * asking this module twice.
   */
  function checkPrerequisites(skill, isPresent) {
    var names = prerequisites(skill);
    var lookup = typeof isPresent === 'function' ? isPresent : function () { return false; };
    var present = [];
    var missing = [];
    for (var i = 0; i < names.length; i++) {
      var record = describe(names[i]);
      if (lookup(names[i])) present.push(record);
      else missing.push(record);
    }
    return { required: names, present: present, missing: missing };
  }

  /**
   * installHint(record)
   *
   * The sentence under a missing tool: what to type, or where it comes from.
   * Empty only when there is genuinely nothing to say, which the card renders
   * as a plain "not installed" rather than an empty line.
   */
  function installHint(record) {
    if (!record) return '';
    if (record.runtime) {
      return 'NeuraOS can install ' + record.label + ' for you.';
    }
    if (record.apt) return 'apt install ' + record.apt;
    if (record.note) return record.note;
    return '';
  }

  /**
   * missingWarning(missing)
   *
   * The sentence under a set of missing tools, or '' when there are none.
   *
   * A skill with an unmet prerequisite still installs. The tool may be added
   * later, and the skill may have a path that does not need it, so refusing
   * would be a worse default than saying so. What is not negotiable is
   * silence -- this is what stops the card from installing a skill and then
   * appearing to work.
   */
  function missingWarning(missing) {
    var list = Array.isArray(missing) ? missing : [];
    if (!list.length) return '';
    var names = list.map(function (r) { return r.label || r.name; });
    if (names.length === 1) {
      return 'This skill needs ' + names[0] + ', which is not on this machine. It will still install.';
    }
    return 'This skill needs ' + names.join(', ') + ', which are not all on this machine. It will still install.';
  }

  return {
    KNOWN: KNOWN,
    prerequisites: prerequisites,
    describe: describe,
    checkPrerequisites: checkPrerequisites,
    installHint: installHint,
    missingWarning: missingWarning,
    normalize: normalize,
  };
});
