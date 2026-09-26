#!/usr/bin/env node
// D1 (upgrade plan): "Secrets never travel." A Tauri app's frontend assets
// are trivially unpacked — the .deb, the AppImage, or just the JS in dist —
// so anything secret that reached a build is public the moment the build is.
// This is the gate that says so in CI, over what was actually built:
//
//   --dist <dir>       the frontend output (always present after npm run build)
//   --deb <file|glob>  the .deb, extracted with dpkg-deb (its data is xz)
//   --appimage <file>  the AppImage, unpacked with --appimage-extract
//
// Missing targets are skipped with a note (a bundle:false run has no
// bundles); a hit fails the job with file and PATTERN name — never the
// matched text, because a log line is also a place secrets travel.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Named patterns: specific enough that a false positive is a bug worth
// fixing, broad enough to catch a real key pasted into a file. Public-key
// material (an ssh public key's AAAA…, minisign) is deliberately NOT matched: only
// the private halves are secrets.
// The token patterns start at a word boundary (no letter/underscore just
// before the prefix): the compiled binary is full of mangled Rust symbols,
// and a crate named e.g. phf_shared mangles to ..._10phf_shared4hash… —
// without the boundary that reads as an "hf_" token and fails the gate on
// a name, not a secret. A real token is always delimited: quote, space, =.
const BOUND = '(?<![A-Za-z0-9_])';
const PATTERNS = [
  { name: 'Hugging Face token', re: new RegExp(BOUND + 'hf_[A-Za-z0-9]{20,}', 'g') },
  { name: 'GitHub token', re: new RegExp(BOUND + 'gh[pousr]_[A-Za-z0-9]{36,}|' + BOUND + 'github_pat_[A-Za-z0-9_]{20,}', 'g') },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'OpenAI-style key', re: /sk-[A-Za-z0-9]{20}T2BlbkFJ[A-Za-z0-9]{20}/g },
  { name: 'Anthropic-style key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'private key block', re: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g },
  { name: 'assigned secret', re: /\b(?:api[_-]?key|apikey|secret|password|passwd|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9/+_.-]{32,}["']/gi },
];

// Files whose content cannot contain a secret in text form (and are huge).
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.zip', '.gz', '.xz', '.7z']);
const MAX_FILE = 64 * 1024 * 1024;

// Third-party shared libraries: the AppImage bundles the distro's runtime
// (libgnutls, libgio, …), which is not ours to gate — and which legitimately
// carries its own key material fixtures (GnuTLS compiles PEM test vectors
// into libgnutls). Everything that is ours — the app binary, the frontend,
// our config — is still scanned in full; the binary holds no .so suffix.
const isThirdPartyLib = (name) => /\.so(\.|$)/.test(name);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.size <= MAX_FILE && !SKIP_EXT.has(path.extname(name).toLowerCase()) && !isThirdPartyLib(name)) out.push(full);
  }
  return out;
}

/** Every pattern hit in one file, reported as { file, pattern } — never the match. */
function scanFile(file) {
  const hits = [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return hits;
  }
  // A binary with a stray NUL still holds ASCII secrets; utf8 keeps them.
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    if (p.re.test(text)) hits.push({ file, pattern: p.name });
  }
  return hits;
}

function globFiles(pattern) {
  // The one glob this needs: a trailing * in the last segment (CI passes
  // exact bundle paths with one star in the file name).
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!dir || !existsSync(dir)) return [];
  const rx = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  return readdirSync(dir).filter((n) => rx.test(n)).map((n) => path.join(dir, n));
}

function expand(target) {
  if (target.includes('*')) return globFiles(target);
  return existsSync(target) ? [target] : [];
}

/** A .deb: its data.tar is compressed, so dpkg-deb must unpack it first. */
function extractDeb(deb, into) {
  try {
    execFileSync('dpkg-deb', ['-x', deb, into], { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error(`note: could not extract ${deb}: ${(e && e.message) || e}`);
    return false;
  }
}

/** An AppImage: --appimage-extract needs no FUSE, only the ability to exec.
 *  The path must be absolute: with a relative one and cwd set, exec
 *  resolves it against `into`, where the file obviously is not (ENOENT). */
function extractAppImage(image, into) {
  try {
    execFileSync(path.resolve(image), ['--appimage-extract'], { cwd: into, stdio: 'pipe' });
    return existsSync(path.join(into, 'squashfs-root'));
  } catch (e) {
    console.error(`note: could not unpack ${image}: ${(e && e.message) || e}`);
    return false;
  }
}

function main(argv) {
  const args = { dist: '', deb: '', appimage: '' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--dist') args.dist = argv[++i] || '';
    else if (argv[i] === '--deb') args.deb = argv[++i] || '';
    else if (argv[i] === '--appimage') args.appimage = argv[++i] || '';
  }

  const hits = [];
  let scanned = 0;
  const scanDir = (dir) => {
    for (const file of walk(dir)) {
      scanned += 1;
      hits.push(...scanFile(file));
    }
  };

  if (args.dist) {
    if (existsSync(args.dist)) scanDir(args.dist);
    else console.error(`note: ${args.dist} is not there (run npm run build first)`);
  } else {
    console.error('note: nothing to scan: pass --dist at minimum');
  }

  const temp = mkdtempSync(path.join(tmpdir(), 'secret-scan-'));
  try {
    for (const deb of expand(args.deb)) {
      const into = path.join(temp, path.basename(deb, '.deb'));
      if (extractDeb(deb, into)) scanDir(into);
    }
    for (const image of expand(args.appimage)) {
      const into = path.join(temp, path.basename(image, '.AppImage'));
      mkdirSync(into, { recursive: true });
      if (extractAppImage(image, into)) scanDir(path.join(into, 'squashfs-root'));
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  if (hits.length) {
    console.error(`Secrets found in the built assets (${hits.length}):`);
    for (const h of hits) console.error(`  ${h.file} — ${h.pattern}`);
    console.error('Nothing secret may ship in dist, the .deb or the AppImage. Remove it and rotate whatever it was.');
    process.exit(1);
  }
  console.log(`secret scan: ${scanned} file(s), no tokens or keys found`);
}

main(process.argv);
