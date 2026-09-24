// The one place that talks to the Rust shell.
//
// Under Tauri the runtime injects __TAURI_INTERNALS__.invoke; in a plain browser
// (vite dev, or the web build) there is no shell at all. Every caller asks
// hasShell() first, so a screen degrades to a browser behaviour instead of
// throwing — and no other file has to know how the bridge is spelled.

import './chat-crypto.js';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function bridge(): Invoke | null {
  const w = window as any;
  const internals = w.__TAURI_INTERNALS__;
  if (internals && typeof internals.invoke === 'function') return internals.invoke.bind(internals);
  return null;
}

export function hasShell(): boolean {
  return bridge() !== null;
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = bridge();
  if (!invoke) throw new Error('this build has no desktop shell');
  return (await invoke(command, args ?? {})) as T;
}

export interface RemoteResponse {
  status: number;
  body: string;
}

export async function remoteGet(url: string): Promise<RemoteResponse> {
  return call<RemoteResponse>('remote_get', { url });
}

export interface DownloadResult {
  path: string;
  name: string;
  bytes: number;
  sha256: string;
  /** True only when the digest was checked against a published one. */
  verified: boolean;
}

export async function downloadVerified(args: {
  url: string;
  name: string;
  sha256: string;
}): Promise<DownloadResult> {
  return call<DownloadResult>('remote_download', {
    url: args.url,
    name: args.name,
    sha256: args.sha256,
  });
}

export async function runInstaller(path: string): Promise<void> {
  await call('run_installer', { path });
}

/**
 * How this copy was installed (net.rs install_kind), so an update uses the
 * same installer type. Outside the shell, or when the shell cannot say, the
 * answer is 'portable': the one kind whose update never runs anything.
 */
export async function installKind(): Promise<'nsis' | 'msi' | 'portable' | 'deb' | 'appimage'> {
  if (!hasShell()) return 'portable';
  try {
    const kind = await call<string>('install_kind');
    return kind === 'nsis' || kind === 'msi' || kind === 'deb' || kind === 'appimage' ? kind : 'portable';
  } catch {
    return 'portable';
  }
}

export interface DiagnosticsFacts {
  version: string;
  os: string;
  arch: string;
  webview2: string;
  log_path: string;
  log_bytes: number;
  log_tail: string;
  data_dir: string;
  cache_dir: string;
}

export async function diagnosticsFacts(): Promise<DiagnosticsFacts> {
  return call<DiagnosticsFacts>('diagnostics');
}

// ---- the local folder ----------------------------------------------------
//
// Real paths on this machine, confined to one folder by the shell (src-tauri/
// src/local.rs). The frontend's copy of those rules is src/local-fs.js, and the
// two lists are asserted identical in test/desktop-local.test.js.

export interface LocalEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  ext: string;
}

export interface LocalListing {
  path: string;
  absolute: string;
  entries: LocalEntry[];
  capped: boolean;
}

export interface LocalFile {
  path: string;
  absolute: string;
  bytes: number;
  binary: boolean;
  truncated: boolean;
  text: string;
}

