// One place for the handful of strings that name something Windows-specific
// (a Registry-backed store, a keyboard shortcut, a file-manager verb) so the
// Linux build says the true, local name instead (W11, docs/MASTER_PLAN.md
// section 2). Anything that is actually cross-platform behaviour stays out
// of here -- this is copy, not a platform abstraction layer.
//
// `navigator.platform` is what the embedded webview reports for its own
// process, which is exactly what we want (which OS is this window drawn on),
// not what a remote server might guess from a user agent string.
/** Where the Linux port publishes its releases (the Windows app reads upstream's). */
export const LINUX_RELEASES_REPO = 'tradernonymous/EzyNeura-NeuraOS-Linux-App';

export function isLinux(): boolean {
  try {
    return /linux/i.test(navigator.platform || navigator.userAgent || '');
  } catch {
    return false;
  }
}

/** Where a secret this app stores actually lives, in the user's own words. */
export function credentialStoreName(): string {
  return isLinux() ? 'your login keyring' : 'Windows Credential Manager';
}

/** The built-in dictation shortcut this OS offers as a fallback, if any. */
export function builtInDictationHint(): string {
  return isLinux()
    ? 'NeuraOS Voice Type (Settings → Dictation) works everywhere too.'
    : "Windows' own Win+H works everywhere too.";
}

export function builtInDictationSentence(): string {
  return isLinux()
    ? 'NeuraOS Voice Type also types what you say into any app once it is set up (Settings → Dictation).'
    : 'Windows can also type what you say — press Win+H.';
}

/** The file manager this desktop uses, for "open in" / "browse to" copy. */
export function fileManagerName(): string {
  return isLinux() ? 'Nemo' : 'Explorer';
}

/**
 * Which llama.cpp release asset to download and what to pick from it. The
 * Linux zips carry the server under build/bin with its .so files beside it;
 * the Vulkan build is the GPU one for every vendor (AMD, Intel, NVIDIA).
 */
export function llamaServerDownloadHint(expectedName: string): string {
  return isLinux()
    ? `Download the Linux release (llama-…-bin-ubuntu-vulkan-x64.zip for a GPU, …-ubuntu-x64.zip for CPU only), ` +
      `unzip it, then choose build/bin/${expectedName} — the app copies it and its .so files to its own folder and runs it from there.`
    : 'Download the release for Windows, unzip it, then choose the file — the app copies it to its own folder and runs it from there.';
}

/** The whisper.cpp CLI's file name on this OS. */
export function whisperBinaryName(): string {
  return isLinux() ? 'whisper-cli' : 'whisper-cli.exe';
}

/** A placeholder path in this OS's own style, for a command/path input. */
export function examplePathPlaceholder(): string {
  return isLinux() ? '/usr/bin/server' : 'C:\\…\\server.exe';
}
