#!/usr/bin/env bash
# P5.3 of docs/PC_UPGRADE_PLAN.md: what Claude Code's Bash sandbox needs on
# Linux Mint (bubblewrap + socat), and the AppArmor profile Ubuntu 24.04+
# bases (Mint 22) need before bwrap may create user namespaces. Then turn
# the sandbox on with /sandbox in a session, or "sandbox": {"enabled": true}
# in ~/.claude/settings.json.
set -euo pipefail
sudo apt-get install -y -qq bubblewrap socat
restrict="$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo missing)"
if [ "$restrict" = "1" ]; then
  echo "== AppArmor restricts unprivileged user namespaces: adding the bwrap profile from the Claude Code docs"
  sudo tee /etc/apparmor.d/bwrap >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
PROFILE
  sudo systemctl reload apparmor
else
  echo "== no AppArmor userns restriction here ($restrict); nothing to add"
fi
echo "Now in a Claude Code session: /sandbox → mode 'auto-allow', and the Dependencies tab should be gone."