export interface LocalRunResult {
  runId: string;
  command: string;
  cwd: string;
  absoluteCwd: string;
  /** True when the run happened in the shell's throwaway folder. */
  sandbox?: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface LocalRunChunk {
  runId: string;
  stream: 'stdout' | 'stderr';
  text?: string;
  done?: boolean;
}

/** The native folder picker; null when it is cancelled. */
export async function pickFolder(): Promise<string | null> {
  return (await call<string | null>('local_pick_folder')) ?? null;
}

export async function listLocalDir(root: string, path = ''): Promise<LocalListing> {
  return call<LocalListing>('local_list_dir', { root, path });
}

export async function readLocalFile(root: string, path: string): Promise<LocalFile> {
  return call<LocalFile>('local_read_file', { root, path });
}

export async function writeLocalFile(root: string, path: string, content: string): Promise<{ path: string; bytes: number }> {
  return call('local_write_file', { root, path, content });
}

export async function editLocalFile(args: {
  root: string;
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}): Promise<{ path: string; replaced: number; bytes: number }> {
  return call('local_edit_file', {
    root: args.root,
    path: args.path,
    oldText: args.oldText,
    newText: args.newText,
    replaceAll: args.replaceAll ?? false,
  });
}

export async function runLocal(args: {
  root: string;
  runId: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  approveRisky?: boolean;
  /**
   * Run in a fresh, empty folder the shell deletes afterwards instead of in
   * the open project. Not a security boundary -- the command still runs as the
   * user -- but nothing it writes lands in the folder being worked on.
   */
  sandbox?: boolean;
}): Promise<LocalRunResult> {
  return call<LocalRunResult>('local_run', {
    root: args.root,
    runId: args.runId,
    command: args.command,
    cwd: args.cwd ?? '',
    timeoutMs: args.timeoutMs,
    approveRisky: args.approveRisky ?? false,
    sandbox: args.sandbox ?? false,
  });
}

/**
 * Live output from a running local command.
 *
 * This goes through Tauri's own event plugin (`plugin:event|listen`), which is
 * the same call @tauri-apps/api makes -- the app deliberately carries no
 * frontend dependency on it. Nothing depends on it for CORRECTNESS: runLocal
 * returns the settled output either way, so if this subscription is ever
 * refused the terminal shows the whole result when the command finishes
 * instead of nothing at all.
 */
// ---- the local model server (llama.cpp) ---------------------------------
//
// The binary is the user's: this app neither ships one nor downloads one
// behind their back. `find` says where it looks, `pick` takes the file they
// chose, and `openReleases` opens the page to get it from.

export interface LocalServerFacts {
  found: boolean;
  path: string;
  source: string;
  expected_name: string;
  releases_url: string;
  dir: string;
}

export interface LocalModelStatus {
  state: 'stopped' | 'starting' | 'ready' | 'error';
  repo: string;
  quant: string;
  /** The file it was started from, when it was a file and not a -hf spec. */
  file: string;
  port: number;
  /** The bearer token the server was started with; every request must carry it. */
  api_key: string;
  pid: number;
  uptime_ms: number;
  base_url: string;
  detail: string;
}

export async function localServerFind(): Promise<LocalServerFacts> {
  return call<LocalServerFacts>('local_server_find');
}

/** The native picker; resolves with the source path, or null if cancelled. */
export async function localServerPick(): Promise<string | null> {
  return (await call<string | null>('local_server_pick')) ?? null;
}

export async function localServerUse(path: string): Promise<{ path: string; bytes: number }> {
  return call('local_server_use', { path });
}

/** Opens the llama.cpp release page in the user's browser. */
export async function localOpenReleases(): Promise<void> {
  await call('local_open_releases');
}

export async function localModelStart(args: {
  repo: string;
  quant?: string;
  /** A file in the models folder, or an absolute path the scan found. Wins over repo. */
  file?: string;
  port?: number;
  ctx?: number;
  gpuLayers?: number;
  threads?: number;
}): Promise<LocalModelStatus> {
  return call<LocalModelStatus>('local_model_start', args);
}

export async function localModelStatus(): Promise<LocalModelStatus> {
  return call<LocalModelStatus>('local_model_status');
}

export async function localModelStop(): Promise<{ stopped: boolean }> {
  return call('local_model_stop');
}

// ---- the bundled engine (Local mode, docs/MASTER_PLAN.md section 5) ------

export interface EngineNode {
  found: boolean;
  ok: boolean;
  path?: string;
  major?: number;
  reason?: string;
}

export interface EngineStatus {
  running: boolean;
  port?: number;
  url?: string;
  already_running?: boolean;
}

/** Whether this machine has a Node new enough to run the bundled engine. */
export async function engineFindNode(): Promise<EngineNode> {
  return call<EngineNode>('engine_find_node');
}

/** Starts the bundled engine (or reports the one already running) and
 * waits for it to come up before resolving. Throws with a message fit to
 * show directly, same as every other local-server start in this app. */
export async function engineStart(): Promise<EngineStatus> {
  return call<EngineStatus>('engine_start');
}

export async function engineStop(): Promise<EngineStatus> {
  return call<EngineStatus>('engine_stop');
}

export async function engineStatus(): Promise<EngineStatus> {
  return call<EngineStatus>('engine_status');
}

const ENGINE_MODE_KEY = 'freeai4u.engine_mode';

/** Whether the person last connected by running the engine on this
 * machine, so App.tsx can start it again at boot instead of waiting for
 * another click every launch. Set by ConnectionCard: true on a successful
 * "Run the engine on this machine", false on a manual "Test + save" of any
 * address (an explicit choice of Cloud wins over a remembered Local one). */
export function preferLocalEngine(): boolean {
  try {
    return localStorage.getItem(ENGINE_MODE_KEY) === 'local';
  } catch {
    return false;
  }
}

export function setPreferLocalEngine(local: boolean): void {
  try {
    if (local) localStorage.setItem(ENGINE_MODE_KEY, 'local');
    else localStorage.removeItem(ENGINE_MODE_KEY);
  } catch { /* the preference just won't be remembered this session */ }
}

export async function onLocalRun(handler: (chunk: LocalRunChunk) => void): Promise<() => void> {
  return subscribe<LocalRunChunk>('local-run', handler);
}

// ---- the real terminal (NEURA-058) ---------------------------------------
//
// A PTY, not a command runner: one long-lived shell per session id, bytes in
// both directions, and a size the shell is told about. The gate that local_run
// applies before spawning lives on `ptyRun` here -- see src-tauri/src/pty.rs
// for why the user's own keystrokes (`ptyWrite`) are NOT gated and anything an
// agent sends still is.

export interface PtySession {
  id: string;
  /** The shell that was started (COMSPEC / SHELL). */
  shell: string;
  pid: number | null;
  /** Where it started, relative to the open folder. */
  cwd: string;
  absoluteCwd: string;
  cols: number;
  rows: number;
}

export interface PtyOutput {
  id: string;
  /** base64: a pty splits UTF-8 wherever the read ended, so bytes travel as bytes. */
  data: string;
  /** True when the shell outran the buffer and the OLDEST bytes were dropped. */
  dropped?: boolean;
}

export interface PtyExit {
  id: string;
  exitCode: number | null;
}

/** Open a terminal in the open folder (or a folder inside it). */
export async function ptyOpen(args: {
  id: string;
  root: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}): Promise<PtySession> {
  return call<PtySession>('pty_open', {
    id: args.id,
    root: args.root,
    cwd: args.cwd ?? '',
    cols: args.cols,
    rows: args.rows,
  });
}

/**
 * Keystrokes. This is the user's own shell and it is deliberately NOT gated --
 * only xterm's onData handler may call it. A command from anything that is not
 * a human goes through ptyRun, which still asks local.rs's risk_of().
 */
export async function ptyWrite(id: string, data: string): Promise<void> {
  await call('pty_write', { id, data });
}

/**
 * A command from the agent, a recipe or a button. The shell refuses a
 * destructive one unless `approveRisky` says a human said yes -- the same rule,
 * the same wording, as runLocal.
 */
export async function ptyRun(
  id: string,
  command: string,
  approveRisky = false,
): Promise<{ id: string; command: string; sent: boolean }> {
  return call('pty_run', { id, command, approveRisky });
}

export async function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  await call('pty_resize', { id, cols, rows });
}

