// Task decks (UI plan, phase 3): the common coding tasks, by category, that
// the Code screen offers under its box and from `/`. A task is a template
// with {{blanks}} to fill in; the person's own live in the project as
// .neuraos/commands/<name>.md (the Zed / Warp pattern), and "Save as task"
// writes one. Pure: the file reading and writing are passed in.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeAI4UTasks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DIR = '.neuraos/commands';
  var BLANK = /\{\{([^{}]+)\}\}/g;

  var DECKS = [
    { id: 'build', label: 'Build', icon: 'build', hint: 'Make something new', tasks: [
      { id: 'feature', label: 'Add a feature', template: 'Add {{the feature}} to {{the part of the app}}. Follow the conventions already in the codebase, add tests, and update the docs that mention it.' },
      { id: 'endpoint', label: 'Add an API endpoint', template: 'Add a {{METHOD}} {{/path}} endpoint that {{does what}}. Validate the input, return clear errors, and add a test for the happy path and one failure.' },
      { id: 'component', label: 'Add a UI component', template: 'Create a {{component name}} component that {{does what}}, in the same style as the existing components. Wire it into {{the screen}} and add a test.' },
      { id: 'cli', label: 'Add a CLI command', template: 'Add a `{{command}}` command that {{does what}}, with --help text and an example in the README.' },
      { id: 'migration', label: 'Add a data migration', template: 'Write a migration that {{changes what}}, reversible, and update the model and the code that reads it.' },
      { id: 'scaffold', label: 'Scaffold a module', template: 'Scaffold a new module named {{name}} for {{purpose}}: files, exports, a first test and a short README section.' },
    ] },
    { id: 'fix', label: 'Fix', icon: 'alert', hint: 'Find and repair', tasks: [
      { id: 'bug', label: 'Fix a bug', template: 'Fix this bug: {{what happens}}. Expected: {{what should happen}}. Reproduce it first, write a failing test, then make it pass.' },
      { id: 'error', label: 'Fix an error message', template: 'This error appears: ```\n{{paste the error}}\n```\nFind the cause, fix it, and explain what was wrong in one paragraph.' },
      { id: 'failing', label: 'Fix failing tests', template: 'Run the test suite, find every failing test, and fix the code (not the tests) until they pass. Say what each failure was.' },
      { id: 'type', label: 'Fix type errors', template: 'Run the type checker and fix every error without adding `any` or suppressions. Explain any that needed a real change.' },
      { id: 'lint', label: 'Fix lint warnings', template: 'Run the linter and fix every warning in {{the folder or file}}. Do not change behaviour.' },
      { id: 'perf', label: 'Fix a slow path', template: '{{This operation}} is slow. Profile or reason about it, find the cost, and make it faster without changing its result. Show before and after.' },
    ] },
    { id: 'refactor', label: 'Refactor', icon: 'refresh', hint: 'Same behaviour, better shape', tasks: [
      { id: 'extract', label: 'Extract a function', template: 'Extract {{the repeated logic}} in {{file}} into one function with a clear name and use it everywhere it was duplicated. Behaviour must not change.' },
      { id: 'rename', label: 'Rename across the codebase', template: 'Rename {{old name}} to {{new name}} everywhere: code, tests, docs, config. Keep the change compiling at every step.' },
      { id: 'split', label: 'Split a big file', template: 'Split {{file}} into smaller modules by responsibility. Keep every export working; update the imports and tests.' },
      { id: 'simplify', label: 'Simplify', template: 'Simplify {{file or function}}: remove dead code, flatten nesting, name the intent. Same behaviour, fewer lines, and the tests still pass.' },
      { id: 'types', label: 'Tighten the types', template: 'Tighten the types in {{file}}: replace `any` and loose unions with precise types, and let the compiler find the mistakes.' },
      { id: 'deps', label: 'Remove a dependency', template: 'Remove the dependency on {{package}} and replace what it did with {{the standard library or a smaller thing}}. Keep the tests green.' },
    ] },
    { id: 'test', label: 'Test', icon: 'check', hint: 'Prove it works', tasks: [
      { id: 'run', label: 'Run the tests', template: "Run the project's tests and report what passed and what failed, with the failing output." },
      { id: 'cover', label: 'Add tests for a file', template: 'Add tests for {{file}} covering the main paths and the edge cases (empty input, errors, limits). Use the test framework already in the project.' },
      { id: 'repro', label: 'Write a failing test', template: 'Write a failing test that reproduces: {{the bug}}. Do not fix it yet; show me the failure.' },
      { id: 'e2e', label: 'Add an end-to-end test', template: 'Add an end-to-end test for {{the flow}}: from {{the start}} to {{the expected result}}.' },
      { id: 'flaky', label: 'Find a flaky test', template: 'Run {{the test}} several times, find why it is flaky, and make it deterministic.' },
    ] },
    { id: 'review', label: 'Review', icon: 'search', hint: 'Read before you trust', tasks: [
      { id: 'changes', label: 'Review my changes', template: 'Review the uncommitted changes in this folder for bugs, missed cases and risks. Be specific: file, line, what is wrong, how to fix it.' },
      { id: 'security', label: 'Security review', template: 'Review {{the folder or file}} for security problems: injection, secrets in code, unsafe file or network use, missing validation. Rank by severity.' },
      { id: 'explain', label: 'Explain this code', template: 'Explain what {{file or function}} does, how it fits the rest, and anything surprising. Short paragraphs, no fluff.' },
      { id: 'audit', label: 'Audit dependencies', template: 'List the dependencies, flag any that are unmaintained, duplicated or unused, and say what to do about each.' },
      { id: 'a11y', label: 'Accessibility review', template: 'Review {{the screen or component}} for keyboard use, labels, contrast and focus order. List what to fix.' },
    ] },
    { id: 'docs', label: 'Docs', icon: 'file', hint: 'Write it down', tasks: [
      { id: 'readme', label: 'Write or update the README', template: 'Update the README for {{what changed}}: what it is, how to install, how to run, how to test. Keep the tone of the existing text.' },
      { id: 'docstrings', label: 'Add doc comments', template: 'Add doc comments to the public functions in {{file}}: what it does, the arguments, what it returns, and one example where it helps.' },
      { id: 'changelog', label: 'Write a changelog entry', template: 'Write the changelog entry for {{this change or version}} from the commits and the diff, in the style of the existing entries.' },
      { id: 'adr', label: 'Write a decision record', template: 'Write a short decision record for {{the decision}}: context, options considered, the choice, and its consequences.' },
      { id: 'guide', label: 'Write a how-to', template: 'Write a how-to for {{the task}}: prerequisites, numbered steps, what success looks like, common mistakes.' },
    ] },
    { id: 'git', label: 'Git & Ops', icon: 'activity', hint: 'Commits, branches, builds', tasks: [
      { id: 'commit', label: 'Commit my changes', template: 'Look at the uncommitted changes, group them sensibly, and make commits with clear messages. Show me each message before committing.' },
      { id: 'branch', label: 'Start a branch', template: 'Create a branch named {{branch name}} from {{main}} and switch to it.' },
      { id: 'pr', label: 'Write a PR description', template: 'Write the pull request description for this branch from its commits and diff: what, why, how to test, anything risky.' },
      { id: 'ci', label: 'Fix the CI', template: 'The CI fails with: ```\n{{paste the failure}}\n```\nFind the cause in this repository and fix it.' },
      { id: 'release', label: 'Prepare a release', template: 'Prepare release {{version}}: bump the version where it lives, update the changelog, and list the commands to tag and publish.' },
      { id: 'script', label: 'Add a script', template: 'Add a script `{{name}}` that {{does what}}, wired into the package or Makefile, with a line in the README.' },
    ] },
  ];

  function decks() { return DECKS; }

  function deckAt(id) {
    for (var i = 0; i < DECKS.length; i++) if (DECKS[i].id === id) return DECKS[i];
    return null;
  }

  /** The {{blanks}} in a template, in order, once each. */
  function blanks(text) {
    var out = [];
    var seen = {};
    String(text || '').replace(BLANK, function (_m, name) {
      var n = name.trim();
      if (!seen[n]) { seen[n] = true; out.push(n); }
      return _m;
    });
    return out;
  }

  /** Where the first blank sits, so the box can select it: {start, end} or null. */
  function firstBlank(text) {
    var m = /\{\{[^{}]+\}\}/.exec(String(text || ''));
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  }

  /** A task's text with the given answers filled in; unanswered blanks stay. */
  function fill(template, answers) {
    var a = answers || {};
    return String(template || '').replace(BLANK, function (m, name) {
      var n = name.trim();
      return Object.prototype.hasOwnProperty.call(a, n) && String(a[n]).trim() ? String(a[n]) : m;
    });
  }

  /** A safe file name for a task: lower case, dashes, .md. */
  function fileNameOf(label) {
    var slug = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return (slug || 'task') + '.md';
  }

  /**
   * A custom task file: an optional `# Title` first line, an optional
   * `> hint` line, then the template. parseCustom(name, text) -> task.
   */
  function parseCustom(name, text) {
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    var label = String(name || '').replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
    var hint = '';
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && /^#\s+/.test(lines[0])) { label = lines.shift().replace(/^#\s+/, '').trim() || label; }
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && /^>\s?/.test(lines[0])) { hint = lines.shift().replace(/^>\s?/, '').trim(); }
    var template = lines.join('\n').trim();
    if (!template) return null;
    return { id: 'custom:' + String(name || '').replace(/\.md$/i, ''), label: label, hint: hint, template: template, custom: true };
  }

  /** The file "Save as task" writes: {path, text}. */
  function customFile(label, template, hint) {
    var text = '# ' + String(label || 'Task').trim() + '\n' + (hint ? '> ' + String(hint).trim() + '\n' : '') + '\n' + String(template || '').trim() + '\n';
    return { path: DIR + '/' + fileNameOf(label), text: text };
  }

  /** The `/` rows: every deck's tasks and the custom ones, filtered by a query. */
  function slashRows(query, custom, limit) {
    var q = String(query || '').replace(/^\//, '').toLowerCase().trim();
    var rows = [];
    (custom || []).forEach(function (t) { rows.push({ id: t.id, label: t.label, deck: 'Mine', hint: t.hint || '', template: t.template }); });
    DECKS.forEach(function (d) {
      d.tasks.forEach(function (t) { rows.push({ id: d.id + ':' + t.id, label: t.label, deck: d.label, hint: t.template.slice(0, 80), template: t.template }); });
    });
    var hit = rows.filter(function (r) {
      if (!q) return true;
      var hay = (r.label + ' ' + r.deck + ' ' + r.id).toLowerCase();
      return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
    });
    return hit.slice(0, Number(limit) > 0 ? Number(limit) : 12);
  }

  /** `/` alone, or `/word…`, at the start of the box means the task menu. */
  function isSlash(text) {
    return /^\/[a-z0-9 -]*$/i.test(String(text || ''));
  }

  return {
    DIR: DIR,
    DECKS: DECKS,
    decks: decks,
    deckAt: deckAt,
    blanks: blanks,
    firstBlank: firstBlank,
    fill: fill,
    fileNameOf: fileNameOf,
    parseCustom: parseCustom,
    customFile: customFile,
    slashRows: slashRows,
    isSlash: isSlash,
  };
});
