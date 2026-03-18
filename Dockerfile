# Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production=false

# Copy source
COPY . .

# Build frontend
RUN bun run build

# Production
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

# Create DB directory
RUN mkdir -p /data/db

ENV NODE_ENV=production
ENV CT_DATA_DIR=/data

EXPOSE 3000

CMD ["bun", "dist/server/index.js"]
