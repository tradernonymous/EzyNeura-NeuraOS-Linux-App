// The Linux update path (docs/MASTER_PLAN.md L7): the manifest the release
// workflow stages, where the app reads it from, and which artifact updates
// which kind of install. Windows' rules (update.test.js upstream) are
// untouched; these pin the delta.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const update = require('../desktop/src/update.js');

const ROOT = path.join(__dirname, '..', '..');
const LINUX_REPO = 'tradernonymous/EzyNeura-NeuraOS-Linux-App';

test('the Linux port reads the manifest through releases/latest', () => {
  assert.equal(
    update.versionUrl(LINUX_REPO, update.LATEST_TAG),
    'https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/releases/latest/download/desktop-version.json',
  );
  assert.equal(update.desktopUrl(LINUX_REPO, update.LATEST_TAG), 'https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/releases/latest');
  assert.equal(
    update.artifactUrl(LINUX_REPO, 'neura-os-desktop_2.12.0_amd64.deb', update.LATEST_TAG),
    'https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/releases/latest/download/neura-os-desktop_2.12.0_amd64.deb',
  );
  // Upstream's shape is unchanged: the moving tag, by default.
  assert.equal(update.versionUrl(), 'https://github.com/tradernonymous/freeopenai/releases/download/desktop-latest/desktop-version.json');
  assert.equal(update.desktopUrl(), 'https://github.com/tradernonymous/freeopenai/releases/tag/desktop-latest');
});

const RELEASE = update.readVersionPayload({
  version: '2.12.0',
  artifacts: [
    { name: 'neura-os-desktop_2.12.0_amd64.deb', sha256: 'a'.repeat(64), size: 90000000 },
    { name: 'NeuraOS-2.12.0-x86_64.AppImage', sha256: 'b'.repeat(64), size: 110000000 },
  ],
});

test('a .deb install gets the .deb and an AppImage gets the AppImage, never the other', () => {
  assert.equal(update.installerFor(RELEASE, 'deb').name, 'neura-os-desktop_2.12.0_amd64.deb');
  assert.equal(update.installerFor(RELEASE, 'appimage').name, 'NeuraOS-2.12.0-x86_64.AppImage');
  // A bare binary is never handed an installer.
  assert.equal(update.installerFor(RELEASE, 'portable'), null);
  // A release with only the other kind offers nothing rather than the wrong file.
  const debOnly = update.readVersionPayload({ version: '2.12.0', artifacts: [{ name: 'neura-os-desktop_2.12.0_amd64.deb' }] });
  assert.equal(update.installerFor(debOnly, 'appimage'), null);
});

test('the install plan for a Linux artifact points at the latest release and is verified', () => {
  const plan = update.installPlan({ installer: update.installerFor(RELEASE, 'deb'), repo: LINUX_REPO, tag: update.LATEST_TAG });
  assert.equal(plan.url, 'https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/releases/latest/download/neura-os-desktop_2.12.0_amd64.deb');
  assert.equal(plan.verified, true);
  assert.equal(plan.sha256, 'a'.repeat(64));
});

