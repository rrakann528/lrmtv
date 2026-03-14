#!/bin/sh

echo "[start] DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo YES || echo NO)"

if [ -n "$DATABASE_URL" ]; then
  echo "[start] Running database migrations..."
  node /app/migrate.cjs
  STATUS=$?
  if [ $STATUS -eq 0 ]; then
    echo "[start] Migrations completed successfully."
  else
    echo "[start] Migration failed with status $STATUS — starting server anyway."
  fi
else
  echo "[start] No DATABASE_URL — skipping migrations."
fi

echo "[start] Starting server..."
exec node /app/artifacts/api-server/dist/index.cjs
