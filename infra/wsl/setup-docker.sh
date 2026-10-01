#!/usr/bin/env bash
# Step 1b — install Docker Engine inside WSL2 Ubuntu 24.04 (no Docker Desktop needed).
# Run inside Ubuntu:  bash infra/wsl/setup-docker.sh
set -euo pipefail

if ! grep -qi microsoft /proc/version; then
  echo "This script is meant for WSL2 Ubuntu." >&2
  exit 1
fi

# 1. Make sure systemd is on (needed so Docker starts automatically).
if ! grep -q "systemd=true" /etc/wsl.conf 2>/dev/null; then
  echo "Enabling systemd in /etc/wsl.conf"
  printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf >/dev/null
  echo ">>> Now run 'wsl --shutdown' in PowerShell, reopen Ubuntu, and run this script again."
  exit 0
fi

# 2. Docker's official apt repository.
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
# shellcheck disable=SC1091
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Keep container logs from filling the disk.
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo
echo "Docker installed: $(docker --version 2>/dev/null || sudo docker --version)"
echo ">>> Close and reopen Ubuntu so the 'docker' group applies, then run: docker run --rm hello-world"
