---
name: pc-security-audit
description: A periodic security audit of this PC that runs agents - open ports, logins, sudo use, updates, firewall, AppArmor, the agent audit log, secrets on disk - as a report with a fix list, changing nothing. Triggers on "security audit", "am I exposed", "check for intrusions", "who logged in", "review sudo", "lynis report", "monthly audit".
---

# The monthly audit (read-only report)

Run everything; write the report as findings ranked by risk with the
command that fixes each. Fixes are the person's call, done through
`mint-hardening` afterwards.

```bash
echo "== exposure";      sudo ss -tulpn | grep -v "127.0.0.1\|\[::1\]"
echo "== firewall";      sudo ufw status verbose | head -5
echo "== logins";        last -n 15; lastb -n 10 2>/dev/null | head; journalctl -u ssh --since "-30d" | grep -c "Accepted"
echo "== sudo, 30 days"; journalctl _COMM=sudo --since "-30d" --no-pager | grep -E "COMMAND" | awk -F'COMMAND=' '{print $2}' | sort | uniq -c | sort -rn | head -20
echo "== updates";       apt list --upgradable 2>/dev/null | wc -l; [ -f /var/run/reboot-required ] && echo REBOOT-PENDING
echo "== apparmor";      sudo aa-status --summary 2>/dev/null || sudo aa-status | head -5
echo "== users";         awk -F: '$3>=1000 && $7!~/nologin|false/ {print $1}' /etc/passwd; grep -E "^sudo:" /etc/group
echo "== ssh config";    sudo sshd -T 2>/dev/null | grep -E "^(passwordauthentication|permitrootlogin|allowusers)"
echo "== agent log";     sudo tail -n 20 /var/log/claude-code/commands.log 2>/dev/null || echo "no audit log (pc/safety/install-audit-log.sh)"
echo "== secrets on disk"; grep -rIl -E "sk-ant-|hf_[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}" "$HOME" --exclude-dir=.cache --exclude-dir=node_modules --exclude-dir=target 2>/dev/null | head
echo "== lynis";         sudo lynis audit system --quick --quiet 2>/dev/null | grep -E "Hardening index|Warning" | head
```

## What each finding means

- A LAN-exposed port with no reason: highest. A local UI, model or
  image server on `0.0.0.0` is the usual culprit.
- Sudo commands you did not run yourself: check the time against the
  agent audit log; a match is an agent acting with your rights.
- A key or token in a file: rotate it now, then move it to the keyring
  (`secret-tool store`) and add a deny rule for that path.
- Failed SSH logins in the hundreds: the port is on the internet; close
  it or move behind Tailscale, add fail2ban.
- Reboot pending over a week: a kernel fix is not in effect.
- Lynis under 65: work the warnings, top down.

## Report shape

Ten lines or fewer: risk, evidence (one line), fix (one command or one
skill). Then the date, so the next audit shows the delta.
