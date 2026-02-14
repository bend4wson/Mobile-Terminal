# Terminal Mobile

Access your laptop's terminal from your phone. Self-hosted, works over the internet, installable as an app on your home screen.

## Setup

You need [Node.js](https://nodejs.org/) 18+ and a free [ngrok account](https://dashboard.ngrok.com/signup).

```bash
git clone <your-repo-url> terminal-mobile
cd terminal-mobile
npm install
npm run tunnel:setup
```

The setup script installs ngrok and walks you through pasting your authtoken and free static domain from the ngrok dashboard. You only run this once.

## Start

```bash
npm run tunnel
```

Open the printed URL on your phone, create an account, and you're in. Press `Ctrl+C` to stop. The URL stays the same every time you restart.

## Install on your phone

On the login page, tap **Share > Add to Home Screen** (Safari) or **Install** (Chrome). The app opens like a native app and uses your permanent ngrok domain.

## Local only

If you just want to use it on your local network without a tunnel:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `JWT_SECRET` | auto-generated in dev | Secret for signing JWTs |
| `NODE_ENV` | `development` | Set to `production` for production builds |

## Production build

```bash
npm run build
NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) npm run tunnel
```

## Security

- Passwords hashed with bcrypt
- JWT auth on all endpoints and WebSocket connections
- Helmet security headers + rate limiting
- Terminal processes run as the host OS user (never root)
- Each user's terminal sessions are isolated

## License

MIT
