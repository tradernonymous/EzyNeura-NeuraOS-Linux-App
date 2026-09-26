# Threat model — desktop control and the `--mcp` server

D3 of `docs/APP_UPGRADE_PLAN.md`. This is the written-out version of the
assumptions the code already makes, so they can be argued with. It covers the
two surfaces that can act on the machine without typing: the desktop-control
tools, and `freeai4u-desktop --mcp`.

## Assets

- **The person's files** in the folder the app has open, and the rest of the
  home directory a shell command can reach.
- **The person's credentials**: BYOK keys and the Hugging Face token (OS
  keyring, `secrets.rs`), the llama-server bearer key (`local-model.json`,
  mode `0600`, `models.rs`), git remotes with credentials.
- **The screen** (screen_capture) and **the keyboard in front of any app**
  (desktop_type / desktop_key).
- **The person's attention**: an approval card that is clicked through without
  reading is the failure mode every other control is compensating for.

## Entry points

| Surface | Who can trigger it | Gate |
| :-- | :-- | :-- |
| Model tool calls (chat, recipes, sub-agents) | Whichever model is selected, steered by prompt content | `tools.js` `ASKS`: every mutating tool asks; C6 edit-before-approve; C12 audit log |
| Desktop control (`desktop_click`, `desktop_type`, `desktop_key`, `desktop_scroll`, `screen_capture`) | The model, same as above | In `ASKS` — they ask **every time**; `alwaysKey` deliberately returns `''` for them, so "always" is never an option for a keystroke injection |
| Shell commands (`run_command`) | The model | Ask by default; the C11 read-only preset is an allowlist the person throws **per folder**; levels `delegate`/`full`/`sandbox` in `approval.js` |
| `freeai4u-desktop --mcp` | Whoever spawns it (an MCP client: Claude Code, Gemini CLI, …) | Process boundary — see below |
| Loopback services (llama-server, Ollama, sd-server, the engine) | Any process on this machine | Loopback only; llama-server gets a random bearer key per start |
| Web content (`web_fetch`, search results) | Any page the model reads | C8: results are labelled `[untrusted content …]` before the model reads them, and badged on the card |

## Desktop control

**What it is.** `desktop.rs` moves the mouse, clicks, types and sends keys
through the accessibility/X11/Wayland stack; `selection.rs` reads the
selection; `screen_capture` grabs the frame buffer.

The threats, and what answers them:

1. **Typing into the wrong window.** A `desktop_type` that lands in a
   password dialog or a root terminal is the worst case. Answered by: the
   card asks every time and names the action; on Wayland, the desktop portal
   *also* asks per call (the app cannot type without it — `desktop.rs`), so
   there are two independent doors. On X11 there is one door: the card.
   Residual risk: an approved keystroke goes to whatever is focused.
   Treat every desktop_type card as "read the window it names".
2. **The screen as a secret source.** `screen_capture` can photograph
   tokens on screen. It is in `ASKS` (asks every time) and its output
   carries an approval card, and C12 records that it happened.
3. **Prompt injection driving the gate.** A malicious page or repository
   file can try to talk the model into requesting a dangerous call. The
   model never executes anything itself — it can only *ask*. C8 labels the
   injected text as data so the model is less likely to obey it, C6 lets the
   person edit the arguments before allowing, and C12 logs the decision the
   model's tools cannot rewrite. The person at the card is the control;
   the rest is defence in depth.
4. **Commands escape the folder.** `run_command` runs as the user, in the
   opened folder, with no container unless the sandbox level (Docker) is
   chosen. The C11 preset only ever admits a curated read-only list (chains,
   redirects, `-exec`, `-d`, `--output` … are rejected before the list is
   consulted); everything else asks, and `.freeai4u.json` from a cloned
   repository can only make the gates stricter, never looser
   (`project-config.js`).

## The `--mcp` server

**What it is** (`mcp_server.rs`): NeuraOS speaking MCP **over stdio** —
one JSON line in, one JSON line out — started *by the client*
(`claude mcp add neuraos -- /usr/bin/freeai4u-desktop --mcp`), one process
per client, gone when the client closes stdin. It has **no window, no tray,
and no listening socket**: there is nothing on the network to connect to.
It exposes: local-model status, a chat through the local model server or
Ollama, an image draw, GPU facts, the GGUF list, and "open a folder/file in
the running app".

The threats, and what answers them:

1. **A malicious MCP client.** Whoever can start this process already runs
   code as the user — spawning NeuraOS does not grant them anything they
   did not have. What the server adds is *convenience*: local model calls,
   and the ability to make the running app open a folder or file (a
   navigation, not a write). The honest statement of trust: **the MCP client
   is as trusted as a shell in this user's account**, because it literally
   is one.
2. **The llama-server key.** `--mcp` reads `local-model.json` to find the
   port and bearer key. The file is written `0600` (`models.rs`), so it
   reaches no other account. Any same-uid process can read it — same-uid is
   the trust boundary everywhere in this model.
3. **Turning it into a network service.** The dangerous future is someone
   wrapping `--mcp` in TCP. If that ever happens it must bind `127.0.0.1`
   only and require a token; today there is deliberately no bind code at
   all. The loopback services it *talks to* (llama-server with its per-run
   bearer key, Ollama, the image server) follow the same rule.
4. **Prompt injection through the MCP tools.** `neuraos_chat` returns a
   model's answer as plain text into the calling client's context — the
   client's own rules for untrusted output apply; on this app's side the
   same C8 marking applies wherever that text lands in a NeuraOS chat.

## Residual risks, stated plainly

- **An approved command is a granted shell.** Levels `delegate`/`full`
  trade the card for speed; `sandbox` is the one that trades it for a
  container. The preset (C11) never grew beyond read-only verbs.
- **The approval card works only if it is read.** C6 (edit before allow),
  the failure/advice cards and C12 (the audit) all exist to make reading it
  cheap; none of them force it.
- **Same-uid is not a boundary.** `0600` keeps secrets off other accounts,
  not off other processes of this user. A process running as this user can
  read the state files and the keyring when unlocked.
- **The webview is a browser.** It renders remote content (the model's
  markdown, fetched pages). Tauri's origin isolation and the app's CSP are
  the controls; a webview escape would be running with the app's
  privileges.

## Non-goals

- Windows (this repository owns the Linux delta; the Windows path is
  upstream's).
- Multi-user hardening beyond Unix file permissions.
- A formal audit: this document records intent, not a pen-test result.

*Checked against: `tools.js` (`ASKS`, `alwaysKey`), `approval.js` (C11
preset), `agent-turn.ts`, `tools.js` `markUntrusted` (C8), `audit.js` (C12),
`project-config.js`, `mcp_server.rs`, `models.rs` (0600, `new_api_key`),
`desktop.rs` (portal ask), `secrets.rs` (keyring).*