export async function ptyClose(id: string): Promise<{ closed: boolean }> {
  return call<{ closed: boolean }>('pty_close', { id });
}

export async function ptyList(): Promise<string[]> {
  return call<string[]>('pty_list');
}

export function onPtyOutput(handler: (chunk: PtyOutput) => void): Promise<() => void> {
  return subscribe<PtyOutput>('pty-output', handler);
}

export function onPtyExit(handler: (end: PtyExit) => void): Promise<() => void> {
  return subscribe<PtyExit>('pty-exit', handler);
}

/** The bytes behind a PtyOutput. xterm.js takes a Uint8Array and decodes it
 *  itself, across chunks, which is the point of not sending a String. */
export function ptyBytes(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return String((input as Request).url || '');
}

// A fetch-shaped wrapper around remote_get, so update.js's retry/backoff logic
// runs unchanged over the shell instead of the webview. Typed to match `fetch`
// so it can be passed wherever a fetch implementation is expected.
export async function shellFetch(input: RequestInfo | URL): Promise<Response> {
  const res = await remoteGet(urlOf(input));
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => JSON.parse(res.body),
    text: async () => res.body,
  } as unknown as Response;
}

// ---- opening a page in the user's browser --------------------------------
//
// The shell refuses anything that is not https on a short host list (net.rs
// OPEN_HOSTS): this is for sign-in pages and release pages, not a launcher.
export async function openUrl(url: string): Promise<void> {
  await call('open_url', { url });
}

// ---- the weights themselves ---------------------------------------------
//
// Downloaded by the shell into <app data>/models with progress events
// (`local-download`), resumed from a .part if they stopped, and listed from
// there -- or found where another tool (Unsloth Studio, the Hugging Face
// cache, LM Studio) already put them.

export interface LocalModelFile {
  file: string;
  path: string;
  bytes: number;
  /** A .part a download left behind: resumable, not runnable. */
  partial: boolean;
}

export interface LocalDownloadProgress {
  repo: string;
  file: string;
  received: number;
  total: number;
  done: boolean;
  cancelled: boolean;
  error: string;
  path: string;
}

/** What a download feeds: llama-server (the default), sd-server or whisper.cpp. */
export type DownloadKind = 'text' | 'image' | 'voice';

export async function localModelDownload(args: {
  repo: string;
  file: string;
  token?: string;
  kind?: DownloadKind;
  /** The folder an image component set shares under sd-models. */
  set?: string;
}): Promise<{
  path: string;
  bytes: number;
  resumed?: boolean;
  already?: boolean;
  cancelled?: boolean;
}> {
  return call('local_model_download', {
    repo: args.repo,
    file: args.file,
    token: args.token ?? null,
    kind: args.kind ?? null,
    set: args.set ?? null,
  });
}

export async function localModelDownloadCancel(): Promise<{ cancelling: boolean; file: string }> {
  return call('local_model_download_cancel');
}

export async function localModelsList(): Promise<{ dir: string; files: LocalModelFile[] }> {
  return call('local_models_list');
}

export async function localModelDelete(file: string, opts?: { kind?: DownloadKind; set?: string }): Promise<{ removed: number }> {
  return call('local_model_delete', { file, kind: opts?.kind ?? null, set: opts?.set ?? null });
}

export async function localModelsScan(dirs?: string[]): Promise<{ dirs: string[]; files: LocalModelFile[] }> {
  return call('local_models_scan', { dirs: dirs ?? [] });
}

/** Subscribe to a shell event through Tauri's event plugin (see onLocalRun). */
async function subscribe<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const w = window as any;
  const internals = w.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== 'function' || typeof internals.transformCallback !== 'function') {
    return () => {};
  }
  // Tauri 2 hands a listener the whole Event ({ event, id, payload }), not the
  // payload: every subscriber here used to receive that wrapper, so Ollama
  // chunks, download progress, deep links and the GitHub "finished" signal
  // arrived as the wrong shape. Either shape is accepted.
  const id = internals.transformCallback((message: any) => {
    const wrapped = message && typeof message === 'object' && 'payload' in message && 'event' in message;
    handler((wrapped ? message.payload : message) as T);
  }, false);
  let eventId: unknown;
  try {
    // listen answers with the id unlisten wants -- not the callback's id.
    eventId = await call('plugin:event|listen', { event, target: { kind: 'Any' }, handler: id });
  } catch {
    return () => {};
  }
  return () => {
    call('plugin:event|unlisten', { event, eventId }).catch(() => {});
  };
}

