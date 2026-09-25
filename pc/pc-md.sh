#!/usr/bin/env bash
# P3.4 of docs/PC_UPGRADE_PLAN.md: a capability catalogue of this machine at
# ~/.claude/pc.md, so every Claude Code session starts knowing the box.
# Then add one line to ~/.claude/CLAUDE.md:   @~/.claude/pc.md
# Re-run after a hardware or runtime change. Reads only.
set -uo pipefail
OUT="${1:-$HOME/.claude/pc.md}"
mkdir -p "$(dirname "$OUT")"
have() { command -v "$1" >/dev/null 2>&1; }
ver() { have "$1" && "$1" --version 2>/dev/null | head -1 || echo "not installed"; }
{
  echo "# This PC (generated $(date -I) by pc/pc-md.sh; do not edit, re-run)"
  echo
  echo "- Host: $(hostname) · $(grep -E '^PRETTY_NAME' /etc/os-release | cut -d'"' -f2) · kernel $(uname -r) · $(uname -m)"
  echo "- Session: ${XDG_SESSION_TYPE:-unknown} · desktop ${XDG_CURRENT_DESKTOP:-unknown}"
  echo "- CPU: $(lscpu | grep 'Model name' | sed 's/.*: *//') · $(nproc) threads · RAM $(free -g | awk '/Mem:/ {print $2}') GB"
  if have nvidia-smi; then
    echo "- GPU: $(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | head -1) (NVIDIA; CUDA and Vulkan)"
  elif have glxinfo; then
    echo "- GPU: $(glxinfo -B 2>/dev/null | grep -E 'Device:' | sed 's/.*Device: *//') (Mesa; Vulkan via $(have vulkaninfo && vulkaninfo --summary 2>/dev/null | grep -m1 deviceName | sed 's/.*= *//' || echo 'unknown'))"
  else
    echo "- GPU: unknown (install mesa-utils for glxinfo)"
  fi
  echo "- Disk: $(df -h / | awk 'NR==2 {print $4 " free of " $2 " on /"}'); home $(df -h "$HOME" | awk 'NR==2 {print $4 " free"}')"
  echo
  echo "## Runtimes"
  echo "- node: $(ver node) · npm: $(ver npm)"
  echo "- python3: $(ver python3) · pipx: $(have pipx && echo yes || echo no)"
  echo "- rustc: $(ver rustc) · cargo: $(ver cargo)"
  echo "- docker: $(ver docker | cut -d, -f1) · podman: $(have podman && echo yes || echo no)"
  echo "- claude: $(ver claude) · ollama: $(ver ollama)"
  echo "- ripgrep: $(have rg && echo yes || echo no) · bubblewrap: $(have bwrap && echo yes || echo no) · socat: $(have socat && echo yes || echo no) · xdotool: $(have xdotool && echo yes || echo no)"
  echo
  echo "## AI on this machine"
  echo "- NeuraOS app: $(have freeai4u-desktop && echo installed || echo 'not on PATH') · MCP: \`claude mcp add neuraos -- freeai4u-desktop --mcp\`"
  echo "- Models (GGUF): $(find "$HOME/.local/share/com.freeai4u.desktop/models" "$HOME/.cache/huggingface" "$HOME/.ollama/models" -name '*.gguf' 2>/dev/null | wc -l) files under ~/.local/share/com.freeai4u.desktop/models, ~/.cache/huggingface, ~/.ollama"
  echo "- Local servers when running: llama-server (NeuraOS picks the port; \`neuraos_status\` over MCP says), sd-server 127.0.0.1:7860, Ollama 127.0.0.1:11434, Claude Code web UI 127.0.0.1:3001"
  echo
  echo "## Rules of this box"
  echo "- Nothing listens on the LAN; reach services through an SSH tunnel."
  echo "- Secrets live in the keyring (secret-tool), never in files the agent reads."
  echo "- Every Bash command an agent runs is appended to /var/log/claude-code/commands.log."
} > "$OUT"
echo "wrote $OUT"
grep -q '@~/.claude/pc.md' "$HOME/.claude/CLAUDE.md" 2>/dev/null || echo "add this line to ~/.claude/CLAUDE.md:  @~/.claude/pc.md"
