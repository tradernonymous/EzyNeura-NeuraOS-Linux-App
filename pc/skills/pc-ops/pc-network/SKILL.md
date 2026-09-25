---
name: pc-network
description: Diagnose and fix networking on this PC - no internet, DNS, Wi-Fi drops, VPN, a port that should or should not be open, NetworkManager, the NeuraOS engine or web UI not reachable. Triggers on "no internet", "DNS", "wifi keeps dropping", "can't reach", "port", "nmcli", "VPN", "connection refused", "ERR_CONNECTION".
---

# Network on Mint (NetworkManager + systemd-resolved)

## Layer by layer, read-only

```bash
nmcli device status; nmcli connection show --active
ip addr show | grep -E "inet |state"; ip route
ping -c2 -W2 1.1.1.1          # IP out?
resolvectl status | head -20; resolvectl query mint.com   # names out?
curl -sI https://github.com | head -1                       # TLS/HTTP out?
ss -tulpn                      # what listens here
```

Stop at the first layer that fails; the fix is there.

## Fixes (ask before each)

- **Interface down**: `nmcli device connect wlp3s0` / `nmcli radio wifi on`.
- **IP but no names**: `resolvectl status` shows no DNS server or a dead
  one; `nmcli connection modify "<name>" ipv4.dns "1.1.1.1 9.9.9.9"
  ipv4.ignore-auto-dns yes && nmcli connection up "<name>"`.
- **Wi-Fi drops on a laptop**: power saving; write
  `/etc/NetworkManager/conf.d/wifi-powersave-off.conf` with
  `[connection]\nwifi.powersave = 2` and restart NetworkManager. Also
  `iw dev wlp3s0 link` for signal, and the 5 GHz band if 2.4 is crowded.
- **VPN eats DNS**: `resolvectl dns tun0 …` or the VPN's `ipv4.dns-search
  ~.` setting; `resolvectl status` per link shows who answers what.
- **"connection refused" on localhost**: nothing listens; check the
  service (`systemctl --user status neuraos-claude-ui`, NeuraOS Settings →
  Local models for llama-server) rather than the network.
- **A port to open on the LAN**: `sudo ufw allow from 192.168.1.0/24 to
  any port N proto tcp`, named in the rule's comment, and a note to close
  it. Prefer an SSH tunnel: `ssh -L N:127.0.0.1:N pc`.
- **Reach the PC from a phone**: Tailscale (`sudo tailscale up`) beats
  port forwarding on the router.

## Do not

- Edit `/etc/resolv.conf` by hand: resolved owns it.
- Disable IPv6 as a first fix; find the layer first.
- Turn off the firewall to test; allow the one address for the test.
