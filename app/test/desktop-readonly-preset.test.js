// C11 (upgrade plan): "Allow a list of known read-only commands once per
// project ... and keep Ask for everything else." approval.js decides what
// counts as read-only (an allowlist — anything the rules do not understand
// asks), the per-folder switch is the "once per project", and the pins keep
// every gate wired to both.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const approval = require('../desktop/src/approval.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/** A localStorage stand-in: approval.js takes the store as a parameter. */
const store = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
};

test('known read-only commands pass, including their flags', () => {
  const yes = [
    'ls -la',
    'cat notes.md',
    'git status',
    'git log --oneline -5',
    'git diff HEAD~1',
    'git branch -a',
    'git branch --show-current',
    'git remote -v',
    'git remote show origin',
    'git stash list',
    'git tag -l',
    'git config --get user.name',
    'git blame src/main.rs',
    'npm ls',
    'npm view react version',
    'node --version',
    'python3 --version',
    'docker ps -a',
    'docker logs api',
    'systemctl status nginx',
    'find . -name "*.ts"',
    'find . -name node_modules -prune -o -name "*.js" -print',
    'grep -rn TODO src',
    'rg --hidden pattern',
    'ps aux',
    'df -h',
    'du -sh build',
    'journalctl -u app --since today',
    'date',
    "date '+%Y-%m-%d'",
    'echo hello',
    'sha256sum file.bin',
    'ls',
  ];
  for (const cmd of yes) assert.equal(approval.isReadonlyCommand(cmd), true, `should allow: ${cmd}`);
});

test('anything that writes, executes, chains or redirects asks', () => {
  const no = [
    '',
    '   ',
    'rm -rf /',
    'sudo ls', // a path or a wrapper the list does not know is not on the list
    '/bin/ls',
    'ls > out.txt',
    'echo hi > /etc/passwd',
    'ls && rm -rf .',
    'cat a | wc -l',
    'ls; touch x',
    'ls `rm -rf /`',
    'ls $(rm -rf /)',
    'git commit -m "x"',
    'git push',
    'git checkout main', // switches branches: it changes the worktree
    'git branch feature-x', // CREATES a branch
    'git branch -d main', // -d is never read-only
    'git branch --delete main',
    'git remote add origin git@x:y.git',
    'git stash', // bare git stash COMMITS the worktree
    'git stash drop',
    'git tag v1.0.0', // creates a tag
    'git tag -d v1.0.0',
    'git config user.name x', // writes the config
    'git log --output=leak.txt', // a flag that writes
    'npm install express', // mutates node_modules
    'npm run build',
    'node -e "require(\'fs\').writeFileSync(\'x\',\'\')"',
    'find . -delete',
    'find . -name x -exec rm {} +',
    'tail -f /var/log/syslog', // -f follows forever
    'sort -o out in', // sort is not on the list at all
    'date -s "2020-01-01"', // sets the clock
    'curl http://example.com',
    'wget x',
    'chmod 777 file',
    'constructor x', // no prototype tricking an allowlist
    'toString',
  ];
  for (const cmd of no) assert.equal(approval.isReadonlyCommand(cmd), false, `should ask: ${cmd}`);
});

test('the switch is per folder, and only the preset can open it', () => {
  const s = store();
  const folder = '/home/jack/project';
  assert.equal(approval.presetOn(folder, s), false, 'off until thrown');
  assert.equal(approval.presetAllows(folder, 'run_command', { command: 'git status' }, s), false, 'off means ask');
  assert.equal(approval.allowPreset(folder, s), true);
  assert.equal(approval.presetOn(folder, s), true);
  assert.deepEqual(approval.presetProjects(s), [folder]);
  assert.equal(approval.presetOn('/home/jack/other', s), false, 'one project, not every project');
  assert.equal(approval.presetOn('', s), false, 'no folder is never on');
  assert.equal(approval.allowPreset('', s), false, 'and cannot be turned on');
  assert.equal(approval.revokePreset(folder, s), true);
  assert.equal(approval.presetOn(folder, s), false, 'and can be taken back');
  assert.deepEqual(approval.presetProjects(s), []);
});

test('the gate answers yes only for read-only commands in an on folder', () => {
  const s = store();
  const folder = '/p';
  approval.allowPreset(folder, s);
  assert.equal(approval.presetAllows(folder, 'run_command', { command: 'git status' }, s), true);
  assert.equal(approval.presetAllows(folder, 'run_command', { command: 'rm -rf build' }, s), false, 'not read-only, still asks');
  assert.equal(approval.presetAllows(folder, 'write_file', { command: 'ls' }, s), false, 'not a command at all');
  assert.equal(approval.presetAllows(folder, 'run_command', null, s), false);
  assert.equal(approval.presetAllows(null, 'run_command', { command: 'ls' }, s), false);
  // Garbage in storage reads as off, like every other setting here.
  const broken = { getItem: () => '{{{', setItem: () => {} };
  assert.equal(approval.presetOn(folder, broken), false);
});

test('every gate is wired to the preset', () => {
  const chat = read('app', 'desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chat, /approval\.presetAllows\(root, name, nameArgs\)/, 'the chat turn asks through it');
  assert.match(chat, /approval\.allowPreset\(openFolder\(\)\)/, 'the chat card can turn it on');

  const agent = read('app', 'desktop', 'src', 'coding-agent.js');
  assert.match(agent, /ap\.presetAllows\(session\.root, call\.name, args\)/, 'the coding agent consults it');
  assert.match(agent, /FreeAI4UApproval/, 'read off the global, like project-config');

  const turn = read('app', 'desktop', 'src', 'agent-turn.ts');
  assert.match(turn, /options\.asks \? options\.asks\(call\.name, args\) : tools\.needsApproval\(call\.name\)/, 'the screen may override the ask');

  const cards = read('app', 'desktop', 'src', 'components', 'ToolCards.tsx');
  assert.match(cards, /isReadonlyCommand\(\(event\.args \|\| \{\}\)\.command\)/, 'the card offers it for read-only commands');

  const code = read('app', 'desktop', 'src', 'screens', 'CodeScreen.tsx');
  assert.match(code, /approvalLib\.allowPreset\(localRoot\)/, 'the Code card offers it too');

  const activity = read('app', 'desktop', 'src', 'screens', 'ActivityScreen.tsx');
  assert.match(activity, /revokePreset\(folder\)/, 'and Activity lists them with a way off');

  const dts = read('app', 'desktop', 'src', 'approval.d.ts');
  for (const pin of ['isReadonlyCommand', 'presetOn', 'allowPreset', 'revokePreset', 'presetAllows', 'presetProjects']) {
    assert.ok(dts.includes(pin), `${pin} is typed`);
  }
});
