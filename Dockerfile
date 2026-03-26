FROM node:20-alpine
RUN apk add --no-cache git chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
RUN npm install -g pnpm@10
ARG RAILWAY_GIT_COMMIT_SHA=unknown
RUN echo "Building commit: $RAILWAY_GIT_COMMIT_SHA"
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN BASE_PATH=/ pnpm --filter @workspace/web build
RUN pnpm --filter @workspace/api-server build
RUN chmod +x /app/start.sh
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 3000
CMD ["/bin/sh", "/app/start.sh"]
