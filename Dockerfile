FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json tsup.config.ts vitest.config.ts ./
RUN npm install
RUN npm run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV COMMAND_GO_POOL_HOME=/data
ENV COMMAND_GO_POOL_HOST=0.0.0.0
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "dist/cli.js", "start"]
