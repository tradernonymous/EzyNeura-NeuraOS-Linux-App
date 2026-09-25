---
name: mint-troubleshooter
description: Diagnose a slow or misbehaving Linux Mint desktop - CPU, memory, disk, GPU, network, a failed service - by taking a baseline first and changing one thing at a time. Triggers on "Mint is slow", "high memory", "disk full", "no space left", "dmesg", "won't boot", "Cinnamon crashed", "fan is loud".
---

# Troubleshooting Mint

## Step 0: the baseline, always first

```bash
uptime; free -h; df -h; df -i
top -bn1 | head -20
dmesg -T --level=err,warn | tail -30
systemctl --failed; systemctl --user --failed
journalctl -p err -b --no-pager | tail -30
```

Never act before this snapshot exists; it is what "fixed" is measured
against.

## Then by symptom

**CPU or a loud fan**: `top -o %CPU`, `ps -eo pid,pcpu,pmem,cmd --sort=-pcpu
| head`. A `cinnamon` process at 100% is usually an applet or a broken
extension: `cinnamon --replace &` restarts the desktop without logging
out. `tracker-miner-fs` or `baloo` indexing after a big copy is normal
and stops.

**Memory**: `free -h` (look at "available", not "free"); `ps -eo
pid,rss,cmd --sort=-rss | head`. A browser is the usual answer. Swap
thrashing on 8 GB: `sudo sysctl vm.swappiness=10`, then make it
permanent in `/etc/sysctl.d/`. `zram` (`sudo apt install zram-tools`)
beats a swap file on a laptop.

**Disk full**: `sudo du -xh --max-depth=1 / | sort -h`, then the usual
suspects: `~/.cache` (`du -sh ~/.cache/*`), `/var/log/journal`
(`journalctl --vacuum-size=200M`), old kernels (`sudo apt autoremove
--purge`), Timeshift snapshots (`sudo timeshift --list`), Flatpak leftovers
(`flatpak uninstall --unused`), and the model caches NeuraOS knows about
(`~/.cache/huggingface`, `~/.ollama`). `df -i` full with `df -h` free means
inodes: millions of tiny files somewhere, usually a cache.

**Disk health**: `sudo smartctl -a /dev/nvme0` (apt: `smartmontools`),
`dmesg | grep -i -E "I/O error|ata[0-9]"`.

**GPU**: `nvidia-smi` or `glxinfo -B` (apt: `mesa-utils`);
`inxi -G` (apt: `inxi`) says which driver is in use. A black screen after
a kernel update on NVIDIA means DKMS did not rebuild: `dkms status`,
`sudo dkms autoinstall`. Wayland vs X11 is chosen on the login screen's
gear; most trouble with screen sharing, xdotool or fractional scaling is
that choice.

**Network**: `ip addr; ip route; resolvectl status; ping -c3 1.1.1.1;
ping -c3 mint.com` (IP works but names do not means DNS). `nmcli device
status`, `nmcli connection show`. Wi-Fi power saving on a laptop:
`/etc/NetworkManager/conf.d/wifi-powersave-off.conf` with
`wifi.powersave = 2`.

**A service**: `systemctl status name`, `journalctl -u name -n 100`.
See the systemd-manager skill.

**Boot**: hold Shift for GRUB, pick the previous kernel or recovery.
`journalctl -b -1 -p err` reads the last boot's errors from the current
one. Timeshift restores a snapshot when a change broke the system.

## Guard rails

- One change, then re-measure against the baseline.
- No `rm -rf` in `/var` or `/usr` to free space; use the tools that own
  the files (`journalctl --vacuum`, `apt clean`, Timeshift's own delete).
- A reboot is a valid step, not a fix: note what was different after.
- Anything with `sudo` and a config file: copy it first
  (`sudo cp file{,.bak-$(date +%F)}`).
