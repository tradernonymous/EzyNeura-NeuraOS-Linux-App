# The bundled engine

`server.js` and its local dependency closure (`auth.js`, `chatlib.js`,
`github.js`, `agent-sessions.js`, `fcm-push.js`, `tool-call-text.js`,
`package.json`), copied unmodified from `tradernonymous/freeopenai` at
the commit pinned in `../../../../UPSTREAM`. `scripts/sync-upstream.sh`
re-copies this directory too.

**Not included:** the static web app (`index.html`, `chatlib.js` served
as an asset, `style.css`, everything under `docs/readme`, etc.). The
desktop app talks to this engine through its `/api/*` JSON routes only
(`src/api.ts`), the same way it already talks to a remote Railway engine
-- it doesn't need the browser-facing pages `server.js` also serves at
`/`. Bundling those too, so `http://127.0.0.1:<port>` also works when
opened directly in Firefox (`docs/MASTER_PLAN.md` section 5's "the web
UI also opens in Firefox at localhost"), is open work, not done here.

**Why this is safe to bundle as plain `.js` files:** `server.js` has zero
npm runtime dependencies -- only Node's own built-in modules
(`http`, `fs`, `path`, `child_process`, `crypto`, `zlib`, `dns`) plus
these local files. There is nothing to `npm install` and nothing to
compile; running it is just `node server.js` with a `PORT` set, which is
exactly what `src-tauri/src/engine.rs` does.

**What it needs that this bundle does not provide:** a `node` binary,
version 24 or newer, found on the machine's own `PATH`
(`engine.rs::find_node`). Shipping a portable Node runtime too, so no one
needs anything installed, is `docs/MASTER_PLAN.md`'s more ambitious L3
goal and is tracked as open work in `docs/BACKLOG.md`, not done here.
