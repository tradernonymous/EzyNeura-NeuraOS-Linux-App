// Judging a skill before installing it: what it costs (B2) and whether it works
// (B3), the rules that need more than one skill (B4), the negative trigger (B5),
// and what a skill needs on the machine (B7).
//
// The split that matters: an error stops the install, a warning does not. A rule
// in the wrong half of that is a real bug -- too strict and a working skill
// cannot be installed, too lax and a broken one installs and silently never
// fires -- so both directions are pinned here, not just the presence of a rule.
const test = require('node:test');
const assert = require('node:assert/strict');

const lint = require('../desktop/src/skill-lint.js');
const prereqs = require('../desktop/src/skill-prereqs.js');

const ok = (name, description) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n\n\`\`\`sh\necho hi\n\`\`\`\n`;

const has = (findings, text) => findings.some((f) => f.includes(text));

// ---- B2: the cost a skill adds to every prompt ------------------------------

test('a skill costs its name and description, not its body', () => {
  const small = lint.contextCostTokens({ name: 'a', description: 'short' });
  const big = lint.contextCostTokens({ name: 'a', description: 'x'.repeat(1000) });
  assert.ok(big > small, 'a longer description costs more');

  // The body is read only when the skill is chosen, so it must not be counted.
  const withBody = lint.contextCostTokens({ name: 'a', description: 'short', content: 'y'.repeat(50000) });
  assert.equal(withBody, small, 'the body is not part of the standing cost');
});

test('the cost is four characters per token plus a per-entry overhead', () => {
  const tokens = lint.contextCostTokens({ name: 'abcd', description: 'efgh' });
  assert.equal(tokens, Math.ceil(8 / 4) + 12);
});

test('a cost is shown as a token estimate, and a missing skill costs nothing', () => {
  assert.equal(lint.contextCostLabel(84), '~84 tokens');
  assert.equal(lint.contextCostTokens(null), 12);
  assert.equal(lint.contextCostTokens({}), 12);
});

test('the running total warns near the budget and reads as over past it', () => {
  assert.equal(lint.contextBudgetStatus(5, 20), 'ok');
  assert.equal(lint.contextBudgetStatus(15, 20), 'warn');
  assert.equal(lint.contextBudgetStatus(20, 20), 'over');
  assert.equal(lint.contextBudgetStatus(40, 20), 'over');
  assert.equal(lint.contextBudgetStatus(1), 'ok', 'there is a default budget');
});

test('an empty catalogue install is refused rather than allowed for free', () => {
  // The regression this guards: a name that fails to parse must not read as
  // zero cost, which would make a broken skill look like the cheapest thing in
  // the store.
  assert.equal(lint.contextCostTokens({ name: '', description: '' }), 12);
});

// ---- B3: the rules that block ------------------------------------------------

test('a well-formed skill lints clean', () => {
  const result = lint.lintSkill(ok('disk-full', 'Triage a "disk full" alert on a Linux box.'), { folder: 'disk-full' });
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
  assert.deepEqual(result.warnings, [], JSON.stringify(result.warnings));
});

test('no frontmatter at all is an error, not an empty skill', () => {
  const result = lint.lintSkill('Just a body, no frontmatter.\n');
  assert.equal(result.errors.length, 1);
  assert.ok(has(result.errors, 'No frontmatter block'), JSON.stringify(result.errors));
});

test('a missing name or description is an error, because the router reads both', () => {
  const noName = lint.lintSkill('---\ndescription: Does a thing with a quoted "trigger" here.\n---\n\nBody.\n');
  assert.ok(has(noName.errors, 'no name'), JSON.stringify(noName.errors));

  const noDescription = lint.lintSkill('---\nname: thing\n---\n\nBody.\n');
  assert.ok(has(noDescription.errors, 'no description'), JSON.stringify(noDescription.errors));
});

test('a name that is not kebab-case, or is not its folder, is an error', () => {
  const notKebab = lint.lintSkill(ok('Disk_Full', 'Triage a "disk full" alert on a Linux box.'));
  assert.ok(has(notKebab.errors, 'not kebab-case'), JSON.stringify(notKebab.errors));

  // The name is the folder: it is where the engine looks for the skill, so a
  // mismatch installs it somewhere it will never be found.
  const wrongFolder = lint.lintSkill(ok('disk-full', 'Triage a "disk full" alert on a Linux box.'), { folder: 'disk-other' });
  assert.ok(has(wrongFolder.errors, 'not the folder it installs into'), JSON.stringify(wrongFolder.errors));

  // ...and passing no folder skips that rule rather than failing it.
  const noFolder = lint.lintSkill(ok('disk-full', 'Triage a "disk full" alert on a Linux box.'));
  assert.ok(!has(noFolder.errors, 'not the folder it installs into'));
});

