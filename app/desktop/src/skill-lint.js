// Judging a skill before it is installed (B2, B3, B5 of
// docs/APP_UPGRADE_PLAN.md).
//
// A SKILL.md from a catalogue is a stranger's instructions that this machine
// will read on every later prompt. Two things are worth knowing about it
// before it lands, and neither is visible from the install button:
//
//   - what it costs. A skill's name and description ride in *every* prompt
//     from the moment it is installed, forever, whether or not that prompt
//     needs the skill. Four skills that look free in the store are a standing
//     tax on every conversation.
//   - whether it is any good. A skill with no description, a name that is not
//     its folder, or a body over 500 lines is broken in a way the router will
//     not tell you about; it just silently never fires, or fires wrong.
//
// The rules are the ones this repository already enforces on its own skills in
// scripts/check-skills.mjs, deliberately the same list and the same limits, so
// "what passes here" and "what passes our lint" cannot drift apart. That script
// reads a directory from disk; this one reads text the app already has in hand,
// and shares nothing with it but the limits, which are restated below as
// constants rather than imported (a bundled browser module cannot require a
// Node script, and duplicating three numbers is cheaper than a loader).
//
// Everything here is pure. It is what node:test exercises directly, and it is
// what the screen calls before it offers an install button -- so a rule is
// enforced by a test rather than by hoping the UI still calls this.
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4USkillLint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // The three limits, from the Claude Code skills reference and restated in
  // scripts/check-skills.mjs. A description is what rides in every prompt, so
  // 1024 characters is the ceiling that matters; a body is read only when the
  // skill fires, so 500 lines is a smell rather than a cost.
  var MAX_DESCRIPTION = 1024;
  var MAX_BODY_LINES = 500;

  // A description shorter than this says almost nothing, and the router picks
  // skills by description -- so a terse one is a skill that will not be found.
  var SHORT_DESCRIPTION = 40;

  // Frontmatter keys a skill may carry. An unknown one is an error rather than
  // a warning because it is almost always a typo of a key we do read
  // ("descriptions:"), and a typo here is a skill the router cannot match.
  var KNOWN_KEYS = [
    'name', 'description', 'tags', 'files', 'compatibility',
    'license', 'allowed-tools', 'version', 'author',
  ];

  // Words that decide nothing on their own. A trigger made only of these is no
  // trigger at all, which is what makes "code" and "api" actively harmful as
  // triggers: they fire on every prompt and so teach the router nothing.
  var GENERIC = [
    'linux', 'pc', 'machine', 'server', 'system', 'help', 'fix', 'check',
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
    'this', 'when', 'use', 'run', 'my', 'me', 'i', 'is', 'are', 'it', 'what',
    'how', 'why', 'can', 'do', 'does', 'show', 'going', 'everything',
    'something', 'wrong', 'ok', 'up', 'down', 'should', 'need', 'needed',
    'am', 'was', 'before', 'after', 'now', 'all', 'some', 'any', 'get',
    'set', 'add', 'make', 'new', 'no', 'not',
  ];

  // --- B2: what a skill costs -----------------------------------------------

  /**
   * contextCostTokens(skill)
   *
   * The tokens a skill adds to *every* prompt once installed: the engine keeps
   * each skill's name and description in the routing preamble, so this is a
   * standing cost rather than a one-off. The body is not counted -- it is read
   * only when the skill is chosen.
   *
   * Four characters per token is the usual rule of thumb for English prose, and
   * the +12 is the per-entry overhead the preamble pays (the delimiters, the
   * filename, the role marker). Both are estimates; the point is that the
   * number is comparable between skills and moves when a description grows,
   * not that it matches a tokenizer exactly.
   */
  function contextCostTokens(skill) {
    var entry = skill || {};
    var name = String(entry.name == null ? '' : entry.name);
    var description = String(entry.description == null ? '' : entry.description);
    return Math.ceil((name.length + description.length) / 4) + 12;
  }

  /**
   * contextCostLabel(tokens)
   *
   * Short enough to sit on the install button. Below 100 tokens the exact
   * number is noise; the reader only needs to know it is small.
   */
  function contextCostLabel(tokens) {
    var n = Number(tokens) || 0;
    if (n < 100) return '~' + n + ' tokens';
    return '~' + Math.round(n) + ' tokens';
  }

  /**
   * contextBudgetStatus(total, budget)
   *
   * Where a running total sits against a budget, as one of 'ok' | 'warn' |
   * 'over'. The default budget is deliberately small: at roughly 20 skills the
   * preamble is a visible fraction of a prompt, and a user past that point
   * wants told about it rather than left to notice.
   */
  function contextBudgetStatus(total, budget) {
    var limit = Number(budget) || 20;
    var n = Number(total) || 0;
    if (n >= limit) return 'over';
    if (n >= Math.ceil(limit * 0.75)) return 'warn';
    return 'ok';
  }

  // --- parsing ---------------------------------------------------------------

  /**
   * parseFrontmatter(text)
   *
   * The frontmatter block as { keys, name, description, body, raw }, or null
   * when there is no block. Deliberately stricter than a YAML parser: this
   * needs to know the *shape* of what was written, including a description that
   * spills onto a second line, because that is one of the rules.
   *
   * `keys` is the list of keys as written, in order, so an unknown or
   * misspelled one is visible to the caller.
   */
  function parseFrontmatter(text) {
    if (!text || typeof text !== 'string') return null;
    var match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return null;
    var block = match[1];
    var body = match[2] == null ? '' : match[2];

    var keys = [];
    var meta = {};
    var descriptionMultiline = false;
    var currentKey = null;

    var lines = block.split(/\r?\n/);
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      // A YAML list item belongs to the key above it.
      var item = line.match(/^\s+-\s+(.*)$/);
      if (item && currentKey) {
        if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
        meta[currentKey].push(unquote(item[1].trim()));
        continue;
      }
      var kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (kv) {
        currentKey = kv[1];
        keys.push(currentKey);
        var value = kv[2].trim();
        if (!value) {
          // A bare key: either an empty value or a list that follows.
          meta[currentKey] = '';
          continue;
        }
        meta[currentKey] = unquote(value);
        continue;
      }
      // A continuation line: a folded scalar, which for `description` is the
      // multi-line case the rules forbid.
      if (currentKey && /^\s+\S/.test(line)) {
        descriptionMultiline = true;
        meta[currentKey] = (meta[currentKey] ? meta[currentKey] + ' ' : '') + line.trim();
      }
    }
    return {
      keys: keys,
      name: meta.name || '',
      description: meta.description || '',
      body: body,
      raw: block,
      descriptionMultiline: descriptionMultiline,
    };
  }

  function unquote(value) {
    var v = String(value == null ? '' : value);
    if (v.length >= 2) {
      var first = v.charAt(0);
      var last = v.charAt(v.length - 1);
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return v.slice(1, -1);
      }
    }
    return v;
  }

  // --- B3: the rules ---------------------------------------------------------

  /**
   * lintSkill(text, opts)
   *
   * Everything wrong with a SKILL.md, split by whether it should stop the
   * install.
   *
   * Errors block. A skill that trips one of them does not work: no frontmatter
   * means the router never sees it, a name that is not its folder means it
   * installs somewhere the engine will not look, a body over 500 lines is a
   * document rather than a skill, and a dead relative link is a promise the
   * catalogue did not keep.
   *
   * Warnings do not block. A terse description or a missing trigger still
   * installs -- the user may know exactly what they want -- but the card says
   * so, because the failure mode is silent: the skill is installed, and it
   * simply never fires.
   *
   * opts.folder      the folder the skill will install into, to check the name
   *                  against. Omit to skip that one rule.
   * opts.installed   [{ name, description }] already on this machine, to catch
   *                  a duplicate description (B3's last rule).
   * opts.hasFile     (repoPath) => boolean, for the dead-link rule. Omit to
   *                  skip it, which is what the catalogue preview does: it has
   *                  not fetched the sibling files yet, and reporting a link as
   *                  dead because nothing was fetched would be a lie.
   */
  function lintSkill(text, opts) {
    var options = opts || {};
    var errors = [];
    var warnings = [];

    var parsed = parseFrontmatter(text);
    if (!parsed) {
      errors.push('No frontmatter block: a skill must open with --- and a name and description.');
      return { errors: errors, warnings: warnings, parsed: null };
    }

    if (!parsed.name) {
      errors.push('The frontmatter has no name.');
    } else {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(parsed.name)) {
        errors.push('The name "' + parsed.name + '" is not kebab-case (lower-case words joined by hyphens).');
      }
      if (options.folder && parsed.name !== options.folder) {
        errors.push('The name "' + parsed.name + '" is not the folder it installs into, "' + options.folder + '".');
      }
    }

    if (!parsed.description) {
      errors.push('The frontmatter has no description: the router reads only the name and the description to decide whether this skill applies.');
    } else {
      if (parsed.description.length > MAX_DESCRIPTION) {
        errors.push('The description is ' + parsed.description.length + ' characters (max ' + MAX_DESCRIPTION + '). It rides in every prompt.');
      }
      if (parsed.descriptionMultiline) {
        errors.push('The description spans more than one line.');
      }
      if (parsed.description.length < SHORT_DESCRIPTION) {
        warnings.push('The description is only ' + parsed.description.length + ' characters. The router picks a skill by its description, so a terse one may never be chosen.');
      }
      var quoted = triggers(parsed.description);
      if (!quoted.length) {
        warnings.push('The description quotes no trigger. Naming the phrases that should reach for this skill ("disk full") is how the router finds it.');
      }
    }

    var body = parsed.body || '';
    if (!body.trim()) {
      errors.push('The body is empty.');
    } else {
      var bodyLines = body.split(/\r?\n/).length;
      if (bodyLines > MAX_BODY_LINES) {
        errors.push('The body is ' + bodyLines + ' lines (max ' + MAX_BODY_LINES + '). That is a document, not a skill.');
      }
    }

    for (var i = 0; i < parsed.keys.length; i++) {
      if (KNOWN_KEYS.indexOf(parsed.keys[i]) < 0) {
        errors.push('The frontmatter has an unknown key "' + parsed.keys[i] + '".');
      }
    }

    // A duplicate description means two skills read identically to the router,
    // and it will pick between them arbitrarily.
    if (parsed.description) {
      var installed = Array.isArray(options.installed) ? options.installed : [];
      for (var j = 0; j < installed.length; j++) {
        var other = installed[j] || {};
        if (other.description && other.description === parsed.description) {
          errors.push('Another installed skill has the same description ("' + other.name + '"). The router cannot tell them apart.');
        }
      }
    }

    if (typeof options.hasFile === 'function') {
      var links = body.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g);
      for (var link of links) {
        var target = link[1].split('#')[0];
        if (!target) continue;
        if (!options.hasFile(target)) {
          errors.push('A link in the body points at ' + target + ', which this skill does not ship.');
        }
      }
    }

    return { errors: errors, warnings: warnings, parsed: parsed };
  }

  /**
   * lintSkills(list, opts)
   *
   * The whole catalogue at once: per-skill rules, plus the two that only exist
   * between skills -- a duplicate description, and B4's trigger collision.
   *
   * B4 is not in this phase's scope to *fix* (disabling one of a colliding pair
   * is a decision, and a screen's), but flagging the pair here means the
   * decision has something to be made from. A collision is a warning rather
   * than an error: both skills are still usable, the router just picks the
   * wrong one more often.
   */
  function lintSkills(list, opts) {
    var options = opts || {};
    var entries = Array.isArray(list) ? list : [];
    // Keyed by position, not by name: a catalogue holding two entries of the
    // same name is already broken, and it should say so as two findings rather
    // than silently merging into one row.
    var records = [];

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i] || {};
      var text = entry.text != null ? entry.text : entry.content;
      var result = lintSkill(text, {
        folder: options.folderFor ? options.folderFor(entry) : undefined,
        installed: options.installed,
        hasFile: options.hasFileFor ? options.hasFileFor(entry) : undefined,
      });
      records.push({
        name: (result.parsed && result.parsed.name) || entry.name || '',
        parsed: result.parsed,
        errors: result.errors,
        warnings: result.warnings,
      });
    }

    // Duplicate descriptions across the catalogue. A duplicate is recorded
    // once, on the later of the two, and names the earlier -- so a pair reads
    // the same whichever end of the list you look at.
    var seenDescription = {};
    for (var j = 0; j < records.length; j++) {
      var description = records[j].parsed && records[j].parsed.description;
      if (!description) continue;
      if (seenDescription[description]) {
        records[j].errors.push('The same description as "' + seenDescription[description] + '" in this catalogue: the router cannot tell them apart.');
      } else {
        seenDescription[description] = records[j].name;
      }
    }

    // B4: two skills sharing two or more triggers compete on every prompt.
    for (var a = 0; a < records.length; a++) {
      for (var b = a + 1; b < records.length; b++) {
        var first = records[a].parsed;
        var second = records[b].parsed;
        if (!first || !second) continue;
        var shared = sharedTriggers(first.description, second.description);
        if (shared.length < 2) continue;
        records[a].warnings.push(
          'Shares the triggers "' + shared.join('", "') + '" with "' + records[b].name + '": the router cannot tell them apart.'
        );
        records[b].warnings.push(
          'Shares the triggers "' + shared.join('", "') + '" with "' + records[a].name + '": the router cannot tell them apart.'
        );
      }
    }

    // The three rules that need more than one skill pushed onto the very arrays
    // handed out above, so these records are the result.
    return records.map(function (record) {
      return { name: record.name, errors: record.errors, warnings: record.warnings };
    });
  }

  /**
   * triggers(description)
   *
   * The words in quotes in a description are its triggers -- the phrases the
   * author says should reach for this skill. Generic words are dropped, since
   * a trigger made only of them is not a trigger.
   */
  function triggers(description) {
    var out = [];
    var text = String(description == null ? '' : description);
    var matches = text.matchAll(/["“]([^"”]{2,40})["”]/g);
    for (var m of matches) {
      var words = m[1].toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9+]+/);
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (w && GENERIC.indexOf(w) < 0 && out.indexOf(w) < 0) out.push(w);
      }
    }
    return out;
  }

  /** The triggers two descriptions share, which is what makes them compete. */
  function sharedTriggers(a, b) {
    var first = triggers(a);
    var second = triggers(b);
    var shared = [];
    for (var i = 0; i < first.length; i++) {
      if (second.indexOf(first[i]) >= 0 && shared.indexOf(first[i]) < 0) shared.push(first[i]);
    }
    return shared;
  }

  // --- B5: "do not use when" -------------------------------------------------
  //
  // The engine does not honour a negative trigger yet -- that belongs upstream
  // (docs/APP_UPGRADE_PLAN.md B5). Surfacing it is still worth doing: the
  // person deciding whether to install is exactly the person who can say "not
  // for this machine", and a skill's own warning about when it does not apply
  // is the most useful line on the card.

  /**
   * negativeTriggers(description)
   *
   * The "Do not use when ..." clause of a description, or '' when it has none.
   * Recognised in the forms the ecosystem actually writes: "Do not use when",
   * "Don't use when", "Not for", "Not when".
   */
  function negativeTriggers(description) {
    var text = String(description == null ? '' : description);
    var m = text.match(/(?:do not use when|don'?t use when|not for|not when)\b[:\s]*(.+)$/i);
    return m ? m[1].trim() : '';
  }

  return {
    MAX_DESCRIPTION: MAX_DESCRIPTION,
    MAX_BODY_LINES: MAX_BODY_LINES,
    SHORT_DESCRIPTION: SHORT_DESCRIPTION,
    KNOWN_KEYS: KNOWN_KEYS,
    contextCostTokens: contextCostTokens,
    contextCostLabel: contextCostLabel,
    contextBudgetStatus: contextBudgetStatus,
    parseFrontmatter: parseFrontmatter,
    lintSkill: lintSkill,
    lintSkills: lintSkills,
    triggers: triggers,
    sharedTriggers: sharedTriggers,
    negativeTriggers: negativeTriggers,
  };
});
