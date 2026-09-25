---
name: pc-vitals
description: Read-only vitals of this PC in one screen - CPU, memory, disk, GPU and VRAM, temperatures, top processes, uptime, pending reboot - with nothing changed. Triggers on "vitals", "how is the PC doing", "show me the load", "temperatures", "GPU usage", "what is using memory".
---

# Vitals, read-only

One report, no changes, no sudo. Everything below is allowed without a
prompt by `pc/settings/readonly-allowlist.json`.

```bash
hostnamectl | grep -E "Operating|Kernel"
uptime
echo; echo "== CPU"; lscpu | grep -E "Model name|^CPU\(s\)"; top -bn1 | grep "%Cpu"
echo; echo "== memory"; free -h
echo; echo "== disk"; df -h -x tmpfs -x devtmpfs -x squashfs
echo; echo "== top by CPU"; ps -eo pid,pcpu,pmem,rss,cmd --sort=-pcpu | head -8
echo; echo "== top by memory"; ps -eo pid,pcpu,pmem,rss,cmd --sort=-rss | head -8
echo; echo "== GPU"
nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv 2>/dev/null \
  || glxinfo -B 2>/dev/null | grep -E "Device|VRAM" || echo "no GPU query tool (mesa-utils / nvidia-smi)"
echo; echo "== temperatures"; sensors 2>/dev/null | grep -E "°C" | head -12 || echo "lm-sensors not installed"
echo; echo "== services"; systemctl --failed --no-pager --quiet; systemctl --user --failed --no-pager --quiet
echo; echo "== updates"; apt list --upgradable 2>/dev/null | wc -l; [ -f /var/run/reboot-required ] && echo "REBOOT PENDING"
echo; echo "== NeuraOS"; ss -tlnp 2>/dev/null | grep -E ":8080|:8787|:7860|:11434|:3001" || echo "no local model / image / UI servers listening"
```

## Reading it

- "available" memory under 1 GB with swap in use: memory pressure; the
  top-by-memory list says who.
- Load average above the CPU count for 5 minutes: CPU bound; below it with
  a slow feel: I/O (`iostat -x 2 3` from `sysstat`) or the GPU.
- A GPU at 100% with nothing asked of it: a stuck llama-server or
  sd-server; NeuraOS's Settings → Local models shows and stops it.
- Temperatures over 85 °C on a CPU or 80 °C on a GPU under light load:
  dust or a fan; not a software fix.

Report the numbers that matter and stop; changes belong to another skill.
