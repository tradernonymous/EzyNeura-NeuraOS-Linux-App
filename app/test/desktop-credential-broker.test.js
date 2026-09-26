// C10 (upgrade plan, wave 3): the credential broker. credentials.js is pure
// — the index and the validation rules that mirror broker.rs — so the whole
// "what may be written to the keyring, and what the page is allowed to
// remember" contract is tested here; the pins keep the tools, the dispatch
// and the Settings card honest about where the secret goes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const creds = require('../desktop/src/credentials.js');
const tools = require('../desktop/src/tools.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/** localStorage's shape, in memory. */
function box() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('a name is an id only by the rule the shell enforces', () => {
  assert.ok(creds.isId('nas'));
  assert.ok(creds.isId('home.lan'));
  assert.ok(!creds.isId(''));
  assert.ok(!creds.isId('NAS'), 'lowercase only');
  assert.ok(!creds.isId('a..b'), 'no .., the shell refuses it too');
  assert.ok(!creds.isId('x'.repeat(65)));
  assert.ok(!creds.isId('git:https://github.com'));
  assert.equal(creds.keyFor('ssh', 'nas'), 'ssh.nas');
  assert.equal(creds.keyFor('api', 'home'), 'api.home');
  assert.equal(creds.keyFor('ssh', 'NAS'), '', 'a refused name gets no key');
  assert.equal(creds.keyFor('nope', 'nas'), '');
});

test('the form is refused before a keyring entry exists', () => {
  // SSH: everything broker.rs checks, checked here first.
  const good = creds.sshProfile({ user: 'jack', host: 'nas.local', port: '22', identity: 'KEYMATERIAL' });
  assert.ok(!good.error, good.error);
  const parsed = JSON.parse(good.profile);
  assert.deepEqual(parsed, { user: 'jack', host: 'nas.local', port: 22, identity: 'KEYMATERIAL' });
  assert.equal(good.detail, 'jack@nas.local:22');
  assert.ok(!good.detail.includes('KEYMATERIAL'), 'the index line never carries the key');

  assert.ok(creds.sshProfile({ user: 'a b', host: 'h' }).error, 'no spaces in a user');
  assert.ok(creds.sshProfile({ user: 'u@other', host: 'h' }).error, 'no second host in the user');
  assert.ok(creds.sshProfile({ user: 'u', host: '-L8080:evil' }).error, 'a host cannot start an option');
  assert.ok(creds.sshProfile({ user: 'u', host: 'h; rm -rf /' }).error, 'no shell punctuation');
  assert.ok(creds.sshProfile({ user: 'u', host: 'h', port: '0' }).error, 'ports are 1..65535');
  assert.ok(creds.sshProfile({ user: 'u', host: 'h', port: 'ssh' }).error);
  const noKey = creds.sshProfile({ user: 'u', host: 'h' });
  assert.ok(!('identity' in JSON.parse(noKey.profile)), 'no key means no key field');

  // API: the address, the header, the prefix, the secret.
  const api = creds.apiProfile({ base: 'https://api.example.com/v1/', secret: 'tok_1' });
  assert.ok(!api.error, api.error);
  const apiParsed = JSON.parse(api.profile);
  assert.equal(apiParsed.base, 'https://api.example.com/v1', 'the trailing slash is gone');
  assert.equal(apiParsed.header, 'Authorization', 'the default header');
  assert.equal(apiParsed.prefix, 'Bearer ', 'the default prefix');
  assert.equal(api.detail, 'api.example.com/v1');
  assert.ok(!api.detail.includes('tok_1') && !JSON.stringify(creds.list(box())).includes('tok_1'));

  assert.ok(creds.apiProfile({ base: 'ftp://x', secret: 's' }).error, 'http or https only');
  assert.ok(creds.apiProfile({ base: 'https://user:p@x', secret: 's' }).error, 'no login in the address');
  assert.ok(creds.apiProfile({ base: 'not a url', secret: 's' }).error);
  assert.ok(creds.apiProfile({ base: 'https://x', secret: '' }).error, 'a secret is the point');
  assert.ok(creds.apiProfile({ base: 'https://x', secret: 's', header: 'X Bad' }).error, 'not a header name');
  assert.ok(creds.apiProfile({ base: 'https://x', secret: 's', prefix: 'a\nb' }).error, 'no newline in a header');
});

test('the index remembers names, never secrets, and upserts by kind+name', () => {
  const store = box();
  assert.ok(creds.remember('ssh', 'nas', 'jack@nas.local', store));
  assert.ok(creds.remember('api', 'home', 'api.example.com', store));
  creds.remember('ssh', 'nas', 'jack@nas.local/22', store); // twice: one row
  const rows = creds.list(store);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.kind === 'ssh').length, 1, 'upsert, not append');
  assert.equal(rows.find((r) => r.kind === 'ssh').detail, 'jack@nas.local/22');

  assert.ok(!creds.remember('ssh', 'NAS', 'x', store), 'a refused name is not indexed');
  creds.forget('ssh', 'nas', store);
  assert.deepEqual(creds.list(store).map((r) => r.kind), ['api']);

  const store2 = box();
  creds.remember('ssh', 'k', 'd', store2);
  const raw = store2.getItem(creds.KEY);
  assert.ok(raw && !raw.includes('secret'), 'no value ever lands in the index');
});

