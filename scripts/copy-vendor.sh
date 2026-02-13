#!/bin/bash
# Copy xterm.js vendor files to client directory
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
CLIENT_JS="$ROOT/client/js"
CLIENT_CSS="$ROOT/client/css"

mkdir -p "$CLIENT_JS" "$CLIENT_CSS"

cp "$ROOT/node_modules/@xterm/xterm/lib/xterm.js" "$CLIENT_JS/xterm.js"
cp "$ROOT/node_modules/@xterm/xterm/css/xterm.css" "$CLIENT_CSS/xterm.css"
cp "$ROOT/node_modules/@xterm/addon-fit/lib/addon-fit.js" "$CLIENT_JS/xterm-addon-fit.js"
cp "$ROOT/node_modules/@xterm/addon-web-links/lib/addon-web-links.js" "$CLIENT_JS/xterm-addon-web-links.js"

echo "Vendor files copied to client/"
