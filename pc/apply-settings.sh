#!/usr/bin/env bash
# Merge this repository's Claude Code settings into ~/.claude/settings.json
# (docs/PC_UPGRADE_PLAN.md P3.5, P5.2, P5.3), one flag per piece, keeping
# everything already in the file. Re-runnable; prints what changed.
#
#   pc/apply-settings.sh --allowlist   # 5c: pc/settings/readonly-allowlist.json (allow + deny)
#   pc/apply-settings.sh --audit       # 5d: the PostToolUse hook for ~/.claude/audit-hook.sh
#   pc/apply-settings.sh --sandbox     # 5e: sandbox.enabled with the domain allowlist
#   pc/apply-settings.sh --all
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
[ $# -gt 0 ] || { sed -n 2,10p "$0"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is needed" >&2; exit 1; }
mkdir -p "$HOME/.claude"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak-$(date +%F-%H%M%S)"
python3 - "$SETTINGS" "$HERE/settings/readonly-allowlist.json" "$HOME" "$@" <<'PY'
import json, sys
settings_path, allowlist_path, home, *flags = sys.argv[1:]
if "--all" in flags: flags = ["--allowlist", "--audit", "--sandbox"]
s = json.load(open(settings_path))
changed = []

if "--allowlist" in flags:
    src = json.load(open(allowlist_path))["permissions"]
    perms = s.setdefault("permissions", {})
    for key in ("allow", "deny"):
        have = perms.setdefault(key, [])
        new = [r for r in src.get(key, []) if r not in have]
        have.extend(new)
        if new: changed.append(f"permissions.{key}: +{len(new)} rules")

if "--audit" in flags:
    hook_cmd = f"{home}/.claude/audit-hook.sh"
    hooks = s.setdefault("hooks", {})
    post = hooks.setdefault("PostToolUse", [])
    present = any(h.get("command") == hook_cmd for g in post for h in g.get("hooks", []))
    if not present:
        post.append({"matcher": "Bash", "hooks": [{"type": "command", "command": hook_cmd, "timeout": 5}]})
        changed.append("hooks.PostToolUse: audit hook added")

if "--sandbox" in flags:
    sb = s.setdefault("sandbox", {})
    if not sb.get("enabled"):
        sb["enabled"] = True; changed.append("sandbox.enabled: true")
    sb.setdefault("autoAllowBashIfSandboxed", True)
    net = sb.setdefault("network", {})
    domains = net.setdefault("allowedDomains", [])
    # GitHub Releases (Electron, prebuilt native modules, one-click runtimes)
    # redirect to *.githubusercontent.com; without it the sandbox proxy
    # refuses the download and npm install fails half-way.
    for d in ["github.com", "*.github.com", "*.githubusercontent.com", "registry.npmjs.org", "nodejs.org", "crates.io", "static.crates.io", "index.crates.io", "huggingface.co", "*.huggingface.co", "*.hf.co", "claude.ai", "*.anthropic.com", "pypi.org", "files.pythonhosted.org"]:
        if d not in domains: domains.append(d); changed.append(f"sandbox.network.allowedDomains: +{d}")

json.dump(s, open(settings_path, "w"), indent=2)
open(settings_path, "a").write("\n")
print("\n".join(changed) if changed else "nothing to change")
PY
echo "settings: $SETTINGS (backup beside it)"