test('the tools ask, are marked untrusted, and need the shell', () => {
  const names = (list) => list.map((t) => t.function.name);
  assert.deepEqual(names(tools.BROKER), ['ssh_run', 'http_auth']);
  assert.deepEqual(tools.BROKER_NAMES, names(tools.BROKER));

  const withShell = names(tools.catalogue({ shell: true, localRoot: '/p' }, {}));
  const without = names(tools.catalogue({ localRoot: '/p' }, {}));
  for (const name of tools.BROKER_NAMES) {
    assert.ok(withShell.includes(name), `${name} is offered with a shell`);
    assert.ok(!without.includes(name), `${name} needs the shell`);
    assert.ok(tools.needsApproval(name, {}), `${name} asks every time`);
    assert.ok(tools.ASKS[name], `${name} has a reason`);
    assert.equal(tools.alwaysKey(name), '', `${name} can never be trusted wholesale`);
    assert.ok(tools.untrustedSource(name), `${name}'s output is marked untrusted`);
  }
  // The schemas name profiles and paths — never a field that could carry a secret.
  for (const t of tools.BROKER) {
    const props = Object.keys(t.function.parameters.properties);
    assert.ok(!props.includes('secret') && !props.includes('key') && !props.includes('identity'),
      `${t.function.name} asks for names, not secrets`);
  }
  // The approval card says what will happen, in the person's words.
  assert.equal(tools.summarise('ssh_run', { target: 'nas', command: 'uptime' }), 'Run uptime on nas');
  assert.equal(tools.summarise('http_auth', { name: 'home', path: '/status' }), 'GET home/status');
});

test('the shell is the only way out: dispatch, card and registration agree', () => {
  const run = read('desktop', 'src', 'tool-run.ts');
  assert.match(run, /tools\.BROKER_NAMES\.includes\(name\)\) return broker\(name, args\)/, 'the two names dispatch to the broker');
  assert.match(run, /if \(!hasShell\(\)\) return 'Error: the credential broker lives/, 'no shell, no broker');
  assert.match(run, /call<string>\('credential_op', \{ op: name, args \}\)/, 'one named operation for the shell');
  assert.match(run, /target: String\(a\.target \?\? ''\), command: String\(a\.command \?\? ''\)/, 'ssh passes names only');

  const card = read('desktop', 'src', 'components', 'CredentialsCard.tsx');
  assert.match(card, /secretSet\(key, built\.profile\)/, 'the form writes the keyring, one way');
  assert.match(card, /creds\.remember\('ssh', name, built\.detail \|\| ''\)/, 'only the detail line is indexed');
  assert.match(card, /secretDelete\(creds\.keyFor\(kind, name\)\)/, 'removal takes the keyring entry too');
  assert.match(card, /if \(!hasShell\(\)\) return null;/, 'the card exists where the broker does');
  assert.ok(!card.includes('secretGet'), 'nothing reads a secret back into the page');

  const settings = read('desktop', 'src', 'screens', 'SettingsScreen.tsx');
  assert.match(settings, /<CredentialsCard \/>/, 'the card is on the screen');
  const groups = read('desktop', 'src', 'settings-groups.js');
  assert.ok(groups.includes("'Credentials'"), 'the section has a group');

  // The shell side is registered the same way as the secrets it reads.
  const main = read('desktop', 'src-tauri', 'src', 'main.rs');
  assert.match(main, /^mod broker;$/m, 'the module is declared');
  assert.match(main, /broker::credential_op,/, 'the command is registered');
  const secrets = read('desktop', 'src-tauri', 'src', 'secrets.rs');
  assert.match(secrets, /pub const SSH_PREFIX: &str = "ssh\."/);
  assert.match(secrets, /pub const API_PREFIX: &str = "api\."/);
  assert.match(secrets, /is_broker_key\(key\)/, 'the two families are in the whitelist');
  const broker = read('desktop', 'src-tauri', 'src', 'broker.rs');
  assert.match(broker, /BatchMode=yes/, 'ssh never prompts');
  assert.match(broker, /remove_file/, 'the key file is deleted on every path out');
  assert.match(broker, /redirect\(reqwest::redirect::Policy::none\(\)\)/, 'redirects are checked by hand');
});
