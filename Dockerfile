# =============================================================
# Stage 1: Build Client & Server
# =============================================================
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# =============================================================
# Stage 2: Runtime environment
# =============================================================
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy package descriptors for dependency installation
COPY package*.json ./

# Install native dependencies for building better-sqlite3 inside the container
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && npm ci --only=production \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy built bundles from the builder stage
COPY --from=builder /app/dist ./dist

# Create database volume directory
RUN mkdir -p /app/data
VOLUME /app/data

ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/server/index.js"]