test('the staging script writes the manifest the app reads, with the stable names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuraos-stage-'));
  try {
    fs.mkdirSync(path.join(dir, 'bundle', 'deb'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'bundle', 'appimage'), { recursive: true });
    // What tauri build actually names them: the product name, space included.
    fs.writeFileSync(path.join(dir, 'bundle', 'deb', 'NeuraOS Desktop_2.12.0_amd64.deb'), 'deb-bytes');
    fs.writeFileSync(path.join(dir, 'bundle', 'appimage', 'NeuraOS Desktop_2.12.0_amd64.AppImage'), 'appimage-bytes');
    execFileSync('bash', [path.join(ROOT, 'packaging', 'release', 'stage.sh'), path.join(dir, 'bundle'), path.join(dir, 'out'), '2.12.0', 'abc1234'], { stdio: 'pipe' });
    const out = path.join(dir, 'out');
    assert.deepEqual(fs.readdirSync(out).sort(), ['NeuraOS-2.12.0-x86_64.AppImage', 'SHA256SUMS', 'desktop-version.json', 'neura-os-desktop_2.12.0_amd64.deb']);
    const parsed = update.readVersionPayload(JSON.parse(fs.readFileSync(path.join(out, 'desktop-version.json'), 'utf8')));
    assert.equal(parsed.version, '2.12.0');
    assert.equal(parsed.commit, 'abc1234');
    assert.equal(update.installerFor(parsed, 'deb').name, 'neura-os-desktop_2.12.0_amd64.deb');
    assert.equal(update.installerFor(parsed, 'appimage').name, 'NeuraOS-2.12.0-x86_64.AppImage');
    // The digests are real, so a download is verified against them.
    for (const artifact of parsed.artifacts) {
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
      assert.ok(artifact.size > 0);
      assert.equal(update.installPlan({ installer: artifact }).verified, true);
    }
    // The AppImage is executable as staged.
    assert.ok(fs.statSync(path.join(out, 'NeuraOS-2.12.0-x86_64.AppImage')).mode & 0o111);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the release workflow and the app agree on the stable names and the key variable', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'desktop-build.yml'), 'utf8');
  const stage = fs.readFileSync(path.join(ROOT, 'packaging', 'release', 'stage.sh'), 'utf8');
  const net = fs.readFileSync(path.join(ROOT, 'app', 'desktop', 'src-tauri', 'src', 'net.rs'), 'utf8');
  assert.match(stage, /neura-os-desktop_\$\{VERSION\}_amd64\.deb/);
  assert.match(stage, /NeuraOS-\$\{VERSION\}-x86_64\.AppImage/);
  assert.match(workflow, /neura-os-desktop_\$\{VERSION\}_amd64\.deb/);
  // The public key is compiled into the app by the shared build, so that is
  // where the variable is read now. What still has to be true -- and what this
  // test is really for -- is that the release path goes through that build: a
  // release that inlined its own steps again, without the env, would publish a
  // manifest signed by a key no installed app trusts.
  assert.match(build, /NEURAOS_UPDATER_PUBKEY: \$\{\{ inputs\.neuraos_updater_pubkey \|\| vars\.NEURAOS_UPDATER_PUBKEY \}\}/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/desktop-build\.yml/);
  assert.match(net, /option_env!\("NEURAOS_UPDATER_PUBKEY"\)/);
  assert.match(workflow, /tauri signer sign/);
});

// "Check for updates" before any release is published: the manifest URL
// answers 404, and the app must say so instead of reporting a server error.
test('a missing release is one attempt and no answer, not a retried failure', async () => {
  let calls = 0;
  const found = await update.fetchVersion({
    repo: LINUX_REPO,
    tag: update.LATEST_TAG,
    fetchImpl: async () => { calls += 1; return { status: 404, ok: false }; },
    sleep: async () => {},
  });
  assert.equal(found, null);
  assert.equal(calls, 1);
});

test("the page recognises the shell's own wording for a missing manifest", () => {
  const hook = fs.readFileSync(path.join(ROOT, 'app/desktop/src/useUpdateCheck.ts'), 'utf8');
  const net = fs.readFileSync(path.join(ROOT, 'app/desktop/src-tauri/src/net.rs'), 'utf8');
  // net.rs, fetch_text: the message a 404 comes back as.
  assert.match(net, /format!\("\{\} answered HTTP \{\}", url, status\)/);
  const source = hook.match(/const MISSING_MANIFEST = \/(.+)\/;/);
  assert.ok(source, 'useUpdateCheck.ts defines MISSING_MANIFEST');
  const missing = new RegExp(source[1]);
  const url = update.versionUrl(LINUX_REPO, update.LATEST_TAG);
  assert.equal(`${url} answered HTTP 404`.match(missing)[1], '404');
  assert.equal(`${url} answered HTTP 403`.match(missing)[1], '403');
  // A real server fault, and a release that is there but unsigned, are not "missing".
  assert.equal(`${url} answered HTTP 502`.match(missing), null);
  assert.equal(`this release is not signed (${url}.sig answered HTTP 404); refusing to update from it`.match(missing), null);
});
