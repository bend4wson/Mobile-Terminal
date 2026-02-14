#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.tunnel.env"
PORT="${PORT:-3000}"

# Load tunnel config
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .tunnel.env not found. Run 'npm run tunnel:setup' first."
  exit 1
fi

source "$ENV_FILE"

if [ -z "$NGROK_DOMAIN" ]; then
  echo "ERROR: NGROK_DOMAIN not set in .tunnel.env. Run 'npm run tunnel:setup' first."
  exit 1
fi

echo "================================="
echo "  Terminal Mobile + ngrok"
echo "================================="
echo ""
echo "  Server:  http://localhost:$PORT"
echo "  Public:  https://$NGROK_DOMAIN"
echo ""

# Track child PIDs
SERVER_PID=""
NGROK_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$NGROK_PID" ] && kill "$NGROK_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Done."
  exit 0
}

trap cleanup SIGINT SIGTERM

# Start the server
if [ "$NODE_ENV" = "production" ]; then
  echo "Starting production server..."
  node "$PROJECT_DIR/dist/index.js" &
  SERVER_PID=$!
else
  echo "Starting dev server..."
  npx tsx watch "$PROJECT_DIR/server/index.ts" &
  SERVER_PID=$!
fi

# Wait briefly for server to start
sleep 2

# Start ngrok
echo "Starting ngrok tunnel..."
ngrok http --domain="$NGROK_DOMAIN" "$PORT" --log=stdout &
NGROK_PID=$!

echo ""
echo "  Both processes running. Press Ctrl+C to stop."
echo ""

# Wait for either process to exit using portable polling
# (bash 3.2 on macOS doesn't support 'wait -n')
while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server process exited."
    cleanup
  fi
  if ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "ngrok process exited."
    cleanup
  fi
  sleep 1
done