// Each kind reports on its own event (models.rs Kind::event), so two cards on
// one screen never draw each other's bar.
export function onLocalDownload(handler: (progress: LocalDownloadProgress) => void, kind: DownloadKind = 'text'): Promise<() => void> {
  const event = kind === 'image' ? 'image-download' : kind === 'voice' ? 'voice-download' : 'local-download';
  return subscribe<LocalDownloadProgress>(event, handler);
}

/** neuraos:// links handed over by the shell, as a list of URLs. */
/**
 * The release manifest, signature-checked in the shell when this build carries
 * an update key (5.9). `signed` says whether it was; a bad or missing
 * signature on a keyed build is an error, never a quiet fallback.
 */
export async function updateManifest(url: string): Promise<{ body: string; signed: boolean }> {
  return call<{ body: string; signed: boolean }>('update_manifest', { url });
}

/** The .gguf file or folder this launch was opened with, once (5.4). */
export async function launchTakePath(): Promise<string | null> {
  if (!hasShell()) return null;
  return call<string | null>('launch_take_path');
}

/** A second launch ("Open with", Explorer's "Open in NeuraOS") handed us a path. */
export function onOpenPath(handler: (path: string) => void): Promise<() => void> {
  return subscribe<string>('open-path', (payload) => handler(String(payload || '')));
}

export function onDeepLink(handler: (urls: string[]) => void): Promise<() => void> {
  return subscribe<string[]>('deep-link', (payload) => handler(Array.isArray(payload) ? payload : [String(payload)]));
}

// ---- secrets ---------------------------------------------------------------
//
// The OS credential store (secrets.rs). Keys are the app's own short names;
// a value is whatever string the caller stores (the HF token JSON).

export async function secretGet(key: string): Promise<string | null> {
  return (await call<string | null>('secret_get', { key })) ?? null;
}

export async function secretSet(key: string, value: string): Promise<void> {
  await call('secret_set', { key, value });
}

export async function secretDelete(key: string): Promise<void> {
  await call('secret_delete', { key });
}

// ---- Puter sign-in ----------------------------------------------------------
//
// Puter's sign-in page renders nothing without a referrer, and a URL launched
// by the OS has none. The shell serves a one-line redirect page on 127.0.0.1
// and opens that, so the browser arrives at Puter from a page (net.rs).
export async function puterSigninOpen(url: string): Promise<void> {
  await call('puter_signin_open', { url });
}

// ---- Ollama, and streaming from a model server on this machine ------------------
//
// All of it goes through the shell (ollama.rs): Ollama refuses a Tauri
// window's origin, and the shell checks that every address is loopback.

export async function ollamaTags(base?: string): Promise<any> {
  return call('ollama_tags', { base: base ?? null });
}

export async function ollamaPs(base?: string): Promise<any> {
  return call('ollama_ps', { base: base ?? null });
}

export async function ollamaEject(base: string, model: string): Promise<void> {
  await call('ollama_eject', { base: base || null, model });
}

export async function ollamaStart(base?: string): Promise<{ started: boolean; running: boolean }> {
  return call('ollama_start', { base: base ?? null });
}

interface ShellChatEvent {
  id: string;
  status?: number;
  chunk?: string;
  done?: boolean;
  cancelled?: boolean;
  error?: string;
}

/**
 * POST a JSON body to a model server on this machine and receive the reply a
 * chunk at a time. Resolves when the body ends; rejects with AbortError when
 * `signal` fires (the shell is told to stop reading too).
 */
export async function shellPostStream(
  args: { url: string; body: string; apiKey?: string },
  onChunk: (text: string) => void,
  onStatus?: (status: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let settle: (error?: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve());
  });
  const stop = await subscribe<ShellChatEvent>('shell-chat', (event) => {
    if (!event || event.id !== id) return;
    if (typeof event.status === 'number') onStatus?.(event.status);
    if (typeof event.chunk === 'string') onChunk(event.chunk);
    if (event.error) settle(new Error(event.error));
    else if (event.done) settle();
  });
  const onAbort = () => {
    call('shell_chat_cancel', { id }).catch(() => {});
    const error = new Error('aborted');
    error.name = 'AbortError';
    settle(error);
  };
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort);
  // The command resolves when the stream ends, but events can still be in
  // flight at that moment: the `done` event is what finishes this, and a
  // command failure (refused address, nothing listening) is an error.
  call('shell_chat_stream', { id, url: args.url, body: args.body, apiKey: args.apiKey ?? null })
    .catch((e: unknown) => settle(e instanceof Error ? e : new Error(String(e))));
  try {
    await finished;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    stop();
  }
}

