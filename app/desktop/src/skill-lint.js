// What a skill costs and whether it is worth installing -- BEFORE it lands.
//
// The engine routes on every installed skill's name and description in every
// prompt, so a skill is not free: this module prices it (B2), lints it on
// install the way scripts/check-skills.mjs lints the packs this repo ships
// (B3), finds two skills the router will not be able to tell apart (B4), and
// lists the tools a skill needs with the apt line for each missing one (B7).
//
// The rules are deliberately the same rules as scripts/check-skills.mjs -- a
// skill this repository ships and a skill a person installs should be held to
// one standard -- ported to pure text functions so node:test can run them and
// the install flow can call them without a Tauri window.
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4USkillLint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_DESC = 1024;
  var MAX_BODY_LINES = 500;
  var MIN_DESC = 40;
  // The install button's number: (name + description) / 4 + 12 tokens per
  // skill ride in every prompt. The budget is where the UI says "enough".
  var TOKEN_BUDGET = 1500;

  // Words that decide nothing on their own; a trigger made only of these is
  // no trigger. Same list as scripts/check-skills.mjs.
  var GENERIC = new Set(['linux', 'pc', 'machine', 'server', 'system', 'help', 'fix', 'check', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'this', 'when', 'use', 'run', 'my', 'me', 'i', 'is', 'are', 'it', 'what', 'whats', 'how', 'why', 'can', 'do', 'does', 'show', 'going', 'everything', 'something', 'wrong', 'ok', 'up', 'down', 'keeps', 'should', 'need', 'needed', 'am', 'was', 'before', 'after', 'now', 'all', 'some', 'any', 'get', 'set', 'add', 'make', 'new', 'no', 'not']);

  // Frontmatter keys a SKILL.md may carry. Anything else is a finding: an
  // unknown key is either a typo (which the skill then ignores) or something
  // the router does not understand, and neither should install silently.
  var KNOWN_KEYS = new Set(['name', 'description', 'tags', 'files', 'compatibility', 'license', 'version', 'requires', 'allowed-tools', 'metadata', 'agents']);

  // The apt package for the tools skills commonly name. A tool without a row
  // gets its own name as the package, which is right more often than not.
  var APT = {
    rg: 'ripgrep', fd: 'fd-find', bat: 'bat', exa: 'eza', jq: 'jq', yq: 'yq',
    node: 'nodejs npm', npm: 'npm', npx: 'npm', python: 'python3', python3: 'python3', pip: 'python3-pip',
    convert: 'imagemagick', magick: 'imagemagick', ffmpeg: 'ffmpeg', xdotool: 'xdotool',
    sqlite3: 'sqlite3', git: 'git', curl: 'curl', wget: 'wget', docker: 'docker.io', podman: 'podman',
    cargo: 'cargo', rustc: 'rustc', make: 'build-essential', gcc: 'build-essential', cmake: 'cmake',
    wlcopy: 'wl-clipboard', xclip: 'xclip', gh: 'gh', unzip: 'unzip', tar: 'tar',
  };

  /** Frontmatter and body of a SKILL.md, or null when there is no frontmatter. */
  function parseSkill(text) {
    var m = String(text == null ? '' : text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) return null;
    var front = {};
    var key = null;
    var lines = m[1].split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
      if (kv && line.charAt(0) !== ' ') {
        key = kv[1];
        front[key] = kv[2];
      } else if (key && /^\s+\S/.test(line)) {
        front[key] += ' ' + line.trim();
      }
    }
    return { front: front, body: m[2] };
  }

  /** Words in quotes in a description are its triggers ("disk full", "systemctl"). */
  function triggers(description) {
    var out = new Set();
    var re = /["\u201c]([^"\u201d]{2,40})["\u201d]/g;
    var m;
    var text = String(description == null ? '' : description);
    while ((m = re.exec(text))) {
      var words = m[1].toLowerCase().replace(/['\u2019]/g, '').split(/[^a-z0-9+]+/);
      for (var i = 0; i < words.length; i += 1) if (words[i] && !GENERIC.has(words[i])) out.add(words[i]);
    }
    return out;
  }

  /**
   * lintSkill(input)
   *
   * input.text      the raw SKILL.md (preferred: everything can be checked)
   * input.name, input.folderName, input.description, input.body
   *                 the pieces, when a catalogue entry has already parsed it
   * input.files     the files the skill says it ships (for link resolution)
   * input.others    descriptions of installed skills (for the duplicate rule)
   *
   * Returns { errors, warnings }: errors block the install, warnings are shown
   * beside it and never block. The wording is the wording scripts/check-skills
   * uses, so one document explains both.
   */
  function lintSkill(input) {
    var req = input || {};
    var errors = [];
    var warnings = [];
    var front = null;
    var body = req.body != null ? String(req.body) : '';
    var name = req.name || '';
    var description = req.description || '';

    if (req.text != null) {
      var parsed = parseSkill(req.text);
      if (!parsed) {
        errors.push('no readable frontmatter block (the --- ... --- block at the top)');
        return { errors: errors, warnings: warnings };
      }
      front = parsed.front;
      body = parsed.body.trim();
      name = front.name || name;
      description = front.description || description;
      for (var key in front) {
        if (Object.prototype.hasOwnProperty.call(front, key) && !KNOWN_KEYS.has(key)) {
          errors.push('unknown frontmatter key "' + key + '"');
        }
      }
      if (front.description && /^description:.*\n\s+\S/.test(req.text.split('\n---')[0])) {
        errors.push('description spans more than one line');
      }
    }

    if (!name) errors.push('frontmatter has no name');
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) errors.push('name "' + name + '" is not kebab-case');
    if (req.folderName && name && name !== req.folderName) {
      errors.push('name "' + name + '" is not the folder name "' + req.folderName + '"');
    }

    if (!description) errors.push('frontmatter has no description');
    else {
      if (description.length > MAX_DESC) errors.push('description is ' + description.length + ' characters (max ' + MAX_DESC + ')');
      if (/[\r\n]/.test(description)) errors.push('description spans more than one line');
    }

    if (!body) errors.push('the body is empty');
    else {
      var lines = body.split(/\r?\n/).length;
      if (lines > MAX_BODY_LINES) errors.push('body is ' + lines + ' lines (max ' + MAX_BODY_LINES + ')');
    }

    // A relative link that resolves to nothing is a dead end for whoever reads
    // the skill after install. With no file list to check against, skip.
    var files = new Set(Array.isArray(req.files) ? req.files.map(String) : []);
    if (files.size) {
      var linkRe = /\]\((?!https?:|mailto:|#)([^)\s]+)\)/g;
      var lm;
      while ((lm = linkRe.exec(body))) {
        var target = lm[1].split('#')[0].replace(/^\.\//, '');
        if (!files.has(target) && !files.has(lm[1])) {
          errors.push('link to ' + lm[1] + ' does not resolve to a file in this skill');
        }
      }
    }

    if (description && Array.isArray(req.others)) {
      for (var i = 0; i < req.others.length; i += 1) {
        if (req.others[i] && String(req.others[i]).trim() === description.trim()) {
          errors.push('this description is word for word another skill\'s: the router cannot tell them apart');
          break;
        }
      }
    }

    if (description && description.trim().length < MIN_DESC) {
      warnings.push('the description is short: the router has little to go on (' + description.trim().length + ' characters)');
    }
    if (description && triggers(description).size === 0) {
      warnings.push('no quoted trigger in the description: add one like "disk full" so the router can match it');
    }
    return { errors: errors, warnings: warnings };
  }

  /**
   * lintRouting(skills)
   *
   * B4: two skills sharing two or more triggers compete on every prompt.
   * `skills` is [{ name, description }]; the answer is pairs with the words
   * they fight over, plus pairs whose triggers are so generic nothing routes
   * to them on purpose.
   */
  function lintRouting(skills) {
    var list = skills || [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      for (var j = i + 1; j < list.length; j += 1) {
        var a = triggers(list[i].description || '');
        var b = triggers(list[j].description || '');
        var shared = [];
        a.forEach(function (w) { if (b.has(w)) shared.push(w); });
        if (shared.length >= 2) {
          out.push({ a: list[i].name, b: list[j].name, shared: shared.sort(), generic: [] });
        }
      }
    }
    return out;
  }

  /**
   * pairKey(a, b) — B4: one identity for a collision, whatever order it was
   * found in, so the written reason for keeping both is found again.
   */
  function pairKey(a, b) {
    var x = String(a == null ? '' : a);
    var y = String(b == null ? '' : b);
    return x < y ? x + '||' + y : y + '||' + x;
  }

  /** B2: what one skill costs in every prompt, in tokens. */
  function contextCost(skill) {
    var s = skill || {};
    var chars = String(s.name || '').length + String(s.description || '').length;
    return { tokens: Math.ceil(chars / 4) + 12, chars: chars };
  }

  /** B2: the running total for the installed set. */
  function catalogCost(skills, budget) {
    var list = skills || [];
    var tokens = 0;
    for (var i = 0; i < list.length; i += 1) tokens += contextCost(list[i]).tokens;
    var limit = typeof budget === 'number' ? budget : TOKEN_BUDGET;
    return { tokens: tokens, count: list.length, budget: limit, over: tokens > limit };
  }

  /** The tools a skill asks for: a Prerequisites section, or requires:/compatibility: in frontmatter. */
  function prereqTools(text) {
    var out = [];
    var seen = {};
    var add = function (tool) {
      var t = String(tool || '').trim().toLowerCase().replace(/[`"'.,;:()]/g, '');
      if (!t || seen[t]) return;
      seen[t] = true;
      out.push(t);
    };
    var parsed = parseSkill(text) || { front: {}, body: String(text == null ? '' : text) };
    for (var key of ['requires', 'compatibility']) {
      var val = parsed.front[key];
      if (val) {
        var parts = String(val).split(/[,;|]/);
        for (var i = 0; i < parts.length; i += 1) {
          var m = /`([^`]+)`/.exec(parts[i]) || /([a-zA-Z][a-zA-Z0-9._+-]*)/.exec(parts[i]);
          if (m) add(m[1]);
        }
      }
    }
    // A Prerequisites / Requirements section: every backticked or bullet word
    // that looks like a command name.
    var section = /#{2,3}\s*(prerequisites|requirements|needs|depends on)[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n*$)/i.exec(parsed.body);
    if (section) {
      var body = section[2];
      var before = out.length;
      var ticks = /`([a-zA-Z][a-zA-Z0-9._+-]*)`/g;
      var t;
      while ((t = ticks.exec(body))) add(t[1]);
      // Bullets without backticks only when the backticks found nothing.
      if (out.length === before) {
        var bullets = /^\s*[-*]\s+([a-zA-Z][a-zA-Z0-9._+-]*)/gm;
        var b;
        while ((b = bullets.exec(body))) add(b[1]);
      }
    }
    return out;
  }

  /** The apt line that installs a tool on Mint, or '' when there is no honest one. */
  function toolFix(tool) {
    var t = String(tool || '').toLowerCase();
    var pkg = APT[t];
    if (pkg) return 'sudo apt install ' + pkg;
    if (/^[a-z][a-z0-9._+-]*$/.test(t)) return 'sudo apt install ' + t;
    return '';
  }

  /**
   * prereqReport(text, onPath)
   *
   * B7: each tool a skill needs, found or not, with the line that installs the
   * missing one. `onPath` is a Set of tool names that are on PATH (the caller
   * checks with `command -v`, which is one shell call for all of them).
   */
  function prereqReport(text, onPath) {
    var have = onPath instanceof Set ? onPath : new Set(Array.isArray(onPath) ? onPath : []);
    return prereqTools(text).map(function (tool) {
      return { tool: tool, found: have.has(tool), fix: have.has(tool) ? '' : toolFix(tool) };
    });
  }

  // --- B5: the description's own negative triggers ---------------------------
  //
  // "Do not use when…" is written by whoever made the skill. The card shows
  // it so a person deciding to install sees the boundary without reading a
  // wall of text. Honouring it in ROUTING is the engine's call and goes
  // upstream as a proposal (APP_UPGRADE_PLAN B5) -- this is display, and
  // only display, on purpose.

  var NEGATIVE = /\b(?:do not|don't|dont|never|avoid)\s+(?:use\s*)?(?:when|for|if|with|on)\b|\bnot\s+(?:to\s+be\s+)?used\s+(?:when|for|with)\b|\bnot\s+for\b/i;

  /** The description's "do not use when…" sentence, trimmed to one line, or ''. */
  function negative(description) {
    var text = String(description == null ? '' : description).trim();
    if (!text || !NEGATIVE.test(text)) return '';
    var re = /[^.;]+(?:[.;]|$)/g;
    var m;
    while ((m = re.exec(text))) {
      var sentence = m[0].trim();
      if (sentence && NEGATIVE.test(sentence)) return sentence.slice(0, 240);
    }
    return '';
  }

  // --- B6: which skill would answer this? -------------------------------------
  //
  // A preview of the router's likely pick, scored the way routing itself
  // works: the skill's own quoted triggers, its name, and its significant
  // description words, counted where the draft actually contains them.
  // Display only -- the engine's router is the authority; this is the
  // person's glimpse before pressing Send.

  function wordsOf(text) {
    var raw = String(text == null ? '' : text).toLowerCase().split(/[^a-z0-9+#.]+/);
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var w = raw[i].replace(/^[.]+|[.]+$/g, '');
      if (w && w.length > 1 && !GENERIC.has(w)) out.push(w);
    }
    return out;
  }

  /**
   * rankCandidates(draft, skills, limit) -> [{ name, description, score, matched }]
   *
   * Top `limit` (default 3) skills the draft points at, best first; nothing
   * when the draft is too short to mean anything or no skill matches. Quoted
   * triggers weigh 3, the name 2, description words 1 -- a draft that says
   * "disk full" should rank the skill that quotes "disk full" above one that
   * merely mentions disks.
   */
  function rankCandidates(draft, skills, limit) {
    var text = String(draft == null ? '' : draft).trim().toLowerCase();
    if (text.length < 12) return [];
    var draftWords = new Set(text.split(/[^a-z0-9+#.]+/).filter(Boolean));
    var out = [];
    var rows = Array.isArray(skills) ? skills : [];
    for (var i = 0; i < rows.length; i += 1) {
      var s = rows[i];
      if (!s || !s.name || !s.description) continue;
      var score = 0;
      var matched = [];
      var seen = new Set();
      var add = function (word, weight) {
        if (!word || seen.has(word)) return;
        seen.add(word);
        if (draftWords.has(word)) { score += weight; matched.push(word); }
      };
      triggers(s.description).forEach(function (word) { add(word, 3); });
      wordsOf(s.name).forEach(function (word) { add(word, 2); });
      wordsOf(s.description).forEach(function (word) { if (word.length >= 4) add(word, 1); });
      if (score > 0) out.push({ name: String(s.name), description: String(s.description), score: score, matched: matched });
    }
    out.sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    var cap = Number(limit);
    if (!isFinite(cap) || cap <= 0) cap = 3;
    return out.slice(0, Math.floor(cap));
  }

  return {
    MAX_DESC: MAX_DESC,
    MAX_BODY_LINES: MAX_BODY_LINES,
    TOKEN_BUDGET: TOKEN_BUDGET,
    parseSkill: parseSkill,
    triggers: triggers,
    negative: negative,
    rankCandidates: rankCandidates,
    lintSkill: lintSkill,
    lintRouting: lintRouting,
    pairKey: pairKey,
    contextCost: contextCost,
    catalogCost: catalogCost,
    prereqTools: prereqTools,
    prereqReport: prereqReport,
    toolFix: toolFix,
  };
});
