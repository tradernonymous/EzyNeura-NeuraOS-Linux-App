// The bubblewrap sandbox line (docs/MASTER_PLAN.md section 6): the host
// read-only, the project read-write at /work, no network, and the same
// script-file fallback the Docker line uses for a command that cannot sit
// inside double quotes.
const test = require('node:test');
const assert = require('node:assert/strict');
const sandbox = require('../desktop/src/docker-sandbox.js');

test('bwrap wraps a plain command without an image', () => {
  const out = sandbox.wrap({ root: '/home/me/proj', command: 'npm test', cwd: '', image: '', binary: 'bwrap' });
  assert.equal(out.ok, true);
  assert.equal(out.command, 'bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --bind "/home/me/proj" /work --chdir /work --unshare-net --die-with-parent sh -lc "npm test"');
  assert.equal(out.script, undefined);
});

test('bwrap keeps the cwd inside /work and falls back to a script file', () => {
  const out = sandbox.wrap({ root: '/home/me/proj', command: 'echo "hi"', cwd: 'sub', image: '', binary: 'bwrap' });
  assert.equal(out.ok, true);
  assert.match(out.command, /--chdir "\/work\/sub" --unshare-net --die-with-parent sh \/work\/\.neuraos\/sandbox-[a-z0-9]+\.sh$/);
  assert.ok(out.script && out.script.path.startsWith('.neuraos/sandbox-'));
});

test('docker still needs a valid image and bwrap is a known binary', () => {
  assert.equal(sandbox.wrap({ root: '/home/me/proj', command: 'ls', image: 'not valid!', binary: 'docker' }).ok, false);
  assert.ok(sandbox.wrap({ root: '/home/me/proj', command: 'ls', image: 'node:22', binary: 'podman' }).command.startsWith('podman run --rm'));
});
