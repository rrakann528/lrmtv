FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@10
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN BASE_PATH=/ pnpm --filter @workspace/web build
RUN pnpm --filter @workspace/api-server build
EXPOSE ${PORT:-3000}
CMD ["node", "artifacts/api-server/dist/index.cjs"]
