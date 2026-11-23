FROM node:22-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
CMD ["node", "dist/bot/index.js"]
