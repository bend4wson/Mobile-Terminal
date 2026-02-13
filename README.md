# Terminal Mobile

A self-hosted PWA terminal app. Access your server's terminal from any device — phone, tablet, or desktop — through a secure web interface.

## Features

- **Web-based terminal** using xterm.js and node-pty
- **Multiple tabs** — create, switch, and close terminal sessions
- **Multi-user auth** — each user gets isolated sessions (JWT-based)
- **Mobile-optimized** — large touch targets, shortcut bar (Ctrl+C, arrows, Tab, etc.)
- **Installable PWA** — add to home screen, opens in standalone mode
- **Cloudflare Tunnel** — secure HTTPS access with no port forwarding

## Tech Stack

- Node.js, Express, WebSocket (`ws`), `node-pty`
- SQLite via `better-sqlite3`
- xterm.js on the frontend
- bcrypt + JWT for auth
- Helmet + rate limiting for security

## Quick Start

```bash
# Clone and install
git clone <your-repo-url> terminal-mobile
cd terminal-mobile
npm install

# Start in development mode
npm run dev
```

Open `http://localhost:3000` in your browser. Register a new account and start using the terminal.

## Production Setup

### 1. Build and run

```bash
npm run build
NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) npm start
```

### 2. Access from your phone

**Quick tunnel (free, no domain needed):**

```bash
# Install cloudflared
brew install cloudflared

# Terminal 1: Start the app
npm run dev

# Terminal 2: Start a quick tunnel
cloudflared tunnel --url http://localhost:3000
```

This prints a `https://random-words.trycloudflare.com` URL. Open it on your phone — works instantly with HTTPS. The URL changes each time you restart the tunnel.

**Permanent domain (optional):**

```bash
bash scripts/setup-tunnel.sh
```

The script walks you through setting up a named tunnel with your own domain. After setup:

```bash
# Terminal 1: Start the app
NODE_ENV=production JWT_SECRET=<your-secret> npm start

# Terminal 2: Start the tunnel
cloudflared tunnel run terminal-mobile
```

Your app is now live at `https://your-domain.com`.

### 3. Install as PWA

On your phone, open the tunnel URL, then:
- **iOS Safari:** Tap Share > "Add to Home Screen"
- **Android Chrome:** Tap the install prompt or Menu > "Add to Home Screen"

The app opens in standalone mode (no browser chrome) and looks like a native app.

## Adding Users

Users self-register through the web interface at `/login.html`. There is no admin panel — each user creates their own account.

To restrict registration, you can set a lower rate limit or disable the register endpoint after creating your accounts.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `JWT_SECRET` | (auto in dev) | Secret for signing JWTs. **Required in production.** |
| `NODE_ENV` | `development` | Set to `production` for production mode |

## Project Structure

```
server/          — TypeScript backend
  routes/        — API route handlers
  middleware/    — Auth, rate limiting, validation
  services/      — Terminal manager, auth, WebSocket
  db/            — SQLite database layer
client/          — Static frontend
  js/            — App JavaScript modules
  css/           — Stylesheets
  icons/         — PWA icons
scripts/         — Setup and utility scripts
data/            — SQLite database (gitignored)
```

## Sharing With a Friend

This is a self-hosted app — each person runs their own instance. To share:

1. Point your friend to this repo
2. They clone it and run `npm install && npm run dev`
3. They set up their own Cloudflare Tunnel (or just use it on localhost)
4. Each instance has its own user database and is fully independent

## Security

- Passwords hashed with bcrypt (12 rounds)
- JWT auth for HTTP and WebSocket
- Helmet security headers
- Rate limiting on auth endpoints
- Terminal processes run as the host OS user (never root)
- Server refuses to start if run as root
- All SQL uses parameterized queries

## License

MIT
