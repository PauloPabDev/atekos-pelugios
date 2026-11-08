# Imagen única para Coolify: Postgres 17, MongoDB 8.0, Redis 8.2, la API y Caddy con la web en un solo contenedor.
# Las bases escuchan solo en 127.0.0.1; lo único expuesto es Caddy en :8080 (Coolify pone el HTTPS delante).
# Datos persistentes en /data: monta ahí un volumen. Variable obligatoria: TOKEN_PEPPER (≥ 32 caracteres).
# Base Debian (no Alpine): MongoDB no publica binarios para musl y argon2 debe compilarse con la misma libc que corre.

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @atekos/api... --filter @atekos/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @atekos/api build && pnpm --filter @atekos/web build

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @atekos/api...

FROM redis:8.2-bookworm AS redis
FROM caddy:2.10-alpine AS caddy

FROM node:24-bookworm-slim AS prod
# Postgres y MongoDB desde sus repos oficiales firmados; sin cluster «main» automático de postgresql-common.
RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends ca-certificates curl gnupg tini libssl3; \
	curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg; \
	echo 'deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list; \
	curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-8.0.gpg; \
	echo 'deb [signed-by=/usr/share/keyrings/mongodb-8.0.gpg] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/8.0 main' > /etc/apt/sources.list.d/mongodb-8.0.list; \
	mkdir -p /etc/postgresql-common; \
	echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.conf; \
	apt-get update; \
	apt-get install -y --no-install-recommends postgresql-17 mongodb-org-server; \
	apt-get purge -y gnupg; \
	apt-get autoremove -y; \
	rm -rf /var/lib/apt/lists/*
COPY --from=redis /usr/local/bin/redis-server /usr/local/bin/redis-server
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
	MONGO_URL=mongodb://127.0.0.1:27017 \
	REDIS_URL=redis://127.0.0.1:6379
WORKDIR /repo
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
COPY --from=build /repo/apps/web/dist /srv
COPY infra/single/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 infra/single/start.sh /usr/local/bin/start.sh
# Un volumen nombrado montado en /data hereda este dueño al crearse.
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /repo/apps/api
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=5 \
	CMD curl -fsS http://127.0.0.1:8080/api/v1/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "start.sh"]