// ---- the user's own endpoint (NEURA-054) ------------------------------------
//
// Same events as shellPostStream, different command -- and one difference that
// is the whole point: there is no `apiKey` argument. The page sends the NAME of
// the credential-store entry (`byok.<id>`); the shell reads the value and sets
// the Authorization header itself (src-tauri/src/byok.rs), so a key never
// exists in the webview to be leaked, logged or persisted. The two functions
// are kept apart rather than merged because their address rules differ:
// shell_chat_stream is loopback-only, byok_chat_stream is https-or-loopback.

export async function byokStream(
  args: { secret: string; base: string; body: string },
  onChunk: (text: string) => void,
  onStatus?: (status: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let settle: (error?: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve());
  });
  const stop = await subscribe<ShellChatEvent>('shell-chat', (event) => {
    if (!event || event.id !== id) return;
    if (typeof event.status === 'number') onStatus?.(event.status);
    if (typeof event.chunk === 'string') onChunk(event.chunk);
    if (event.error) settle(new Error(event.error));
    else if (event.done) settle();
  });
  const onAbort = () => {
    call('byok_chat_cancel', { id }).catch(() => {});
    const error = new Error('aborted');
    error.name = 'AbortError';
    settle(error);
  };
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort);
  call('byok_chat_stream', { id, secret: args.secret, base: args.base, body: args.body })
    .catch((e: unknown) => settle(e instanceof Error ? e : new Error(String(e))));
  try {
    await finished;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    stop();
  }
}

// ---- local MCP servers (stdio) ----------------------------------------------
//
// The shell spawns the program directly (no shell in between), does the MCP
// handshake, and keeps it running under the id until Stop or Quit (mcp.rs).
// A failure's message may end in "\n\nstderr:\n<tail>" -- tools.splitStderr
// separates the two.

export interface McpStdioStarted {
  id: string;
  pid: number;
  protocolVersion: string | null;
  serverInfo: { name?: string; version?: string } | null;
  capabilities: Record<string, any> | null;
}

export async function mcpStdioStart(args: {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}): Promise<McpStdioStarted> {
  return call<McpStdioStarted>('mcp_stdio_start', {
    id: args.id,
    command: args.command,
    args: args.args ?? [],
    env: args.env ?? {},
    cwd: args.cwd || null,
  });
}

/** One JSON-RPC request to a running server: its `result`, or a throw with its error. */
export async function mcpStdioRequest<T = any>(id: string, method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  return call<T>('mcp_stdio_request', { id, method, params: params ?? null, timeoutMs: timeoutMs ?? null });
}

export async function mcpStdioStop(id: string): Promise<{ stopped: boolean }> {
  return call('mcp_stdio_stop', { id });
}

/** The ids running now; none without a shell. */
export async function mcpStdioList(): Promise<string[]> {
  if (!hasShell()) return [];
  return (await call<string[]>('mcp_stdio_list')) ?? [];
}

// ---- connecting an account in a window of this app --------------------------
//
// The engine keys a GitHub connection to its session cookie. The system browser
// has a different cookie jar, so the sign-in happens in a second window of this
// app (same cookies), which the shell closes when GitHub hands back (net.rs).
export async function authWindowOpen(url: string): Promise<void> {
  await call('auth_window_open', { url });
}

/** The sign-in window closed; `landed` is where the engine sent it (path + query). */
export function onConnectFinished(handler: (landed: string) => void): Promise<() => void> {
  return subscribe<string>('connect-finished', (landed) => handler(String(landed || '')));
}

// ---- Phase 5: Quick window and notifications ------------------------------
//
// quick.rs. The Quick window is the same frontend in a window labelled
// "quick"; `?quick=1` lets a plain browser (vite dev) show it too.

