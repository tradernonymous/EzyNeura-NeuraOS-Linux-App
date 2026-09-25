#!/usr/bin/env bash
# P1.2 of docs/PC_UPGRADE_PLAN.md: the browser GUI for Claude Code that
# HomelabHero uses (claudecodeui, npm package @cloudcli-ai/cloudcli), installed
# alone on this PC as your own user and bound to 127.0.0.1:3001. Nothing
# reachable from the LAN, no VM, no hhagent/hhvault users, no sudoers rule.
#
# HomelabHero's own installer is for a fresh Ubuntu container; only two of its
# facts are reused here: the package name, and the npm flag that lets its
# native modules build (better-sqlite3, node-pty, bcrypt). The package is
# AGPL-3.0; it is installed from npm, nothing of it is copied here.
set -euo pipefail
PORT="${PORT:-3001}"

command -v node >/dev/null || { echo "Node is needed (20+): NeuraOS's one-click runtime installs Node 24, or sudo apt install nodejs npm" >&2; exit 1; }
command -v claude >/dev/null || command -v "$HOME/.local/bin/claude" >/dev/null || { echo "install Claude Code first: pc/install-claude-code.sh" >&2; exit 1; }

# A per-user npm prefix: no sudo npm, ever.
PREFIX="$HOME/.npm-global"
mkdir -p "$PREFIX"
npm config set prefix "$PREFIX"
echo "== npm install -g @cloudcli-ai/cloudcli (native modules allowed to build)"
npm install -g --allow-scripts=@cloudcli-ai/cloudcli,better-sqlite3,node-pty,bcrypt @cloudcli-ai/cloudcli
[ -x "$PREFIX/bin/cloudcli" ] || { echo "cloudcli did not install into $PREFIX/bin" >&2; exit 1; }

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
sed -e "s/^Environment=SERVER_PORT=.*/Environment=SERVER_PORT=$PORT/" -e "s/^Environment=PORT=.*/Environment=PORT=$PORT/" \
  "$(dirname "$0")/web-ui.service" > "$UNIT_DIR/neuraos-claude-ui.service"
systemctl --user daemon-reload
systemctl --user enable --now neuraos-claude-ui.service
sleep 4
systemctl --user --no-pager status neuraos-claude-ui.service | head -5 || true

# The one check that matters: who is it listening for.
bound="$(ss -tln 2>/dev/null | awk -v p=":$PORT" '$4 ~ p"$" {print $4}' | head -1)"
case "$bound" in
  127.0.0.1:*|\[::1\]:*) echo "bound to $bound: localhost only, as intended" ;;
  "") echo "warning: nothing is listening on $PORT yet; check: journalctl --user -u neuraos-claude-ui -n 30" ;;
  *) echo "WARNING: bound to $bound (every interface). Stop it: systemctl --user stop neuraos-claude-ui; then check the HOST line in $UNIT_DIR/neuraos-claude-ui.service" ;;
esac

echo
echo "Open http://127.0.0.1:$PORT  (first visit creates the UI's own login)."
echo "For a desktop window: Firefox → menu → Install as web app, or: "
echo "  xdg-open http://127.0.0.1:$PORT"
echo "Logs: journalctl --user -u neuraos-claude-ui -f"
echo "From another device: an SSH tunnel (ssh -L $PORT:127.0.0.1:$PORT this-pc), never a LAN bind."
