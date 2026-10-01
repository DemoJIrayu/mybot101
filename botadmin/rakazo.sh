#!/bin/bash
# Rakazo control. Runs inside Ubuntu-24.04 as user rakazo (used by BotAdmin; also usable by hand):
#   wsl -d Ubuntu-24.04 -- bash /mnt/d/localai/botadmin/rakazo.sh status|start|stop|logs [service]|backup
# stop = non-destructive (never "down -v": that deletes the database and bot homes).
set -u
cd ~/rakazo || { echo "ERR ~/rakazo not found"; exit 1; }
# docker-compose.override.yml (local hotfixes) is included when present
dc() { docker compose --env-file .env -f docker-compose.images.yml $([ -f docker-compose.override.yml ] && echo "-f docker-compose.override.yml") "$@"; }
case "${1:-status}" in
  status)
    pgrep -fx 'sleep infinity' >/dev/null && echo "KEEPALIVE 1" || echo "KEEPALIVE 0"
    docker ps -a --filter label=com.docker.compose.project=rakazo --format 'C {{json .}}'
    docker ps -a --filter label=rakazo.managed=true --format 'B {{json .}}'
    docker stats --no-stream --format 'S {{json .}}'
    ;;
  # a recreated supervisor does not rejoin existing per-bot networks -> every computer_act times out (500)
  start) dc up -d --wait --wait-timeout 300 && for n in $(docker network ls -q --filter name=rakazo-computer-); do
           docker network connect "$n" rakazo-supervisor-1 2>/dev/null; done
         # demo-accounting lives in the worker's network namespace: a recreated worker leaves it on a dead one
         w=$(docker inspect -f '{{.Id}}' rakazo-worker-1 2>/dev/null)
         [ -z "$w" ] || [ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' rakazo-demo-accounting-1 2>/dev/null)" = "container:$w" ] ||
           dc up -d --no-deps --force-recreate --pull never demo-accounting; true ;;
  stop) dc stop ;;
  logs) dc logs --no-color --tail 200 "${2:-api}" ;;
  # published-image install has no scripts/backup.sh: same content (pg_dump + data volume) to D:localaiackups
  backup) d=/mnt/d/localai/backups/rakazo-$(date +%Y%m%d-%H%M%S); mkdir -p "$d" &&
          docker exec rakazo-postgres-1 pg_dump -U rakazo -d rakazo -Fc > "$d/rakazo.dump" &&
          docker run --rm -v rakazo_appdata:/data:ro -v "$d":/out busybox:1 tar czf /out/appdata.tgz -C /data . &&
          cp docker-compose.override.yml "$d/" && tar czf "$d/hotfix.tgz" hotfix computer-th demo-acct && echo "OK $d" && ls -la "$d" ||
          { echo "ERR backup failed: discard $d"; exit 1; } ;;
  *) echo "usage: rakazo.sh status|start|stop|logs [service]|backup"; exit 2 ;;
esac
