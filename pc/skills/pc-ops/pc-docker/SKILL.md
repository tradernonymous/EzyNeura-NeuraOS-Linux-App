---
name: pc-docker
description: Docker and Compose stacks on this PC - status, logs, updating images, reclaiming disk, the docker group, GPU passthrough for a container. Triggers on "docker", "compose", "container is down", "docker logs", "prune", "docker disk", "nvidia container", "run this in a container".
---

# Docker on a Mint desktop

Docker Engine from Docker's apt repo (not the Snap, not `docker.io`
from Ubuntu if it lags). Rootless Docker is the safer default for a
desktop that runs agents; the `docker` group is root-equivalent.

## Look (no prompt)

```bash
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker compose ls
docker system df
docker logs --tail 50 <name>
```

## Do (asks)

- A down container: `docker compose -f /path/compose.yml up -d` from its
  folder; `docker compose logs -f name` to watch it come up.
- Update a stack: `docker compose pull && docker compose up -d`, then
  `docker image prune -f`.
- Disk: `docker system prune` (stopped containers, dangling images,
  unused networks); `--volumes` only after listing `docker volume ls`
  and confirming nothing named there is data.
- GPU in a container: NVIDIA Container Toolkit (`nvidia-ctk runtime
  configure --runtime=docker`, restart docker), then `--gpus all`. On AMD
  or Intel, `--device /dev/dri`.
- Ports: publish on `127.0.0.1:port:port`, not `port:port`; the latter
  is the LAN.

## Where things live

`/var/lib/docker` (or `~/.local/share/docker` rootless); Compose files
in one folder per stack (`~/stacks/name/compose.yml` with its `.env`).
A stack's `.env` holds secrets: `chmod 600`, and a `Read(**/.env)` deny
rule in Claude Code's settings.

## Do not

- `docker run` a long-lived service by hand; write the Compose file.
- `docker system prune -a --volumes` to "clean up": it removes every
  unused image and every volume no container references, data included.
- Publish a service on `0.0.0.0` to reach it from a phone; a Tailscale
  or SSH tunnel does that without opening the LAN.
