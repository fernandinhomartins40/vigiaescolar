FROM node:22-alpine AS build

WORKDIR /app

COPY package.json tsconfig.json tsconfig.build.json ./
RUN npm install --no-audit --prefer-offline

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

RUN apk add --no-cache dumb-init ffmpeg

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/snapshots

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
