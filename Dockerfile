FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV VIDEO_DATA_DIR=/data
ENV VIDEO_STATIC_DIR=/app/dist

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY src/content ./src/content
COPY src/lib ./src/lib

RUN mkdir -p /data

EXPOSE 8080
VOLUME ["/data"]

CMD ["node", "server/index.js"]
