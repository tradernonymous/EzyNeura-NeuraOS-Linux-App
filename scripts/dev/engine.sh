#!/usr/bin/env bash
# The bundled NeuraOS engine, started the way engine.rs starts it (PORT in
# the environment, `node server.js`), for the run-app skill: a local engine
# the debug build can be pointed at, with its data in a scratch folder so a
# dev run never touches the real one. Node 24+ on PATH.
#
#   scripts/dev/engine.sh [port]     (default 8787)
set -euo pipefail
PORT="${1:-8787}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE="$ROOT/app/desktop/src-tauri/engine/server.js"
[ -f "$ENGINE" ] || { echo "no engine at $ENGINE (run scripts/sync-upstream.sh)" >&2; exit 1; }
command -v node >/dev/null || { echo "node is not installed (24+ needed)" >&2; exit 1; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 24 ] || echo "warning: node $major found, the engine wants 24+" >&2
DATA="${NEURAOS_DEV_DATA:-${TMPDIR:-/tmp}/neuraos-dev-engine}"
mkdir -p "$DATA"
echo "engine on http://127.0.0.1:$PORT (data in $DATA)"
cd "$DATA"
PORT="$PORT" exec node "$ENGINE"
