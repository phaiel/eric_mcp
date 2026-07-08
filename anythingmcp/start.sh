#!/bin/sh
# =============================================================================
# AnythingMCP — Unified container startup script
# Runs NestJS backend and Next.js frontend in the same container.
# =============================================================================

NOTION_PID=""

# Trap to clean up child processes on exit
cleanup() {
  echo "==> Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" "$NOTION_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" "$NOTION_PID" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# PaaS (Render, Railway, etc.): public traffic hits the frontend on $PORT;
# Next.js rewrites proxy /api, /mcp, /health to the backend on BACKEND_PORT.
BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
if [ -n "$RENDER" ]; then
  FRONTEND_PORT="${PORT:-3000}"
fi

# Auto-configure public URLs when Render injects RENDER_EXTERNAL_URL
if [ -n "$RENDER_EXTERNAL_URL" ]; then
  export SERVER_URL="${SERVER_URL:-$RENDER_EXTERNAL_URL}"
  export FRONTEND_URL="${FRONTEND_URL:-$RENDER_EXTERNAL_URL}"
  export NEXTAUTH_URL="${NEXTAUTH_URL:-$RENDER_EXTERNAL_URL}"
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-$RENDER_EXTERNAL_URL}"
  export CORS_ORIGIN="${CORS_ORIGIN:-$RENDER_EXTERNAL_URL}"
fi
export BACKEND_INTERNAL_URL="${BACKEND_INTERNAL_URL:-http://127.0.0.1:${BACKEND_PORT}}"

if [ -z "$DATABASE_URL" ]; then
  echo "==> ERROR: DATABASE_URL is not set. Configure it in Render env vars and redeploy."
  exit 1
fi

echo "==> Running database migrations..."
cd /app/backend
npx prisma migrate deploy

# Optional Notion MCP sidecar for PAT-based MCP Bridge (see docs/render-deploy.md).
if [ -n "$NOTION_TOKEN" ]; then
  NOTION_MCP_PORT="${NOTION_MCP_PORT:-3001}"
  if [ -z "$NOTION_MCP_AUTH_TOKEN" ]; then
    echo "==> ERROR: NOTION_TOKEN is set but NOTION_MCP_AUTH_TOKEN is missing."
    exit 1
  fi
  echo "==> Starting Notion MCP sidecar (127.0.0.1:${NOTION_MCP_PORT})..."
  npx -y @notionhq/notion-mcp-server --transport http \
    --port "$NOTION_MCP_PORT" \
    --host 127.0.0.1 \
    --auth-token "$NOTION_MCP_AUTH_TOKEN" &
  NOTION_PID=$!
fi

echo "==> Starting backend (port ${BACKEND_PORT})..."
# Cap the V8 heap so a runaway allocation fails *this* process (caught by the
# liveness loop below → container restart) instead of OOM-killing the whole host.
# Override via NODE_MAX_OLD_SPACE_MB; default 2048 suits a ~4GB host.
PORT="${BACKEND_PORT}" node --max-old-space-size="${NODE_MAX_OLD_SPACE_MB:-2048}" dist/src/main.js &
BACKEND_PID=$!

echo "==> Starting frontend (port ${FRONTEND_PORT})..."
# Next.js standalone in a monorepo preserves the workspace directory structure
cd /app/frontend/packages/frontend
HOSTNAME=0.0.0.0 PORT="${FRONTEND_PORT}" node server.js &
FRONTEND_PID=$!

echo "==> AnythingMCP running — backend PID=$BACKEND_PID (port ${BACKEND_PORT}), frontend PID=$FRONTEND_PID (port ${FRONTEND_PORT})"

# If EITHER process dies (e.g. the backend is OOM-killed), exit so Docker's
# `restart: unless-stopped` brings the container back — instead of leaving a
# half-broken container up (a dead backend behind a live frontend serving 502s,
# which previously needed a manual restart). POSIX `wait pid1 pid2` waits for
# BOTH to exit, so we poll liveness instead.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 5
done
echo "==> A process exited unexpectedly, shutting down so the container restarts..."
cleanup
