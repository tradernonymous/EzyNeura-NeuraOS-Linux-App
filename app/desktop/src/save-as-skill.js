// Save a finished chat as a skill (upgrade plan B12): the words that solved
// a problem become a SKILL.md in `.neuraos/skills`, so the next chat in any
// folder can reach for them. The engine already routes SKILL.md; this module
// only builds the file — and it sends the result through the same B3 lint
// that gates an install, because a chat that is saved badly is worse than
// one that was not saved: it would ride in every prompt from then on.
//
// Pure: the chat arrives as data, the answer is text. The screen writes the
// file, and the lint's errors come back as `{ error }` for it to show.
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4USaveAsSkill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Caps, chosen below the lint's own (1024-char description, 500-line
  // body) so the lint never has to be the one to say no about size: a saved
  // skill is a worked example, not an archive of the chat.
  var MAX_DESC = 512;
  var MAX_MESSAGES = 12;
  var MAX_MESSAGE_CHARS = 3000;
  var MAX_BODY_LINES = 400;

  /** The folder this skill installs into: strictly kebab-case, one segment. */
  function slugFrom(title, fallback) {
    var source = String(title == null ? '' : title) || String(fallback == null ? '' : fallback);
    return String(source)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '');
  }

  function collapse(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  /** The parts of a chat that can become skill text: real turns only. */
  function turnsOf(chat) {
    var messages = (chat && Array.isArray(chat.messages)) ? chat.messages : [];
    var out = [];
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i] || {};
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      if (m.note || m.shell) continue;
      var text = String(m.content == null ? '' : m.content).trim();
      if (!text) continue;
      out.push({ role: m.role, text: text });
    }
    return out;
  }

  /**
   * build(chat, opts) -> { slug, name, description, body, warnings } or
   * { error }. The lint runs here, before the screen has a file to write:
   * same rules as an install (B3), same `others` for the duplicate rule.
   */
  function build(chat, opts) {
    var options = opts || {};
    var turns = turnsOf(chat);
    var firstAsk = '';
    for (var i = 0; i < turns.length; i += 1) {
      if (turns[i].role === 'user') { firstAsk = turns[i].text; break; }
    }
    if (!firstAsk) return { error: 'Nothing to save: this chat has no question in it.' };

    var title = collapse((chat && chat.title) || firstAsk).slice(0, 80) || 'saved chat';
    var slug = slugFrom(title, '');
    if (!slug) return { error: 'This chat’s title does not make a usable skill name — give it a title first.' };

    var description = collapse(firstAsk).slice(0, MAX_DESC);
    if (!description) return { error: 'Nothing to save: the first question is empty.' };

    // The exchange, newest problem first ask, in speaking order, capped so
    // the body stays a worked example the router can afford to carry.
    var kept = turns.slice(-MAX_MESSAGES);
    var lines = [
      '# ' + title,
      '',
      'A worked example saved from a conversation: the ask, and what was done about it.',
      'Use it when a question arrives like the ask below.',
      '',
      '## The ask',
      '',
      firstAsk.slice(0, MAX_MESSAGE_CHARS),
      '',
      '## The exchange',
      '',
    ];
    for (var j = 0; j < kept.length; j += 1) {
      var turn = kept[j];
      lines.push('### ' + (turn.role === 'user' ? 'Ask' : 'Answer'));
      lines.push('');
      lines.push(turn.text.slice(0, MAX_MESSAGE_CHARS));
      lines.push('');
    }
    var body = lines.join('\n');
    var bodyLines = body.split('\n');
    if (bodyLines.length > MAX_BODY_LINES) {
      body = bodyLines.slice(0, MAX_BODY_LINES).join('\n') + '\n\n… (the rest of the chat was cut here)';
    }

    // B3: the same lint that gates an install gates a save.
    var lintLib = null;
    try {
      if (typeof module === 'object' && module.exports) lintLib = require('./skill-lint.js');
      else lintLib = (typeof globalThis !== 'undefined' && globalThis.FreeAI4USkillLint) || null;
    } catch {
      lintLib = null;
    }
    var warnings = [];
    if (lintLib) {
      var findings = lintLib.lintSkill({
        name: slug,
        folderName: slug,
        description: description,
        body: body,
        files: ['SKILL.md'],
        others: options.others,
      });
      if (findings.errors.length) {
        return { error: 'Not saved: ' + findings.errors[0] + '.' };
      }
      warnings = findings.warnings;
    }

    return { slug: slug, name: slug, description: description, body: body, warnings: warnings };
  }

  /** The file's text: frontmatter the engine parses, then the body. */
  function render(skill) {
    var s = skill || {};
    return '---\n' +
      'name: ' + String(s.name || s.slug || '') + '\n' +
      'description: ' + String(s.description || '') + '\n' +
      '---\n\n' +
      String(s.body || '') + '\n';
  }

  return {
    slugFrom: slugFrom,
    turnsOf: turnsOf,
    build: build,
    render: render,
    MAX_DESC: MAX_DESC,
    MAX_BODY_LINES: MAX_BODY_LINES,
  };
});
