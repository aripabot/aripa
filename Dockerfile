FROM oven/bun:1.3-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN bun install 

FROM oven/bun:1.3-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    CONFIG_PATH=/app/config.json \
    DATABASE_PATH=/app/data/aripa.sqlite \
    ARIPA_WEB_DASHBOARD_PORT=57262 \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S aripa && adduser -S aripa -G aripa

COPY --from=deps --chown=aripa:aripa /app/node_modules ./node_modules
COPY --chown=aripa:aripa package.json bun.lock tsconfig.json config.template.json ./
COPY --chown=aripa:aripa apps ./apps
COPY --chown=aripa:aripa packages ./packages
COPY --chown=aripa:aripa scripts/docker/start_docker.sh ./scripts/docker/start_docker.sh

RUN bun run --cwd apps/web build && \
    mkdir -p /app/data && \
    chmod +x /app/scripts/docker/start_docker.sh && \
    chown aripa:aripa /app/data

USER aripa

VOLUME ["/app/data"]

EXPOSE 57262

CMD ["./scripts/docker/start_docker.sh"]
