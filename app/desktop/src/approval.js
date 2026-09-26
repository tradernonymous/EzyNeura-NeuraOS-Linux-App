// The composer row's two decisions: how much the agent asks, and which tools
// it is offered.
//
// APPROVAL. The app already has an approval mode -- `always | commands | never`
// in `freeai4u.code_approval` (project-config.js reads it, coding-agent.js
// obeys it) -- and an opt-in Docker sandbox for commands
// (`freeai4u.docker_sandbox`, docker-sandbox.js). The composer shows four
// levels, and each one is nothing more than a pair of those two existing
// facts:
//
//   ask      always   + no container   every mutation waits for a yes
//   delegate commands + no container   edits apply, commands still ask
//   sandbox  never    + container      no prompts; commands run in Docker
//   full     never    + no container   no prompts, no container
//
// Nothing new is stored, because both facts already have an owner, and one
// fact with two owners is a fact that can disagree with itself. Reading the
// level back therefore reads the machinery, not a remembered label: turning
// the Docker checkbox off in Code really does turn "Run in the sandbox" into
// "Full access", and the menu says so rather than pretending otherwise.
//
// THE RULE THAT SURVIVES ALL OF THIS: a folder's `.freeai4u.json` can only
// make the setting stricter. `effectiveLevel` does not re-implement that --
// it goes through project-config.merge, the one place the intersection lives,
// so the menu cannot become a second, laxer opinion about the same question.
//
// TOOL GROUPS. Which of Search / Code / MCP the next turn may use, kept in
// `freeai4u.composer_tools`. `groupOf` and `offered` are the pure filter over
// a tools.js catalogue.
//
// UMD like the repo's other shared modules, with project-config and
// docker-sandbox read the way evals.js reads recipes.js.
(function (root, factory) {
  // Real CommonJS only (see files/office.js): in a bundle `module` can exist
  // without `require`, and there the siblings are read off the globals they
  // publish.
  var isCjs = typeof module === 'object' && module.exports && typeof require === 'function';
  var config = isCjs ? require('./project-config.js') : null;
  var sandbox = isCjs ? require('./docker-sandbox.js') : null;
  var api = factory(
    function () { return config || (root && root.FreeAI4UProjectConfig) || null; },
    function () { return sandbox || (root && root.FreeAI4UDockerSandbox) || null; },
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UApproval = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (projectConfigLib, sandboxLib) {
  /** The person's own coding-agent settings (CodeScreen's CODE_APPROVAL_KEY). */
  var KEY = 'freeai4u.code_approval';
  /** Which tool groups the next turn may use. */
  var GROUPS_KEY = 'freeai4u.composer_tools';

  /**
   * The four levels, strictest first -- the order is the strictness rank, so
   * `rank` is an index and "never looser" is a comparison.
   *
   * `why` is the one line under the label. It says what will happen, in the
   * order it will happen, and never names a stored value.
   */
  var LEVELS = [
    {
      id: 'ask',
      label: 'Ask for approval',
      why: 'Nothing happens until you say yes: every file edit and every command is shown to you first.',
      mode: 'always',
      sandbox: false,
      risk: '',
    },
    {
      id: 'delegate',
      label: 'Approve for me',
      why: 'File edits apply as the agent makes them. Commands still wait for you, so anything destructive, anything needing a password and anything reaching for your credentials is shown first.',
      mode: 'commands',
      sandbox: false,
      risk: '',
    },
    {
      id: 'sandbox',
      label: 'Run in the sandbox',
      why: 'No prompts. Commands run in a throwaway Docker container with only this folder mounted, so the rest of your machine is out of reach. File edits still land in the folder. Needs Docker running.',
      mode: 'never',
      sandbox: true,
      risk: '',
    },
    {
      id: 'full',
      label: 'Full access',
      why: 'No prompts and no container. The agent edits files and runs commands on this PC as soon as it decides to.',
      mode: 'never',
      sandbox: false,
      risk: 'high',
    },
  ];

  /** The one a missing, unknown or unreadable value falls back to. */
  var STRICTEST = LEVELS[0].id;

  var GROUPS = [
    { id: 'search', label: 'Search', hint: 'Let the model search the web and read a page' },
    { id: 'code', label: 'Code', hint: 'Let the model read this folder and its repositories, write files and run commands' },
    { id: 'mcp', label: 'MCP', hint: 'Let the model call the tools on the MCP servers you added' },
  ];

  var CODE_TOOLS = ['list_files', 'read_file', 'write_file', 'edit_file', 'run_command'];

  function storage(given) {
    if (given) return given;
    try {
      var scope = typeof globalThis !== 'undefined' ? globalThis : {};
      return scope.localStorage || null;
    } catch {
      return null;
    }
  }

  function readJson(store, key) {
    var target = storage(store);
    if (!target) return null;
    try {
      var raw = target.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      // Unreadable or nonsense: every caller below treats null as "unset",
      // and unset is the strict end of every one of these settings.
      return null;
    }
  }

  function writeJson(store, key, value) {
    var target = storage(store);
    if (!target) return false;
    try {
      target.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  // --- the levels ---------------------------------------------------------

  /** The level with this id, or null. */
  function byId(id) {
    for (var i = 0; i < LEVELS.length; i += 1) {
      if (LEVELS[i].id === id) return LEVELS[i];
    }
    return null;
  }

  /** The level with this id, or the strictest one -- never undefined. */
  function levelOr(id) {
    return byId(id) || byId(STRICTEST);
  }

  /** How strict a level is: 0 is strictest, and bigger is looser. */
  function rank(id) {
    for (var i = 0; i < LEVELS.length; i += 1) {
      if (LEVELS[i].id === id) return i;
    }
    return 0;
  }

  /** The level a stored approval mode and a Docker setting add up to. */
  function levelFor(mode, sandboxOn) {
    if (mode === 'commands') return 'delegate';
    if (mode === 'never') return sandboxOn ? 'sandbox' : 'full';
    // 'always' and anything unrecognised: the strict end, which is also what
    // project-config falls back to for a value it does not know.
    return STRICTEST;
  }

  /** What this level asks the approval gate for. */
  function modeFor(id) {
    return levelOr(id).mode;
  }

  /** Whether this level wants commands wrapped in the Docker sandbox. */
  function sandboxFor(id) {
    return levelOr(id).sandbox;
  }

  /**
   * effectiveLevel(id, projectConfig) -> the level that will actually apply in
   * a folder whose `.freeai4u.json` parsed to `projectConfig`.
   *
   * The clamp is project-config.merge itself, so a project file can only ever
   * move this towards the strict end. A file that asks for less is ignored
   * there, and there is no second opinion here.
   */
  function effectiveLevel(id, projectConfig) {
    var pc = projectConfigLib();
    var chosen = levelOr(id);
    if (!pc) return STRICTEST;
    var merged = pc.merge({ approvalMode: chosen.mode, allowedCommands: [] }, projectConfig);
    return levelFor(merged.approvalMode, chosen.sandbox);
  }

  /**
   * The level in force right now, read from the two settings themselves. A
   * missing or broken value reads as the strictest level, because that is
   * what the agent would do with it.
   */
  function current(store) {
    var pc = projectConfigLib();
    var sb = sandboxLib();
    if (!pc) return STRICTEST;
    var mine = pc.globalSettings(readJson(store, KEY));
    var docker = sb ? sb.settings(storage(store)) : { enabled: false };
    return levelFor(mine.approvalMode, docker.enabled === true);
  }

  /**
   * choose(id) -> the id that is now in force.
   *
   * Writes the approval mode the person already owns and the Docker setting
   * they already own, and keeps the commands they allowed: picking a level is
   * a change of one decision, not a reset of the rest.
   */
  function choose(id, store) {
    var pc = projectConfigLib();
    var sb = sandboxLib();
    if (!pc) return STRICTEST;
    var level = levelOr(id);
    var mine = pc.globalSettings(readJson(store, KEY));
    writeJson(store, KEY, { approvalMode: level.mode, allowedCommands: mine.allowedCommands });
    if (sb) {
      var target = storage(store);
      sb.saveSettings({ enabled: level.sandbox, image: sb.settings(target).image }, target);
    }
    return current(store);
  }

  // --- the tool groups ----------------------------------------------------

  /** Every group id, in the order the chips are drawn. */
  function groupIds() {
    return GROUPS.map(function (group) { return group.id; });
  }

  /** The group a tool belongs to, or '' for one no chip governs. */
  function groupOf(name) {
    var n = String(name == null ? '' : name);
    if (n.indexOf('mcp__') === 0) return 'mcp';
    if (n === 'web_search' || n === 'web_fetch') return 'search';
    if (n.indexOf('github_') === 0) return 'code';
    return CODE_TOOLS.indexOf(n) >= 0 ? 'code' : '';
  }

  /** The groups that are on. Unset or broken means all of them. */
  function readGroups(store) {
    var stored = readJson(store, GROUPS_KEY);
    if (!Array.isArray(stored)) return groupIds();
    var known = groupIds();
    var on = [];
    for (var i = 0; i < stored.length; i += 1) {
      if (known.indexOf(stored[i]) >= 0 && on.indexOf(stored[i]) < 0) on.push(stored[i]);
    }
    // Order by the chips, not by the order they happened to be switched on.
    return known.filter(function (id) { return on.indexOf(id) >= 0; });
  }

  function saveGroups(ids, store) {
    var wanted = Array.isArray(ids) ? ids : [];
    var on = groupIds().filter(function (id) { return wanted.indexOf(id) >= 0; });
    return writeJson(store, GROUPS_KEY, on) ? on : readGroups(store);
  }

  /** `ids` with one group turned on or off -- the chips' whole behaviour. */
  function toggleGroup(ids, id) {
    var on = Array.isArray(ids) ? ids.slice() : [];
    var at = on.indexOf(id);
    if (at >= 0) on.splice(at, 1);
    else if (groupIds().indexOf(id) >= 0) on.push(id);
    return groupIds().filter(function (known) { return on.indexOf(known) >= 0; });
  }

  /**
   * offered(catalogue, ids) -> the tool definitions a turn with these groups
   * on may use. A tool no chip governs (delegation, say) is always offered:
   * a chip turns off what it names, not what it does not.
   */
  function offered(catalogue, ids) {
    var on = Array.isArray(ids) ? ids : groupIds();
    return (Array.isArray(catalogue) ? catalogue : []).filter(function (def) {
      var name = def && def.function ? def.function.name : (def && def.name);
      var group = groupOf(name);
      return !group || on.indexOf(group) >= 0;
    });
  }

  // --- read-only presets (C11) ------------------------------------------------
  //
  // "Allow a list of known read-only commands once per project ... and keep
  // Ask for everything else." Two halves: a curated list where no argument
  // can turn the command into a change (one test decides that, and a chain,
  // redirect or dangerous flag anywhere fails it), and a per-folder switch
  // the person throws once. Reading never needed approval in this app
  // (tools.js: "Reading never asks"), so this grants no new visibility --
  // only a way for `git status` to stop being a speed bump in a folder the
  // person said so about. It can only ever make a turn ask LESS: with the
  // preset off, every gate below still says "ask".

  /** Chaining and redirection, tested on the RAW line: a newline is a chain. */
  var CHAINING = /[;&|<>`$()\n\r\\]/;

  /** First words where any flags are still a viewer. */
  var READONLY = [
    'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'stat', 'file', 'which', 'readlink', 'realpath',
    'du', 'df', 'free', 'uname', 'id', 'whoami', 'uptime', 'ps', 'lscpu', 'lsblk', 'lsmod',
    'grep', 'rg', 'find', 'fd', 'diff', 'cmp', 'md5sum', 'sha256sum', 'cksum', 'od', 'strings',
    'nl', 'dirname', 'basename', 'echo', 'printf', 'journalctl', 'nslookup', 'dig', 'date',
  ];

  /**
   * First word -> the subcommands/flags that keep it read-only. The second
   * token must be here or the command asks: `git status` reads, `git commit`
   * and `npm install` do not, and `node -e` executes.
   */
  var PAIRS = {
    git: ['status', 'log', 'diff', 'show', 'describe', 'blame', 'shortlog', 'rev-parse',
      'ls-files', 'ls-tree', 'reflog', 'grep', 'version', '--version', 'branch', 'tag', 'remote', 'stash', 'config'],
    npm: ['ls', 'list', 'view', 'outdated', 'explain', 'why', '-v', '--version'],
    docker: ['ps', 'images', 'logs', 'version', 'inspect', 'port'],
    systemctl: ['status', 'is-active', 'is-enabled', 'show', 'cat', 'list-units', 'list-timers', 'list-unit-files'],
    pip: ['list', 'freeze', 'show', 'check'],
    node: ['-v', '--version'],
    python: ['--version', '-V'],
    python3: ['--version', '-V'],
    go: ['version'],
    cargo: ['--version', '-V'],
    rustc: ['--version', '-V'],
    java: ['-version'],
    gcc: ['--version'],
    'g++': ['--version'],
    clang: ['--version'],
    make: ['--version'],
  };

  /**
   * git <sub> -> the rule for the tokens AFTER the subcommand, for the verbs
   * that read harmless until you look at the arguments: `git branch foo`
   * CREATES a branch, `git remote add` adds one, `git stash` commits the
   * worktree, `git config a b` writes the config.
   */
  var GIT_REST = {
    branch: function (rest) { return rest.every(isFlag); },
    tag: function (rest) {
      var pastList = false;
      return rest.every(function (t) { if (pastList) return true; if (t === '-l') { pastList = true; return true; } return isFlag(t); });
    },
    remote: function (rest) {
      if (!rest.length) return true;
      if (rest[0] === '-v') return rest.slice(1).every(isFlag);
      return rest[0] === 'show';
    },
    stash: function (rest) { return (rest[0] === 'list' || rest[0] === 'show') && rest.slice(1).every(isFlag); },
    config: function (rest) {
      return rest.length && ['--get', '--get-all', '--get-regexp', '--list', '-l'].indexOf(rest[0]) >= 0;
    },
  };

  /**
   * Tokens that write, execute or follow, wherever they appear: `find
   * -delete`, `find -exec rm`, `tail -f`, `git log --output=x`, `git branch
   * -d`. `-d`/`-D` are here for git's sake (`git branch -d` deletes); `ls -d`
   * asking again is the price, and asking again is the safe side.
   */
  var NEVER = {
    '-f': 1, '-rf': 1, '--follow': 1, '--force': 1, '--output': 1,
    '-d': 1, '-D': 1, '--delete': 1,
    '-exec': 1, '--exec': 1, '-execdir': 1, '-ok': 1, '-okdir': 1, '-delete': 1,
    '-fls': 1, '-fprint': 1, '-fprint0': 1, '-fprintf': 1, '-fputs': 1,
  };

  /** First word -> extra rule for its arguments. */
  var FIRST_RULES = {
    // `date -s` SETS the clock.
    date: function (rest) { return rest.indexOf('-s') < 0 && rest.indexOf('--set') < 0; },
  };

  function has(map, key) {
    return Object.prototype.hasOwnProperty.call(map, String(key == null ? '' : key));
  }

  function isFlag(t) {
    return String(t == null ? '' : t).charAt(0) === '-';
  }

  /**
   * isReadonlyCommand(command) -> whether this exact command is on the known
   * read-only list. Anything the rules do not understand asks -- the preset
   * is an allowlist, never a heuristic.
   */
  function isReadonlyCommand(command) {
    var raw = String(command == null ? '' : command);
    if (!raw.trim() || CHAINING.test(raw)) return false;
    var tokens = raw.replace(/\s+/g, ' ').trim().split(' ');
    for (var i = 0; i < tokens.length; i += 1) {
      // `--output=x` is the same flag as `--output`: the value side never
      // makes a forbidden flag safe.
      if (has(NEVER, tokens[i]) || has(NEVER, tokens[i].split('=')[0])) return false;
    }
    var head = tokens[0];
    var rest = tokens.slice(1);
    if (has(PAIRS, head)) {
      var sub = rest.length ? rest[0] : '';
      if (!sub || PAIRS[head].indexOf(sub) < 0) return false;
      var tail = rest.slice(1);
      if (head === 'git' && has(GIT_REST, sub)) return GIT_REST[sub](tail);
      return true;
    }
    if (READONLY.indexOf(head) >= 0) {
      return has(FIRST_RULES, head) ? FIRST_RULES[head](rest) : true;
    }
    return false;
  }

  /** The folders the person switched the preset on for. */
  var PRESET_KEY = 'freeai4u.readonly_projects';
  var MAX_PROJECTS = 100;

  function presetList(store) {
    var rows = readJson(store, PRESET_KEY);
    if (!Array.isArray(rows)) return [];
    return rows.filter(function (r) { return typeof r === 'string' && r; });
  }

  /** The folders the switch is on for (Activity shows them, with a way off). */
  function presetProjects(store) {
    return presetList(store).slice();
  }

  function folderKey(folder) {
    return String(folder == null ? '' : folder).trim();
  }

  /** Whether the preset is on for this folder. No folder is never on. */
  function presetOn(folder, store) {
    var key = folderKey(folder);
    return !!key && presetList(store).indexOf(key) >= 0;
  }

  /** Throw the switch for this folder; false only when storage refuses. */
  function allowPreset(folder, store) {
    var key = folderKey(folder);
    if (!key) return false;
    var rows = presetList(store);
    if (rows.indexOf(key) >= 0) return true;
    rows.push(key);
    if (rows.length > MAX_PROJECTS) rows = rows.slice(rows.length - MAX_PROJECTS);
    return writeJson(store, PRESET_KEY, rows);
  }

  function revokePreset(folder, store) {
    var key = folderKey(folder);
    var rows = presetList(store).filter(function (r) { return r !== key; });
    return writeJson(store, PRESET_KEY, rows);
  }

  /**
   * presetAllows(folder, tool, args) -> whether the gate may skip its question:
   * the folder's switch is on, the tool is a command, and the command is on
   * the read-only list. Everything else keeps asking.
   */
  function presetAllows(folder, tool, args, store) {
    if (String(tool == null ? '' : tool) !== 'run_command') return false;
    if (!presetOn(folder, store)) return false;
    return isReadonlyCommand(args && args.command);
  }

  return {
    KEY: KEY,
    GROUPS_KEY: GROUPS_KEY,
    LEVELS: LEVELS,
    STRICTEST: STRICTEST,
    GROUPS: GROUPS,
    byId: byId,
    rank: rank,
    levelFor: levelFor,
    modeFor: modeFor,
    sandboxFor: sandboxFor,
    effectiveLevel: effectiveLevel,
    current: current,
    choose: choose,
    groupIds: groupIds,
    groupOf: groupOf,
    readGroups: readGroups,
    saveGroups: saveGroups,
    toggleGroup: toggleGroup,
    offered: offered,
    // C11: the read-only preset.
    PRESET_KEY: PRESET_KEY,
    READONLY: READONLY,
    PAIRS: PAIRS,
    isReadonlyCommand: isReadonlyCommand,
    presetOn: presetOn,
    presetProjects: presetProjects,
    allowPreset: allowPreset,
    revokePreset: revokePreset,
    presetAllows: presetAllows,
  };
});
