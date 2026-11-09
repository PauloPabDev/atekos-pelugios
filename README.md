# atekos-pelugios

Domótica: una API (Express 5 + WebSocket) sobre PostgreSQL, MongoDB y Redis, una web en React + Vite y Caddy delante. El diseño y las decisiones están en [`docs/`](docs/GUIA_REPLICA_DOMOTICA.md).

## Requisitos

- Node 24 y pnpm vía corepack (`corepack enable`; la versión sale de `packageManager`).
- Docker con Compose.

## Configuración

```bash
cp .env.example .env
for k in POSTGRES_PASSWORD MONGO_PASSWORD REDIS_PASSWORD; do sed -i "s|^$k=.*|$k=$(openssl rand -hex 24)|" .env; done
sed -i "s|^TOKEN_PEPPER=.*|TOKEN_PEPPER=$(openssl rand -base64 48)|" .env
```

`.env` no se versiona. En dev, los puertos de BD del host (`PG_PORT`, `MONGO_PORT`, `REDIS_PORT`) también se ajustan ahí.

## Desarrollo

```bash
pnpm install
pnpm dev        # todo en Docker con hot reload → http://localhost:8080
pnpm dev:down   # lo para; los datos se conservan
pnpm test       # Vitest; los tests de integración usan Testcontainers (necesitan Docker)
pnpm lint
pnpm typecheck
```

## Despliegue

En el servidor, pon `DOMAIN=casa.tudominio.com` en `.env`, con el DNS apuntando a la máquina y los puertos 80 y 443 libres. Caddy saca el certificado solo.

```bash
pnpm prod       # build + up -d
pnpm prod:logs
```

## Backup

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
docker compose exec -T mongo sh -c 'mongodump --archive -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' > mongo.archive
```

> **Cuidado:** `docker compose … down` conserva los datos, pero `down -v` borra los volúmenes (PostgreSQL, MongoDB, Redis y los certificados de Caddy) y no hay vuelta atrás.

## IA (MCP)

La API trae un servidor MCP en `/api/v1/mcp` con OAuth 2.1, para que un asistente (Claude Code, claude.ai, Cursor…) cree dispositivos y pantallas y actualice sus datos. Para activarlo se pone `PUBLIC_URL` (dev y compose ya lo traen; en Coolify hay que añadirlo). Luego se conecta el cliente:

```bash
claude mcp add --transport http --scope user atekos https://atekos.toxolinko.site/api/v1/mcp
```

Funcionamiento, herramientas, permisos y seguridad: [`docs/MCP.md`](docs/MCP.md).

## Contrato de las pantallas

El contrato MetaDisplay (WSS `/ws/device` y REST `/api/v1/displays`) se genera de los esquemas zod de `packages/shared`. Se publica en la página [`/contrato`](https://atekos.toxolinko.site/contrato) (versión y última actualización), en `/api/v1/contract/{asyncapi,openapi}.json` y en el MCP. Cómo añadir una feature a partir del contrato: [`docs/metadisplay/README.md`](docs/metadisplay/README.md). Después de cambiar los esquemas, se ejecuta `pnpm contract`.

## Firmware

El contrato para el ESP8266 (token ligado al dispositivo, polling o WebSocket) está en la [§13 de la guía](docs/GUIA_REPLICA_DOMOTICA.md#13-contrato-para-el-firmware-esp8266).
