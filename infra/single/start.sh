#!/bin/bash
# Arranca los 5 procesos de la imagen única. Si uno termina, se paran todos y el contenedor sale
# (Coolify lo reinicia). Ante SIGTERM se detienen limpio, dentro de los 10 s de docker stop.
set -euo pipefail
PG=/usr/lib/postgresql/17/bin

mkdir -p /data/mongo /data/redis
# Primer arranque: initdb crea /data/postgres con permisos 0700. Solo escucha en 127.0.0.1, por eso trust.
[ -s /data/postgres/PG_VERSION ] || "$PG/initdb" -D /data/postgres -U postgres --auth=trust --encoding=UTF8 >/dev/null

# jit=off: la imagen no lleva LLVM (y con consultas tan pequeñas el JIT no compensa).
"$PG/postgres" -D /data/postgres -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c jit=off &
pg=$!
# Sin límite de memoria en el contenedor, la caché de WiredTiger se calcula sobre la RAM de todo el host (≈50 %).
# Sin FTDC: no escribe hasta 200 MB de diagnóstico en /data/mongo/diagnostic.data.
mongod --dbpath /data/mongo --bind_ip 127.0.0.1 --quiet --wiredTigerCacheSizeGB 0.25 \
	--setParameter diagnosticDataCollectionEnabled=false &
mongo=$!
redis-server --bind 127.0.0.1 --port 6379 --dir /data/redis --appendonly yes --save '' &
redis=$!

# Postgres INT = apagado rápido (TERM esperaría a que la API cierre su pool).
stop() {
	# Sin comillas a propósito: si api/caddy aún no arrancaron, desaparecen de la lista.
	kill -TERM ${api:-} ${caddy:-} "$mongo" "$redis" 2>/dev/null || true
	kill -INT "$pg" 2>/dev/null || true
	wait || true
}
trap 'stop; exit 0' TERM INT

# La API migra y conecta al arrancar: espera a que las tres bases acepten conexiones.
ready() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for _ in $(seq 120); do
	"$PG/pg_isready" -q -h 127.0.0.1 && ready 27017 && ready 6379 && break
	sleep 1
done

# PORT fijo: Coolify inyecta PORT con el puerto expuesto (8080, el de Caddy) y la API chocaría con él.
PORT=3000 node dist/main.js &
api=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy=$!

code=0
wait -n || code=$?
echo "start.sh: un proceso terminó (código $code); deteniendo el resto" >&2
stop
exit "$code"