test('an over-long or multi-line description is an error: it rides in every prompt', () => {
  const long = lint.lintSkill(ok('big', 'x'.repeat(lint.MAX_DESCRIPTION + 1)));
  assert.ok(has(long.errors, 'characters (max'), JSON.stringify(long.errors));

  const multiline = lint.lintSkill('---\nname: folded\ndescription: a description that\n  spills onto a second line\n---\n\nBody.\n');
  assert.ok(has(multiline.errors, 'more than one line'), JSON.stringify(multiline.errors));
});

test('an empty body, or one over 500 lines, is an error', () => {
  const empty = lint.lintSkill('---\nname: hollow\ndescription: Has a description with a "quoted trigger".\n---\n\n   \n');
  assert.ok(has(empty.errors, 'body is empty'), JSON.stringify(empty.errors));

  const long = lint.lintSkill(
    '---\nname: long\ndescription: Has a description with a "quoted trigger".\n---\n\n' +
    'line\n'.repeat(lint.MAX_BODY_LINES + 1)
  );
  assert.ok(has(long.errors, 'lines (max'), JSON.stringify(long.errors));
});

test('an unknown frontmatter key is an error, because it is almost always a typo', () => {
  const typo = lint.lintSkill('---\nname: typo\ndescription: Has a description with a "quoted trigger".\ndescriptions: oops\n---\n\nBody.\n');
  assert.ok(has(typo.errors, 'unknown key "descriptions"'), JSON.stringify(typo.errors));

  // A key we do read must not trip it.
  const known = lint.lintSkill('---\nname: fine\ndescription: Has a description with a "quoted trigger".\ncompatibility: [jq]\n---\n\nBody.\n');
  assert.ok(!has(known.errors, 'unknown key'), JSON.stringify(known.errors));
});

test('a dead relative link is an error, but only when the caller can check one', () => {
  const text = 'See [the guide](references/guide.md) for more.\n';
  const bare = lint.lintSkill(ok('linky', 'Has a description with a "quoted trigger".\n') + '\n' + text);
  // Without hasFile the link rule is skipped rather than reported as dead:
  // nothing was fetched, so "dead" would be a lie.
  assert.ok(!has(bare.errors, 'references/guide.md'), JSON.stringify(bare.errors));

  const checked = lint.lintSkill(ok('linky', 'Has a description with a "quoted trigger".\n') + '\n' + text, {
    hasFile: (p) => p === 'references/other.md',
  });
  assert.ok(has(checked.errors, 'references/guide.md'), JSON.stringify(checked.errors));

  // An http link is not a repo path and must not be checked.
  const web = lint.lintSkill(ok('linky', 'Has a description with a "quoted trigger".\n') + '\nSee [docs](https://example.com).\n', {
    hasFile: () => false,
  });
  assert.ok(!has(web.errors, 'example.com'), JSON.stringify(web.errors));
});

test('a description identical to an installed skill is an error', () => {
  const result = lint.lintSkill(ok('twin', 'Triage a "disk full" alert on a Linux box.'), {
    installed: [{ name: 'other', description: 'Triage a "disk full" alert on a Linux box.' }],
  });
  assert.ok(has(result.errors, 'same description'), JSON.stringify(result.errors));
});

// ---- the rules that warn -----------------------------------------------------

test('a terse description warns but installs: the router may never find it', () => {
  const result = lint.lintSkill(ok('terse', 'Does disk things.'));
  assert.deepEqual(result.errors, [], 'a terse description is not a broken skill');
  assert.ok(has(result.warnings, 'characters'), JSON.stringify(result.warnings));
});

test('a description with no quoted trigger warns', () => {
  const result = lint.lintSkill(ok('quiet', 'A perfectly reasonable description of a skill that names no trigger.'));
  assert.deepEqual(result.errors, []);
  assert.ok(has(result.warnings, 'quotes no trigger'), JSON.stringify(result.warnings));
});

