FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @atekos/web...

FROM deps AS dev
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
WORKDIR /repo/apps/web
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

FROM dev AS build
RUN pnpm build

# --- proxy de desarrollo: reenvía a Vite
FROM caddy:2.10-alpine AS proxy-dev
COPY infra/proxy/Caddyfile.dev /etc/caddy/Caddyfile

# --- proxy de producción: sirve el build y reenvía /api y /ws
FROM caddy:2.10-alpine AS prod
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
