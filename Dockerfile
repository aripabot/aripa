FROM oven/bun:1.3-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-alpine AS prod-deps

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN bun install --frozen-lockfile --production

FROM deps AS builder

COPY package.json bun.lock tsconfig.json config.template.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/docker/start_docker.sh ./scripts/docker/start_docker.sh

RUN bun run --cwd apps/web build

FROM oven/bun:1.3-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    CONFIG_PATH=/app/config.json \
    DATABASE_PATH=/app/data/aripa.sqlite \
    ARIPA_WEB_DASHBOARD_PORT=57262 \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S aripa && adduser -S aripa -G aripa

COPY --from=prod-deps --chown=aripa:aripa /app/node_modules ./node_modules
COPY --from=builder --chown=aripa:aripa /app/package.json /app/bun.lock /app/tsconfig.json /app/config.template.json ./
COPY --from=builder --chown=aripa:aripa /app/apps ./apps
COPY --from=builder --chown=aripa:aripa /app/packages ./packages
COPY --from=builder --chown=aripa:aripa /app/scripts/docker/start_docker.sh ./scripts/docker/start_docker.sh

RUN mkdir -p /app/data && \
    chmod +x /app/scripts/docker/start_docker.sh && \
    chown aripa:aripa /app/data

USER aripa

VOLUME ["/app/data"]

EXPOSE 57262

CMD ["./scripts/docker/start_docker.sh"]