test('a warning is never promoted to an error, and an error never demoted', () => {
  // The split itself, in one test: both kinds at once, in their own half.
  const result = lint.lintSkill('---\nname: terse\ndescription: Short.\nbogus: 1\n---\n\nBody.\n');
  assert.ok(has(result.errors, 'unknown key'), 'the typo is an error');
  assert.ok(has(result.warnings, 'characters'), 'the terse description is a warning');
  assert.ok(!has(result.errors, 'characters'), 'the terse description did not become an error');
  assert.ok(!has(result.warnings, 'unknown key'), 'the typo did not become a warning');
});

// ---- B4: rules that need more than one skill --------------------------------

test('two skills sharing two or more triggers are flagged on both', () => {
  const results = lint.lintSkills([
    { name: 'a', text: ok('a', 'Handles a "disk full" alert and a "no space left" error.') },
    { name: 'b', text: ok('b', 'Also handles a "disk full" alert and a "no space left" error.') },
  ]);
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.ok(has(r.warnings, 'cannot tell them apart'), `${r.name}: ${JSON.stringify(r.warnings)}`);
  }
});

test('sharing one trigger is not a collision', () => {
  // One shared trigger is two skills that overlap a little, which is normal
  // and not something to nag about. Two is a pair the router cannot separate.
  const results = lint.lintSkills([
    { name: 'a', text: ok('a', 'Handles a "disk full" alert on Linux, and nothing else.') },
    { name: 'b', text: ok('b', 'Handles a "network down" alert on Windows, and nothing else.') },
  ]);
  for (const r of results) {
    assert.ok(!has(r.warnings, 'cannot tell them apart'), `${r.name}: ${JSON.stringify(r.warnings)}`);
  }
});

test('two catalogue entries with the same description are told about each other', () => {
  const same = 'Triage a "disk full" alert on a Linux box.';
  const results = lint.lintSkills([
    { name: 'a', text: ok('a', same) },
    { name: 'b', text: ok('b', same) },
  ]);
  const flagged = results.filter((r) => has(r.errors, 'same description'));
  assert.equal(flagged.length, 1, 'the later entry names the earlier one');
  assert.ok(has(flagged[0].errors, '"a"'), JSON.stringify(flagged[0].errors));
});

test('two entries of the same name are two findings, not one merged row', () => {
  // The catalogue is broken either way; what matters is that both entries are
  // judged on their own text rather than one overwriting the other's result.
  const results = lint.lintSkills([
    { name: 'dup', text: ok('dup', 'Does the first thing, mentioned as a "quoted trigger".') },
    { name: 'dup', text: '---\nname: dup\n---\n\nA body with no description at all.\n' },
  ]);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0].errors, [], 'the first entry is sound on its own');
  assert.ok(has(results[1].errors, 'no description'), JSON.stringify(results[1].errors));
});

test('a generic quoted word is not a trigger', () => {
  // "code" and "api" fire on every prompt, so a trigger made of them teaches
  // the router nothing -- which is worse than no trigger at all. Only the
  // quoted words count; the prose around them is not a trigger.
  assert.deepEqual(lint.triggers('Helps with "the" and "and" and "code".'), ['code']);
  assert.deepEqual(lint.triggers('Handles a "disk full" alert.'), ['disk', 'full']);
  assert.deepEqual(lint.triggers('No quotes here at all.'), []);
});

test('sharedTriggers counts what two descriptions have in common', () => {
  assert.deepEqual(lint.sharedTriggers('a "disk full" thing', 'a "disk full" thing'), ['disk', 'full']);
  // The word "thing" sits outside the quotes in both, so it is not a trigger
  // and cannot make two skills collide.
  assert.deepEqual(lint.sharedTriggers('a "disk full" thing', 'a "network down" thing'), []);
});

// ---- B5: the negative trigger -------------------------------------------------

test('a "do not use when" clause is surfaced, in the forms authors actually write', () => {
  assert.equal(lint.negativeTriggers('Formats tables. Do not use when the input is JSON.'), 'the input is JSON.');
  assert.equal(lint.negativeTriggers("Formats tables. Don't use when the input is CSV."), 'the input is CSV.');
  assert.equal(lint.negativeTriggers('Formats tables. Not for binary files.'), 'binary files.');
  assert.equal(lint.negativeTriggers('Formats tables.'), '');
});

test('a negative trigger does not block the install', () => {
  const result = lint.lintSkill(ok('fmt', 'Formats tables with a "quoted trigger". Do not use when the input is JSON.'));
  assert.deepEqual(result.errors, []);
  assert.ok(lint.negativeTriggers(result.parsed.description));
});

