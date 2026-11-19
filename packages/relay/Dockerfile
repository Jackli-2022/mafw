FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund \
  && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/dist ./dist
RUN npm install --omit=dev --no-audit --no-fund \
  && mkdir -p /data \
  && chown -R node:node /data /app
USER node
EXPOSE 443 8444 8080
CMD ["node", "dist/index.js"]
