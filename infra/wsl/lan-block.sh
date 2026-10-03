#!/usr/bin/env bash
# Stop agent sandboxes from reaching your home/office LAN (router, NAS, other PCs).
# They can still reach the internet (package registries, GitHub).
# Run inside WSL after `docker compose up`:  sudo bash infra/wsl/lan-block.sh
set -euo pipefail

SANDBOX_NET="172.30.0.0/24"   # must match the subnet of 'sandbox-net' in docker-compose.yml

# Start clean so the script is safe to re-run.
iptables -F DOCKER-USER
# Allow traffic inside the agent network and replies.
iptables -A DOCKER-USER -s "$SANDBOX_NET" -d "$SANDBOX_NET" -j RETURN
iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# Block private ranges.
for range in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16; do
  iptables -A DOCKER-USER -s "$SANDBOX_NET" -d "$range" -j DROP
done
iptables -A DOCKER-USER -j RETURN

echo "LAN block active for $SANDBOX_NET:"
iptables -L DOCKER-USER -n --line-numbers
