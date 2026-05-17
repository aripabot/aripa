FROM oven/bun:1.2-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.2-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    CONFIG_PATH=/app/config.json \
    DATABASE_PATH=/app/data/aripa.sqlite

RUN addgroup -S aripa && adduser -S aripa -G aripa

COPY --from=deps --chown=aripa:aripa /app/node_modules ./node_modules
COPY --chown=aripa:aripa package.json bun.lock tsconfig.json config.template.json ./
COPY --chown=aripa:aripa src ./src

RUN mkdir -p /app/data && chown aripa:aripa /app/data

USER aripa

VOLUME ["/app/data"]

CMD ["bun", "run", "start"]
