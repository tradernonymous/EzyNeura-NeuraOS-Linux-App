// Opt-in container sandbox for the coding agent's run_command (phase 12e).
//
// When the person turns on "Run agent commands in a container" (Code
// screen), an approved command does not run on this PC directly; it runs as
//
//   docker run --rm -v "<root>:/work" -w /work <image> sh -lc "<command>"
//
// or the same line with `podman` in place of `docker` (settings().binary,
// docs/MASTER_PLAN.md section 6): rootless Podman needs no daemon and no
// group membership on Linux, so it is offered as an equal choice rather
// than a Docker-only feature ported as-is.
//
// What that isolates, plainly: everything OUTSIDE the project folder -- the
// rest of the disk, installed programs, the user's home. What it does NOT: the
// project folder itself is mounted read-write at /work, so a command can still
// change or delete the project's files. The network is the container's default.
//
// QUOTING. The wrapped line goes through the host shell first (cmd on Windows,
// sh elsewhere), and inside "..." cmd still expands %VAR% while sh expands $,
// ` and \. Rather than escape for two shells and get one wrong, a command with
// any of those characters (or a line break) is not put on the line at all
// (NEURA-023): it is written, byte for byte, to .neuraos/sandbox-<id>.sh in the
// project through the confined file write, run as
//
//   docker run --rm -v "<root>:/work" -w /work <image> sh /work/.neuraos/sandbox-<id>.sh
//
// and the file is deleted afterwards. Only the container's sh reads it, so no
// host shell ever sees the characters. A NUL character is still refused (no
// shell can carry one), and so is a folder that escapes the project.
//
// Pure apart from settings() / saveSettings() (localStorage) and run(), which
// takes the runner (and the file writer) as arguments, so it is node-tested
// without a shell.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UDockerSandbox = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var KEY = 'freeai4u.docker_sandbox';
  var DEFAULT_IMAGE = 'node:22-bookworm';
  var DEFAULT_BINARY = 'docker';
  // bwrap (bubblewrap) is the lighter Linux sandbox: no daemon, no image --
  // the whole system read-only, the project read-write at /work, no network
  // (docs/MASTER_PLAN.md section 6).
  var BINARIES = ['docker', 'podman', 'bwrap'];
  /** The first run may pull the image, so it gets longer than a plain command. */
  var RUN_TIMEOUT_MS = 300000;
  var CHECK_TIMEOUT_MS = 30000;
  /** Where script-file mode writes, relative to the project. */
  var SCRIPT_DIR = '.neuraos';
  var IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/;
  var CWD_RE = /^[A-Za-z0-9._ /-]*$/;
  var ID_RE = /^[a-z0-9]{1,40}$/;
  var DOCKER_DOWN = 'Docker is not running, so nothing was run. "Run agent commands in Docker" is on in the Code '
    + 'screen: start Docker Desktop and try again, or turn that setting off to run commands on this PC.';

  var NUL = String.fromCharCode(0);
  // Characters the host shell would still interpret inside double quotes.
  var UNSAFE = [
    ['"', 'a double quote (")'],
    ['`', 'a backtick (`)'],
    ['$', 'a dollar sign ($)'],
    ['%', 'a percent sign (%)'],
    ['\\', 'a backslash (\\)'],
    ['\n', 'a line break'],
    ['\r', 'a line break'],
    [NUL, 'a NUL character'],
  ];

  var state = { ready: false };

  function storage(given) {
    if (given) return given;
    try {
      var scope = typeof globalThis !== 'undefined' ? globalThis : {};
      return scope.localStorage || null;
    } catch {
      return null;
    }
  }

  function cleanImage(image) {
    var s = typeof image === 'string' ? image.trim() : '';
    return s || DEFAULT_IMAGE;
  }

  /** Anything else stored reads as the default: Docker was the only choice
   * before Podman was added, and a value from that era should still mean
   * Docker. */
  function cleanBinary(binary) {
    var s = typeof binary === 'string' ? binary.trim() : '';
    return BINARIES.indexOf(s) >= 0 ? s : DEFAULT_BINARY;
  }

  /** { enabled, image, binary } -- off, Docker, with the default image when
   * nothing is stored. */
  function settings(given) {
    var target = storage(given);
    var out = { enabled: false, image: DEFAULT_IMAGE, binary: DEFAULT_BINARY };
    if (!target) return out;
    try {
      var parsed = JSON.parse(target.getItem(KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        out.enabled = parsed.enabled === true;
        out.image = cleanImage(parsed.image);
        out.binary = cleanBinary(parsed.binary);
      }
    } catch { /* a bad value reads as off */ }
    return out;
  }

  function saveSettings(next, given) {
    var target = storage(given);
    if (!target) return false;
    var value = {
      enabled: !!(next && next.enabled),
      image: cleanImage(next && next.image),
      binary: cleanBinary(next && next.binary),
    };
    try {
      target.setItem(KEY, JSON.stringify(value));
      state.ready = false; // a change is a reason to look at the runtime again
      return true;
    } catch {
      return false;
    }
  }

  /** Try each supported binary in turn (runner(cmd, cwd, timeoutMs)) and
   * report the first one whose daemon/socket answers -- so Settings can
   * default sensibly on a machine that only has Podman, without the person
   * having to know that Docker was ever the only option. */
  async function detectBinary(runner) {
    for (var i = 0; i < BINARIES.length; i += 1) {
      var bin = BINARIES[i];
      try {
        var probe = await runner(bin + ' version', '', CHECK_TIMEOUT_MS);
        if (isDockerUp(probe)) return bin;
      } catch { /* try the next one */ }
    }
    return null;
  }

  /** Why `text` cannot go inside "..." on the host shell, or ''. */
  function unsafeChar(text, allowBackslash) {
    var s = String(text);
    for (var i = 0; i < UNSAFE.length; i += 1) {
      if (allowBackslash && UNSAFE[i][0] === '\\') continue;
      if (s.indexOf(UNSAFE[i][0]) >= 0) return UNSAFE[i][1];
    }
    return '';
  }

  function checkImage(image) {
    var s = cleanImage(image);
    if (!IMAGE_RE.test(s)) return { ok: false, reason: 'The Docker image name "' + s + '" is not valid (letters, digits, . _ / : @ -).' };
    return { ok: true, image: s };
  }

  function checkRoot(root) {
    var s = typeof root === 'string' ? root.trim() : '';
    if (!s) return { ok: false, reason: 'Open a folder first; the Docker sandbox mounts it at /work.' };
    // Windows paths keep their backslashes (cmd leaves them alone); a network
    // path (\\server\share) is refused: Docker Desktop does not mount those.
    var bad = unsafeChar(s, true);
    if (bad) return { ok: false, reason: 'The project path contains ' + bad + ', which cannot be quoted safely for the Docker mount.' };
    if (s.indexOf('\\\\') >= 0) return { ok: false, reason: 'Network paths cannot be mounted into Docker; open a folder on a local drive.' };
    // "-v a:b" splits on ':' -- only a drive letter's colon is allowed.
    var colon = s.indexOf(':');
    if (colon >= 0 && !(colon === 1 && /^[A-Za-z]$/.test(s[0]) && s.indexOf(':', 2) < 0)) {
      return { ok: false, reason: 'The project path contains ":", which Docker would read as part of the mount.' };
    }
    return { ok: true, root: s };
  }

  /** A cwd relative to the project -> '' or 'sub/dir'; null when it is not allowed. */
  function checkCwd(cwd) {
    var s = String(cwd == null ? '' : cwd).trim().replace(/\\/g, '/');
    s = s.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (s === '.' || s === '') return '';
    if (s[0] === '/' || /^[A-Za-z]:/.test(s)) return null;
    if (!CWD_RE.test(s)) return null;
    if (s.split('/').some(function (part) { return part === '..' || part === ''; })) return null;
    return s;
  }

  /** A short lower-case id for a script file name. */
  function newId() {
    return Date.now().toString(36) + Math.floor(Math.random() * 0x100000000).toString(36);
  }

  /**
   * The script file for a command the host shell cannot carry: LF line ends
   * (a CR would reach sh as part of a word) and a trailing newline.
   */
  function scriptFor(command, id) {
    var body = String(command).replace(/\r\n?/g, '\n');
    return {
      path: SCRIPT_DIR + '/sandbox-' + id + '.sh',
      content: '# Written by NeuraOS for one sandboxed run_command; deleted when it ends.\n' + body + '\n',
    };
  }

  /**
   * wrap({ root, command, cwd, image, id }) ->
   *   { ok: true, command } -- a plain line;
   *   { ok: true, command, script: { path, content } } -- script-file mode:
   *     write `script` into the project first, run `command`, delete it;
   *   { ok: false, reason }.
   *
   * The one place the docker line is built. Nothing is ever escaped.
   */
  function wrap(opts) {
    var o = opts || {};
    var command = typeof o.command === 'string' ? o.command.trim() : '';
    if (!command) return { ok: false, reason: 'run_command needs a command.' };
    if (command.indexOf(NUL) >= 0) {
      return { ok: false, reason: 'Refused for the Docker sandbox: the command contains a NUL character, which no shell can carry.' };
    }
    var r = checkRoot(o.root);
    if (!r.ok) return r;
    var binary = cleanBinary(o.binary);
    var cwd = checkCwd(o.cwd);
    if (cwd === null) return { ok: false, reason: 'The folder to run in must be a plain path inside the project (no .., no absolute path).' };
    var workdir = cwd ? '"/work/' + cwd + '"' : '/work';
    var head;
    if (binary === 'bwrap') {
      // bubblewrap needs no image: the host's own tools, read-only, with the
      // project bound read-write at /work and no network.
      head = 'bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --bind "' + r.root + '" /work' +
        ' --chdir ' + workdir + ' --unshare-net --die-with-parent ';
    } else {
      var img = checkImage(o.image);
      if (!img.ok) return img;
      head = binary + ' run --rm -v "' + r.root + ':/work" -w ' + workdir + ' ' + img.image + ' ';
    }
    if (!unsafeChar(command, false)) {
      return { ok: true, command: head + 'sh -lc "' + command + '"' };
    }
    var id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : newId();
    var script = scriptFor(command, id);
    return { ok: true, command: head + 'sh /work/' + script.path, script: script };
  }

  /**
   * The host line that deletes a script file, run in the project folder.
   * Only [a-z0-9] in the id, so nothing in it needs quoting.
   */
  function removeLine(root, scriptPath) {
    var windows = /^[A-Za-z]:/.test(String(root || '').trim());
    return windows ? 'del /q ' + scriptPath.replace(/\//g, '\\') : 'rm -f ' + scriptPath;
  }

  /** Whether a `docker version` result means the daemon answered. */
  function isDockerUp(result) {
    return !!result && result.exitCode === 0 && !result.timedOut;
  }

  /**
   * run({ root, command, cwd, settings, files, id }, runner) -> the runner's result.
   *
   * runner(command, cwd, timeoutMs) runs a line in the project folder (the
   * screens pass runLocal). With the sandbox off this is a straight call.
   * With it on, Docker is checked once per session (a failure is not cached,
   * so starting Docker Desktop and retrying works) and the wrapped line runs.
   *
   * Script-file mode needs files.write(path, content) -- the confined project
   * write (writeLocalFile). The file is deleted afterwards through the runner
   * (del /q or rm -f on the host), whether the run succeeded or not.
   */
  async function run(opts, runner) {
    var o = opts || {};
    var s = o.settings || settings();
    if (!s.enabled) return runner(o.command, o.cwd || '', o.timeoutMs);
    var binary = cleanBinary(s.binary);
    var wrapped = wrap({ root: o.root, command: o.command, cwd: o.cwd, image: s.image, binary: binary, id: o.id });
    if (!wrapped.ok) throw new Error(wrapped.reason);
    if (wrapped.script && !(o.files && typeof o.files.write === 'function')) {
      throw new Error('Refused for the sandbox: this command needs a script file (it has characters the shell '
        + 'on this PC would change), and this screen cannot write one.');
    }
    if (!state.ready) {
      var probe;
      try {
        probe = await runner(binary + ' version', '', CHECK_TIMEOUT_MS);
      } catch (e) {
        probe = { exitCode: null, timedOut: false, stderr: String((e && e.message) || e) };
      }
      if (!isDockerUp(probe)) {
        var detail = String((probe && probe.stderr) || '').trim().split('\n')[0];
        throw new Error(DOCKER_DOWN.replace('Docker', binary === 'podman' ? 'Podman' : 'Docker')
          + (detail ? ' (' + binary + ' said: ' + detail.slice(0, 200) + ')' : ''));
      }
      state.ready = true;
    }
    if (!wrapped.script) return runner(wrapped.command, '', RUN_TIMEOUT_MS);
    await o.files.write(wrapped.script.path, wrapped.script.content);
    try {
      return await runner(wrapped.command, '', RUN_TIMEOUT_MS);
    } finally {
      try {
        await runner(removeLine(o.root, wrapped.script.path), '', CHECK_TIMEOUT_MS);
      } catch { /* a leftover script in .neuraos is harmless; the run's own result matters */ }
    }
  }

  /** Forget the Docker check (tests; the settings toggle does this too). */
  function resetCheck() {
    state.ready = false;
  }

  return {
    KEY: KEY,
    DEFAULT_IMAGE: DEFAULT_IMAGE,
    DEFAULT_BINARY: DEFAULT_BINARY,
    BINARIES: BINARIES,
    RUN_TIMEOUT_MS: RUN_TIMEOUT_MS,
    DOCKER_DOWN: DOCKER_DOWN,
    SCRIPT_DIR: SCRIPT_DIR,
    settings: settings,
    saveSettings: saveSettings,
    checkImage: checkImage,
    checkCwd: checkCwd,
    wrap: wrap,
    removeLine: removeLine,
    isDockerUp: isDockerUp,
    detectBinary: detectBinary,
    run: run,
    resetCheck: resetCheck,
  };
});