// ---- parsing ------------------------------------------------------------------

test('frontmatter parsing keeps the body, the keys, and a folded value', () => {
  const parsed = lint.parseFrontmatter(ok('disk-full', 'Triage a "disk full" alert.'));
  assert.equal(parsed.name, 'disk-full');
  assert.equal(parsed.description, 'Triage a "disk full" alert.');
  assert.ok(parsed.body.includes('echo hi'), 'the body survives parsing');
  assert.deepEqual(parsed.keys, ['name', 'description']);
  assert.equal(lint.parseFrontmatter('no block here'), null);
  assert.equal(lint.parseFrontmatter(null), null);
});

test('a YAML list in the frontmatter is read as a list', () => {
  const parsed = lint.parseFrontmatter(
    '---\nname: tools\ndescription: Needs a "quoted trigger" to be found.\ncompatibility:\n  - jq\n  - curl\n---\n\nBody.\n'
  );
  assert.deepEqual(parsed.keys, ['name', 'description', 'compatibility']);
});

// ---- B7: what the skill needs from the machine --------------------------------

test('prerequisites are read from a compatibility key and a section', () => {
  const names = prereqs.prerequisites({
    frontmatter: 'jq, curl',
    content: '## Prerequisites\n\n- `git` for the history\n- python3: to run the tests\n\n## Usage\n\n- `notapackage` here should be ignored\n',
  });
  assert.ok(names.includes('jq'), JSON.stringify(names));
  assert.ok(names.includes('curl'), JSON.stringify(names));
  assert.ok(names.includes('git'), JSON.stringify(names));
  assert.ok(names.includes('python3'), JSON.stringify(names));
  assert.ok(!names.includes('usage'), 'a section that is not a prerequisites list is not read');
  assert.ok(!names.includes('notapackage'), 'a bullet outside the section is not read');
});

test('a section ends at the next heading', () => {
  const names = prereqs.prerequisites({ content: '## Prerequisites\n\n`jq`\n\n## Usage\n\n`docker`\n' });
  assert.deepEqual(names, ['jq']);
});

test('prose is not mistaken for a program name', () => {
  assert.deepEqual(prereqs.normalize('internet'), '');
  assert.deepEqual(prereqs.normalize('sudo'), '');
  assert.deepEqual(prereqs.normalize('/usr/bin/thing'), '');
  assert.deepEqual(prereqs.normalize('node >= 18'), 'node');
  assert.equal(prereqs.normalize('git'), 'git');
});

test('a missing tool is named, with an install hint, and does not block', () => {
  const check = prereqs.checkPrerequisites({ content: '## Prerequisites\n\n`jq`\n`curl`\n' }, (t) => t === 'curl');
  assert.equal(check.missing.length, 1);
  assert.equal(check.missing[0].name, 'jq');
  assert.equal(check.present.length, 1);
  assert.equal(prereqs.installHint(check.missing[0]), 'apt install jq');
  assert.ok(prereqs.missingWarning(check.missing).includes('jq'));
});

test('a tool with no apt line says so rather than inventing one', () => {
  const record = prereqs.describe('nvm');
  assert.equal(record.apt, null);
  assert.ok(prereqs.installHint(record).length > 0, 'there is still something to say');

  // A tool nobody has heard of is still described, with no hint rather than a
  // wrong one.
  const unknown = prereqs.describe('someobscuretool');
  assert.equal(unknown.known, false);
  assert.equal(prereqs.installHint(unknown), '');
});

test('Node is the one tool NeuraOS offers to install itself', () => {
  assert.equal(prereqs.describe('node').runtime, 'node');
  assert.ok(prereqs.installHint(prereqs.describe('node')).includes('NeuraOS can install'));
  for (const tool of ['jq', 'git', 'docker', 'python3']) {
    assert.equal(prereqs.describe(tool).runtime, null, `${tool} is not a one-click runtime`);
  }
});

test('a skill with no prerequisites asks for nothing', () => {
  const check = prereqs.checkPrerequisites({ content: 'Just a body.\n' }, () => false);
  assert.deepEqual(check.required, []);
  assert.deepEqual(check.missing, []);
  assert.equal(prereqs.missingWarning(check.missing), '');
});

test('a skill that needs nothing this machine lacks produces no warning', () => {
  const check = prereqs.checkPrerequisites({ content: '## Prerequisites\n\n`jq`\n' }, () => true);
  assert.equal(prereqs.missingWarning(check.missing), '');
});
