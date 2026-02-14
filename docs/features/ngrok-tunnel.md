# Feature: ngrok Tunnel (Free Persistent Domain)

**Status:** Complete

## What

Add ngrok as a free alternative to Cloudflare Tunnel for exposing the app to the internet. ngrok's free tier provides one permanent static domain per account (e.g., `something.ngrok-free.app`), giving users a stable HTTPS URL that persists across restarts — essential for PWA home screen installs.

## Why

The existing Cloudflare Tunnel setup requires a purchased domain. Quick tunnels give random URLs that change every restart, breaking PWA home screen installs. ngrok's free tier solves this by providing a permanent static domain at no cost with HTTPS included.

## Where

| File | Action |
|------|--------|
| `docs/features/ngrok-tunnel.md` | Create — this feature doc |
| `scripts/setup-ngrok.sh` | Create — one-time interactive setup |
| `scripts/start-tunnel.sh` | Create — starts server + ngrok together |
| `.gitignore` | Modify — add `.tunnel.env` |
| `package.json` | Modify — add `tunnel:setup` and `tunnel` scripts |
| `ARCHITECTURE.md` | Modify — add ngrok as tunnel option |

## How

- **Setup script** (`setup-ngrok.sh`): Checks/installs ngrok (Homebrew on macOS, direct download on Linux), prompts user for authtoken and static domain from the ngrok dashboard, validates domain format, saves config to `.tunnel.env`. Idempotent — safe to re-run.
- **Start script** (`start-tunnel.sh`): Sources `.tunnel.env`, starts the Node server and ngrok tunnel side by side, traps signals for clean shutdown. Uses `kill -0` polling for bash 3.2 compatibility on macOS.
- **Config file** (`.tunnel.env`): Simple `KEY=VALUE` file at project root, gitignored. Stores `NGROK_DOMAIN`.
- **npm scripts**: `tunnel:setup` (run once) and `tunnel` (run every time).

## Tasks

- [x] Create `docs/features/ngrok-tunnel.md`
- [x] Create `scripts/setup-ngrok.sh`
- [x] Create `scripts/start-tunnel.sh`
- [x] Update `.gitignore` — add `.tunnel.env`
- [x] Update `package.json` — add tunnel scripts
- [x] Update `ARCHITECTURE.md` — add ngrok section

## Risks

- **ngrok free tier interstitial:** First visit shows a "Visit Site" page. Once the PWA is installed and the service worker caches the app shell, this doesn't appear on subsequent launches.
- **macOS bash 3.2:** Using portable `kill -0` polling instead of `wait -n` for compatibility.
- **No conflict with Cloudflare:** Completely independent — different binaries, configs, and npm scripts. Both can coexist.
