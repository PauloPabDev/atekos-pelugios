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
# La API va entera en dist/main.js salvo argon2 (addon nativo). Su carpeta en el almacén de pnpm
# trae también el binario de esta plataforma (argon2-linux-x64-gnu); -L resuelve los enlaces.
RUN mkdir -p /out/node_modules && cp -rL "$(realpath apps/api/node_modules/@node-rs/argon2)/.." /out/node_modules/@node-rs

# Node, mongod y redis-server sin tabla de símbolos (strip): ~90 MB menos y funcionan igual.
FROM debian:bookworm-slim AS bins
RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends ca-certificates curl gnupg binutils; \
	curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-8.0.gpg; \
	echo 'deb [signed-by=/usr/share/keyrings/mongodb-8.0.gpg] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/8.0 main' > /etc/apt/sources.list.d/mongodb-8.0.list; \
	apt-get update; \
	apt-get install -y --no-install-recommends mongodb-org-server
COPY --from=base /usr/local/bin/node /out/node
COPY --from=redis:8.2-bookworm /usr/local/bin/redis-server /out/redis-server
RUN cp /usr/bin/mongod /out/ && strip --strip-unneeded /out/*

# Debian slim y no node:*-slim: así no vienen npm, corepack ni yarn, que en ejecución no se usan.
FROM debian:bookworm-slim AS prod
RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
	curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg; \
	echo 'deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list; \
	mkdir -p /etc/postgresql-common; \
	echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.conf; \
	apt-get update; \
	# curl queda para el HEALTHCHECK y trae libcurl4, que mongod necesita.
	apt-get install -y --no-install-recommends postgresql-17 tini; \
	apt-get purge -y --auto-remove gnupg ca-certificates; \
	# Dependencias declaradas que aquí no se usan: el JIT de Postgres (LLVM/Z3), el Perl de los wrappers
	# pg_ctlcluster (start.sh llama a los binarios) y los locales (el clúster es C: initdb corre sin LANG).
	dpkg --purge --force-depends libllvm19 libz3-4 perl perl-modules-5.36 libperl5.36 libjson-perl locales libc-l10n; \
	rm -rf /usr/lib/postgresql/17/lib/llvmjit* /usr/lib/postgresql/17/lib/bitcode \
		/usr/share/doc /usr/share/man /usr/share/info /usr/share/locale /usr/share/lintian \
		/var/lib/apt/lists/* /var/cache/apt/* /var/log/*; \
	groupadd --gid 1000 node; \
	useradd --uid 1000 --gid node --create-home --shell /bin/bash node; \
	# Un volumen nombrado montado en /data hereda este dueño al crearse.
	mkdir /data; \
	chown node:node /data
COPY --from=bins /out/ /usr/local/bin/
COPY --from=caddy:2.10-alpine /usr/bin/caddy /usr/local/bin/caddy
# Falla la build si las purgas de arriba dejaron a algún binario o extensión de Postgres sin una librería.
RUN ! ldd /usr/local/bin/* /usr/lib/postgresql/17/bin/* /usr/lib/postgresql/17/lib/*.so 2>&1 | grep 'not found'

ENV NODE_ENV=production \
	DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
	MONGO_URL=mongodb://127.0.0.1:27017 \
	REDIS_URL=redis://127.0.0.1:6379
WORKDIR /app
COPY --from=build /out/node_modules node_modules
COPY --from=build /repo/apps/api/dist dist
COPY apps/api/drizzle drizzle
COPY --from=build /repo/apps/web/dist /srv
COPY infra/single/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 infra/single/start.sh /usr/local/bin/start.sh
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=5 \
	CMD curl -fsS http://127.0.0.1:8080/api/v1/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "start.sh"]
