// The app's own built-in meta skills (upgrade plan B11). A toggle on the
// composer bar is only a switch unless something real stands behind it, so
// the words that switch sends live here as a SKILL.md-shaped skill: the same
// frontmatter the engine would parse if it were ever written to disk, the
// same description a person can read, and the one line the turn injects when
// the switch is on.
//
// Nothing in this module is fetched, stored or written: it ships with the
// app. The screen decides when the line rides a turn (beside Plan mode's,
// which is the precedent — same unshift, same system role).
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UBuiltInSkills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CONCISE_LINE =
    'Concise mode: answer in the fewest words that are still complete. Lead with the result, ' +
    'then only what is needed to act on it — no preamble, no recap of the question, no offers ' +
    'at the end. Code only where code is the answer; keep comments to what the code cannot say.';

  var CONCISE = {
    name: 'concise-mode',
    description:
      'The app’s built-in meta skill: while Concise mode is on, every answer is short — ' +
      'result first, no preamble, no recap, no closing offers.',
    body:
      '# Concise mode\n\n' +
      'When the composer’s Concise pill is on, every turn of this chat carries the line below ' +
      'as a system instruction:\n\n' +
      '> ' + CONCISE_LINE + '\n\n' +
      '## When it applies\n\n' +
      'Only to chats where the pill is on. The pill is per chat, so a research thread can stay ' +
      'long-winded while a fix-it thread stays terse.\n\n' +
      '## How to answer\n\n' +
      '- The answer first, in one or two sentences.\n' +
      '- Then only the steps, code or numbers the person needs to act.\n' +
      '- No preamble, no restating the question, no “great question”, no closing offers.\n' +
      '- If the answer is a code change, the code is the answer — do not also describe it.\n',
  };

  CONCISE.skillMd =
    '---\n' +
    'name: ' + CONCISE.name + '\n' +
    'description: ' + CONCISE.description + '\n' +
    '---\n\n' +
    CONCISE.body;

  return {
    CONCISE: CONCISE,
    /** The system line a concise turn carries. */
    conciseLine: function () { return CONCISE_LINE; },
  };
});
