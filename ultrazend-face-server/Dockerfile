# ========== STAGE 1: Build ==========
FROM node:22-alpine AS builder

RUN apk add --no-cache \
    python3 \
    make \
    g++

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install --legacy-peer-deps --prefer-offline --no-audit

COPY prisma ./prisma
COPY src ./src

ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN ./node_modules/.bin/prisma generate
RUN npm run build

# ========== STAGE 2: Production ==========
FROM node:22-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps --prefer-offline --no-audit

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY --from=builder /app/dist ./dist

RUN mkdir -p uploads logs

EXPOSE 9006

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9006/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["dumb-init", "--"]
CMD ["/app/docker-entrypoint.sh"]