/** Whether this frontend is running in the Quick window. */
export function isQuickWindow(): boolean {
  try {
    const label = (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    if (label) return label === 'quick';
  } catch { /* not under the shell */ }
  return new URLSearchParams(window.location.search).get('quick') === '1';
}

/** Take a new global hotkey for the Quick window ("alt+space", "ctrl+shift+k"). */
export async function quickHotkeySet(combo: string): Promise<string> {
  return call<string>('quick_hotkey_set', { combo });
}

export async function quickHide(): Promise<void> {
  if (hasShell()) await call('quick_hide');
}

/** Remap the selection hotkey (select text anywhere, press it, ask about it). */
export async function selectionHotkeySet(combo: string): Promise<string> {
  return call<string>('selection_hotkey_set', { combo });
}

/** The text the selection hotkey captured, once; '' when nothing was selected. */
export async function quickTakeSelection(): Promise<string | null> {
  if (!hasShell()) return null;
  return call<string | null>('quick_take_selection');
}

/** The selection hotkey fired while the Quick window was already open. */
export function onQuickSelection(handler: () => void): Promise<() => void> {
  return subscribe<unknown>('quick-selection', () => handler());
}

export async function mainShow(): Promise<void> {
  if (hasShell()) await call('main_show');
}

/** A system notification when the main window is not in front; false when not shown. */
export async function notifyUser(title: string, body: string): Promise<boolean> {
  if (!hasShell()) return false;
  try {
    return await call<boolean>('notify', { title, body });
  } catch {
    return false;
  }
}

/**
 * A local GGUF's header (trained context, layers, attention shape), read by
 * the shell without loading the model. Part 1 is read for a split set.
 */
export async function ggufInfo(path: string): Promise<import('./run-settings.js').GgufInfo> {
  return call<import('./run-settings.js').GgufInfo>('gguf_info', { path });
}

// ---- one-click Hugging Face sign-in (hf_oauth.rs) --------------------------

export interface HfOAuthConfig {
  /** Compiled in from NEURAOS_HF_CLIENT_ID; null when the build had none. */
  client_id: string | null;
  redirect_uri: string;
}

export async function hfOAuthConfig(): Promise<HfOAuthConfig | null> {
  if (!hasShell()) return null;
  try {
    return await call<HfOAuthConfig>('hf_oauth_config');
  } catch {
    return null;
  }
}

/** Wait on 127.0.0.1:47823/hf/callback; resolves with the code once the state matches. */
export async function hfOAuthListen(state: string, timeoutSecs: number): Promise<string> {
  return call<string>('hf_oauth_listen', { state, timeoutSecs });
}

export async function hfOAuthCancel(): Promise<void> {
  if (hasShell()) await call('hf_oauth_cancel');
}

export async function hfOAuthExchange(code: string, verifier: string, clientId: string, redirectUri: string): Promise<any> {
  return call<any>('hf_oauth_exchange', { code, verifier, clientId, redirectUri });
}

export async function hfOAuthRefresh(refreshToken: string, clientId: string): Promise<any> {
  return call<any>('hf_oauth_refresh', { refreshToken, clientId });
}

// ---- chat history store (chat_store.rs) -------------------------------------
//
// Rows are { id, updated_at, blob }; blob is ciphertext made in the page
// (chat-crypto.js), so the shell never sees a message.

export interface ChatStoreRow {
  id: string;
  updated_at: number;
  blob: string;
}

export async function chatStoreList(): Promise<ChatStoreRow[]> {
  return (await call<ChatStoreRow[]>('chat_store_list')) ?? [];
}

export async function chatStorePut(rows: ChatStoreRow[]): Promise<number> {
  return call<number>('chat_store_put', { rows });
}

export async function chatStoreDelete(ids: string[]): Promise<number> {
  return call<number>('chat_store_delete', { ids });
}

export async function chatStoreClear(): Promise<number> {
  return call<number>('chat_store_clear');
}

/** The chat key (base64 AES-256) from the OS credential store, or null. */
export async function chatStoreKeyGet(): Promise<string | null> {
  return (await call<string | null>('chat_store_key_get')) ?? null;
}

export async function chatStoreKeySet(value: string): Promise<void> {
  await call('chat_store_key_set', { value });
}

/**
 * The encrypted chat backend for chats.hydrate(), or null without a shell.
 * The key is read (or made and stored) first, so a credential-store failure
 * surfaces inside hydrate and the history stays in localStorage.
 */
export async function chatStoreBackend(): Promise<import('./chats.js').ChatBackend | null> {
  if (!hasShell()) return null;
  const crypto: typeof import('./chat-crypto.js') = (globalThis as any).FreeAI4UChatCrypto;
  // openBackend never makes a new key over chats the old one sealed: that case
  // is an UNREADABLE error, which chats.js turns into the recovery notice.
  return crypto.openBackend({
    call: (command, args) => call(command, args),
    store: { get: chatStoreKeyGet, set: chatStoreKeySet },
  });
}

/**
 * "Start fresh" (NEURA-022): the shell renames chats.sqlite3 to
 * chats.unreadable-<time>.sqlite3 and sets the old key aside; nothing is
 * deleted. Resolves with the old file's new name ('' when there was none).
 */
export async function chatStoreSetAside(): Promise<string> {
  return (await call<string>('chat_store_set_aside')) ?? '';
}

/** The tray Quit is about to exit: flush, then say quitReady() (NEURA-021). */
export function onAppQuitting(handler: () => void): Promise<() => void> {
  return subscribe<unknown>('app-quitting', () => handler());
}

/** Tell the shell the page has flushed; it exits at once instead of after its wait. */
export async function quitReady(): Promise<void> {
  if (hasShell()) await call('quit_ready');
}

/**
 * Whether the window has the Windows 11 Mica material (NEURA-050). Outside the
 * shell -- the dev browser -- the answer is no, which is also what it looks
 * like there.
 */
export async function windowHasMica(): Promise<boolean> {
  if (!hasShell()) return false;
  try {
    return (await call('window_has_mica')) === true;
  } catch {
    return false;
  }
}

// ---- local dictation (whisper.rs) ---------------------------------------------
//
// The user's own whisper.cpp build: found on PATH or at the path they picked,
// run directly by the shell with a 120 s limit. Weights are ggml .bin files in
// <app data>/whisper-models or beside the binary.

export interface WhisperModel {
  name: string;
  path: string;
  bytes: number;
}

export interface WhisperFacts {
  found: boolean;
  binary: string;
  source: string;
  models: WhisperModel[];
  models_dir: string;
  expected_name: string;
  releases_url: string;
  models_url: string;
}

export async function whisperFind(): Promise<WhisperFacts> {
  return call<WhisperFacts>('whisper_find');
}

export async function whisperUse(path: string): Promise<{ path: string }> {
  return call('whisper_use', { path });
}

/** The native picker; null when it was cancelled. */
export async function whisperPickBinary(): Promise<string | null> {
  return (await call<string | null>('whisper_pick_binary')) ?? null;
}

/** 16 kHz mono WAV (base64) -> the words, through the local binary. */
export async function whisperTranscribe(args: { audioWavBase64: string; modelPath: string; language?: string }): Promise<string> {
  return call<string>('whisper_transcribe', {
    audioWavBase64: args.audioWavBase64,
    modelPath: args.modelPath,
    language: args.language || null,
  });
}

// ---- Start at login (tauri-plugin-autostart) --------------------------------
// The plugin's own commands, invoked directly so the frontend needs no npm
// package for three calls. On Linux this is an ~/.config/autostart .desktop
// entry that launches the app with --hidden (into the tray).
export async function autostartIsEnabled(): Promise<boolean> {
  return call<boolean>('plugin:autostart|is_enabled');
}

export async function autostartSet(on: boolean): Promise<void> {
  await call(on ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
}

/** Restart the app cleanly (the crash screen's way out). */
export async function appRelaunch(): Promise<void> {
  await call('app_relaunch');
}

// ---- The crash log, from the page's side -------------------------------------
/** Append one line to the shell's crash log (no secrets: redact first). */
export async function logClientEvent(scope: string, message: string): Promise<void> {
  if (!hasShell()) return;
  try { await call('log_client_event', { scope, message }); } catch { /* the console still has it */ }
}

/** Open the folder the crash log lives in, in the file manager. */
export async function crashLogReveal(): Promise<void> {
  await call('crash_log_reveal');
}

/** The WebKitGTK renderer mode (Linux, desktop.rs): safe (default), gpu, basic. */
export interface RendererMode {
  available: boolean;
  mode: string;
  modes: string[];
  nvidia: boolean;
}

export async function rendererModeGet(): Promise<RendererMode> {
  return call<RendererMode>('renderer_mode_get');
}

export async function rendererModeSet(mode: string): Promise<RendererMode> {
  return call<RendererMode>('renderer_mode_set', { mode });
}

// ---- Screenshots and desktop control (desktop.rs, portal.rs; L8/L9) --------

export interface DesktopCapabilities {
  available: boolean;
  session: string;
  xdotool?: boolean;
  wtype?: boolean;
  wlPaste?: boolean;
  screenshotTool?: string | null;
  portalScreenshot?: boolean;
  portalShortcuts?: boolean;
  portalRemoteDesktop?: boolean;
  /** 'xdotool' (X11), 'portal' (Wayland) or 'none'. */
  control: string;
}

export async function desktopCapabilities(): Promise<DesktopCapabilities> {
  if (!hasShell()) return { available: false, session: '', control: 'none' };
  return call<DesktopCapabilities>('desktop_capabilities');
}

export interface DesktopShot {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
  tool: string;
}

/** One frame of the screen through the shell (portal, or scrot & co.). */
export async function desktopScreenshot(): Promise<DesktopShot> {
  return call<DesktopShot>('desktop_screenshot');
}

export type DesktopAction =
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'click'; x: number; y: number; button?: number }
  | { kind: 'scroll'; steps: number };

/** Do one thing on the desktop; the caller has asked the person first. */
export async function desktopAct(action: DesktopAction): Promise<{ ok: boolean; via: string }> {
  return call<{ ok: boolean; via: string }>('desktop_act', { action });
}

export async function screenHotkeySet(combo: string): Promise<string> {
  if (!hasShell()) return '';
  return call<string>('screen_hotkey_set', { combo });
}

/** The screen-ask chord fired (quick.rs on X11, portal.rs on Wayland). */
export function onScreenAsk(handler: () => void): Promise<() => void> {
  return subscribe<unknown>('screen-ask', () => handler());
}

/** Wayland: bind the global chords through the GlobalShortcuts portal. */
export async function portalShortcutsBind(combos: { quick: string; selection: string; voice: string; screen: string }): Promise<{ bound: number; via: string }> {
  if (!hasShell()) return { bound: 0, via: 'none' };
  return call<{ bound: number; via: string }>('portal_shortcuts_bind', combos);
}

// ---- One-click runtimes (runtimes.rs): Node 24 and llama.cpp ----------------
export interface GpuFacts {
  vendor: string;
  name: string;
  vram_mb: number | null;
  vulkan: boolean;
  nvidia_driver: boolean;
  ram_gb: number;
  suggestion: string;
}

export interface RuntimeFacts {
  dir: string;
  node: { path: string; version: string } | null;
  llama: { tag: string; asset: string; sha256: string; vulkan: boolean; files: number } | null;
  gpu: GpuFacts | null;
  tools: { tar: boolean; unzip: boolean };
  min_node_major: number;
}

export type RuntimeKind = 'node' | 'llama-vulkan' | 'llama-cpu';

export interface RuntimeProgress {
  kind: RuntimeKind;
  phase: 'resolve' | 'download' | 'extract' | 'done' | 'error';
  received: number;
  total: number;
  done: boolean;
  error: string;
}

export async function runtimeFacts(): Promise<RuntimeFacts> {
  return call<RuntimeFacts>('runtime_facts');
}

/** Download and install one runtime; progress arrives on onRuntimeDownload. */
export async function runtimeInstall(kind: RuntimeKind): Promise<{ path: string; verified: boolean; version?: string; tag?: string }> {
  return call('runtime_install', { kind });
}

export function onRuntimeDownload(handler: (p: RuntimeProgress) => void): Promise<() => void> {
  return subscribe<RuntimeProgress>('runtime-download', handler);
}

// ---- The engine as a systemd user service (engine.rs, Linux) ---------------
export interface EngineServiceStatus {
  available: boolean;
  enabled: boolean;
  active: boolean;
  port: number;
  unit: string;
}

export async function engineServiceStatus(): Promise<EngineServiceStatus> {
  return call<EngineServiceStatus>('engine_service_status');
}

export async function engineServiceSet(on: boolean): Promise<EngineServiceStatus> {
  return call<EngineServiceStatus>('engine_service_set', { on });
}

// ---- Linux desktop integration (desktop.rs, L5) -------------------------------
export interface NemoStatus { available: boolean; nemo: boolean; installed: boolean; dir: string }

export async function nemoActionsStatus(): Promise<NemoStatus> {
  return call<NemoStatus>('nemo_actions_status');
}

export async function nemoActionsSet(on: boolean): Promise<NemoStatus> {
  return call<NemoStatus>('nemo_actions_set', { on });
}

/** Type text into whatever app has focus (xdotool on X11, wtype on Wayland). */
export async function voiceTypeText(text: string): Promise<{ typed: number; tool?: string }> {
  return call('voice_type_text', { text });
}

/** Take (or, with '', release) the hold-to-talk chord. */
export async function voiceHotkeySet(combo: string): Promise<string> {
  return call<string>('voice_hotkey_set', { combo });
}

/** The chord's press ('start') and release ('stop'). */
export function onVoiceType(handler: (state: 'start' | 'stop') => void): Promise<() => void> {
  return subscribe<{ state: 'start' | 'stop' }>('voice-type', (p) => handler(p.state));
}

/** The tray icon's badge: idle, thinking (cyan) or approval (amber). */
export async function trayStateSet(state: 'idle' | 'thinking' | 'approval'): Promise<boolean> {
  if (!hasShell()) return false;
  try { return await call<boolean>('tray_state_set', { state }); } catch { return false; }
}

/**
 * A notification with buttons. `actions` are [key, label] pairs; the pressed
 * key comes back through onNotificationAction with the same `id`
 * ('dismissed' when it was closed). Off Linux the buttons are dropped and
 * `actions` in the result says so.
 */
export async function notifyWithActions(id: string, title: string, body: string, actions: Array<[string, string]>): Promise<{ shown: boolean; actions: boolean }> {
  if (!hasShell()) return { shown: false, actions: false };
  try {
    return await call('notify_with_actions', { id, title, body, actions });
  } catch {
    return { shown: false, actions: false };
  }
}

export function onNotificationAction(handler: (id: string, action: string) => void): Promise<() => void> {
  return subscribe<{ id: string; action: string }>('notification-action', (p) => handler(p.id, p.action));
}

// ---- ACP agents (acp.rs, L6): Gemini CLI, Claude Code, Codex... over stdio ----
export interface AcpStarted {
  id: string;
  pid: number;
  sessionId: string;
  agentInfo: { name?: string; version?: string } | null;
  agentCapabilities: Record<string, unknown> | null;
  authMethods: Array<{ id: string; name: string; description?: string }> | null;
}

/** One line from the agent: a JSON-RPC message, a stderr line, or its exit. */
export interface AcpMessage {
  agent: string;
  message?: { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any; result?: any; error?: any };
  stderr?: string;
  exited?: boolean;
}

export async function acpStart(id: string, command: string, args: string[], cwd: string): Promise<AcpStarted> {
  return call<AcpStarted>('acp_start', { id, command, args, cwd });
}

/** Blocks until the turn ends; updates arrive on onAcpMessage meanwhile. */
export async function acpPrompt(id: string, sessionId: string, text: string): Promise<{ stopReason?: string }> {
  return call('acp_prompt', { id, sessionId, text });
}

export async function acpCancel(id: string, sessionId: string): Promise<void> {
  await call('acp_cancel', { id, sessionId });
}

/** Answer a request the agent made (permission, fs read, fs write). */
export async function acpRespond(id: string, requestId: number | string, result?: unknown, error?: string): Promise<void> {
  await call('acp_respond', { id, requestId, result: result ?? null, error: error ?? null });
}

export async function acpStop(id: string): Promise<{ stopped: boolean }> {
  return call('acp_stop', { id });
}

export async function acpList(): Promise<string[]> {
  return call<string[]>('acp_list');
}

export function onAcpMessage(handler: (m: AcpMessage) => void): Promise<() => void> {
  return subscribe<AcpMessage>('acp-message', handler);
}
