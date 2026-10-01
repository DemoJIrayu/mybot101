#!/bin/bash
# Applied by rakazo-lan-block.service after docker starts. Remove: --remove
set -e
apply() { # $1 = iptables|ip6tables, rest = blocked destinations
  local t=$1; shift
  $t -D DOCKER-USER -i docker0 -j RAKAZO-LAN-BLOCK 2>/dev/null || true
  $t -D DOCKER-USER -i br-+ -j RAKAZO-LAN-BLOCK 2>/dev/null || true
  $t -F RAKAZO-LAN-BLOCK 2>/dev/null || true; $t -X RAKAZO-LAN-BLOCK 2>/dev/null || true
  [ "$REMOVE" = 1 ] && return
  $t -N RAKAZO-LAN-BLOCK
  $t -A RAKAZO-LAN-BLOCK -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  $t -A RAKAZO-LAN-BLOCK -o docker0 -j RETURN   # container <-> container stays under Docker's own rules
  $t -A RAKAZO-LAN-BLOCK -o br-+ -j RETURN
  for d in "$@"; do $t -A RAKAZO-LAN-BLOCK -d "$d" -j DROP; done
  $t -I DOCKER-USER -i docker0 -j RAKAZO-LAN-BLOCK
  $t -I DOCKER-USER -i br-+ -j RAKAZO-LAN-BLOCK
}
[ "$1" = "--remove" ] && REMOVE=1
apply iptables 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 224.0.0.0/4 0.0.0.0/8
apply ip6tables fc00::/7 fe80::/10 ff00::/8
