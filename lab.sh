#!/usr/bin/env bash
set -euo pipefail

for tool in ip wg ping; do
  command -v "$tool" >/dev/null || { echo "Falta instalar: $tool" >&2; exit 1; }
done
if (( EUID != 0 )); then
  echo "Ejecuta con sudo bash lab.sh en Linux." >&2
  exit 1
fi

umask 077
keys=$(mktemp -d)
server="wg-server-$$"
client="wg-client-$$"
created=()
cleanup() {
  for namespace in "${created[@]}"; do
    ip netns del "$namespace"
  done
  rm -rf -- "$keys"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for namespace in "$server" "$client"; do
  ip netns add "$namespace"
  created+=("$namespace")
  ip -n "$namespace" link set lo up
  ip -n "$namespace" link add wg0 type wireguard
done

ip -n "$server" link add transport type veth peer name transport netns "$client"
ip -n "$server" addr add 192.0.2.1/30 dev transport
ip -n "$client" addr add 192.0.2.2/30 dev transport
ip -n "$server" link set transport up
ip -n "$client" link set transport up

wg genkey > "$keys/server"
wg genkey > "$keys/client"
server_public=$(wg pubkey < "$keys/server")
client_public=$(wg pubkey < "$keys/client")

ip netns exec "$server" wg set wg0 private-key "$keys/server" listen-port 51820 \
  peer "$client_public" allowed-ips 10.77.0.2/32
ip netns exec "$client" wg set wg0 private-key "$keys/client" \
  peer "$server_public" allowed-ips 10.77.0.1/32 endpoint 192.0.2.1:51820

ip -n "$server" addr add 10.77.0.1/32 dev wg0
ip -n "$client" addr add 10.77.0.2/32 dev wg0
ip -n "$server" link set wg0 up
ip -n "$client" link set wg0 up
ip -n "$server" route add 10.77.0.2/32 dev wg0
ip -n "$client" route add 10.77.0.1/32 dev wg0

ip netns exec "$client" ping -I wg0 -c 3 -w 8 10.77.0.1
read -r _ handshake < <(ip netns exec "$client" wg show wg0 latest-handshakes)
[[ "$handshake" =~ ^[1-9][0-9]*$ ]]
printf 'OK: el túnel responde y WireGuard registró el handshake.\n'

ip netns exec "$server" wg set wg0 peer "$client_public" remove
[[ -z "$(ip netns exec "$server" wg show wg0 peers)" ]]
if ip netns exec "$client" ping -I wg0 -c 1 -W 2 10.77.0.1; then
  echo "Error: el cliente revocado sigue recibiendo respuesta." >&2
  exit 1
else
  ping_status=$?
  if (( ping_status != 1 )); then
    echo "Error al ejecutar la prueba de revocación (ping: $ping_status)." >&2
    exit "$ping_status"
  fi
fi
printf 'OK: el servidor revocó el acceso del cliente.\n'
