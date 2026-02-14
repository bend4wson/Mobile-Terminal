# ARCHITECTURE.md — System Architecture

## Overview

Terminal-Mobile is a self-hosted PWA that provides browser-based terminal access over WebSocket. Users authenticate via JWT, manage multiple terminal tabs, and can install the app on mobile. The server is exposed to the internet through a Cloudflare Tunnel.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Public Internet                      │
│                                                          │
│  Mobile/Desktop Browser (PWA)                            │
│  ┌────────────────────────────┐                          │
│  │  xterm.js  │  Tab UI      │                          │
│  │  Shortcut Bar │ Auth Forms │                          │
│  └──────┬─────────────┬───────┘                          │
│         │ WSS         │ HTTPS                            │
└─────────┼─────────────┼─────────────────────────────────┘
          │             │
    ┌─────▼─────────────▼─────┐
    │   Cloudflare Tunnel      │
    │   (cloudflared)          │
    └─────┬─────────────┬─────┘
          │             │
    ┌─────▼─────────────▼─────────────────────────────┐
    │              Express Server (:3000)               │
    │                                                   │
    │  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
    │  │  Static   │  │  Auth API  │  │  Helmet +    │  │
    │  │  Files    │  │  /api/auth │  │  Rate Limit  │  │
    │  └──────────┘  └─────┬─────┘  └──────────────┘  │
    │                      │                            │
    │               ┌──────▼──────┐                     │
    │               │  SQLite DB   │                     │
    │               │  (users +    │                     │
    │               │   sessions)  │                     │
    │               └─────────────┘                     │
    │                                                   │
    │  ┌──────────────────────────────────────────┐    │
    │  │         WebSocket Server (ws)             │    │
    │  │                                           │    │
    │  │  1. Client connects with JWT token        │    │
    │  │  2. Server validates token                │    │
    │  │  3. Server spawns/attaches node-pty       │    │
    │  │  4. Bidirectional I/O streaming           │    │
    │  └────────────┬─────────────────────────────┘    │
    │               │                                   │
    │  ┌────────────▼─────────────────────────────┐    │
    │  │       Terminal Manager                     │    │
    │  │                                           │    │
    │  │  User A: [pty-1] [pty-2] [pty-3]         │    │
    │  │  User B: [pty-1] [pty-2]                  │    │
    │  │                                           │    │
    │  │  Per-user isolation — users can only       │    │
    │  │  access their own PTY processes            │    │
    │  └───────────────────────────────────────────┘    │
    └───────────────────────────────────────────────────┘
```

## Components

### 1. Express Server (`/server/index.ts`)

The main entry point. Responsibilities:
- Serve static frontend files from `/client`
- Mount API routes (`/api/auth/register`, `/api/auth/login`)
- Apply security middleware (Helmet, rate limiting, input validation)
- Create and attach the WebSocket server to the HTTP server
- Initialize the SQLite database on startup

### 2. WebSocket Layer (`/server/services/websocket.ts`)

Handles real-time terminal I/O using the `ws` library, upgraded from the same HTTP server.

**Connection flow:**
1. Client opens `ws://host/ws?token=<JWT>&sessionId=<id>`
2. Server extracts and verifies the JWT from the query string
3. If `sessionId` refers to an existing session owned by this user, reattach to it
4. If no `sessionId` or it's a new session request, create a new PTY via Terminal Manager
5. Pipe PTY stdout → WebSocket (to client) and WebSocket messages → PTY stdin (from client)
6. On disconnect, keep the PTY alive for reconnection (with a configurable timeout)

**Message types (client → server):**
- `{ type: 'input', data: '...' }` — Keyboard input forwarded to PTY stdin
- `{ type: 'resize', cols: N, rows: N }` — Terminal resize event

**Message types (server → client):**
- `{ type: 'output', data: '...' }` — PTY stdout data
- `{ type: 'sessionId', id: '...' }` — Assigned session ID after connection

### 3. Terminal Manager (`/server/services/terminal-manager.ts`)

Manages the lifecycle of PTY processes. Each terminal session is scoped to a user.

**Data structure:**
```
Map<userId, Map<sessionId, { pty, createdAt, lastActivity }>>
```

**Operations:**
- `createSession(userId)` — Spawn a new PTY (bash/zsh), return a session ID
- `getSession(userId, sessionId)` — Retrieve an existing PTY (enforces ownership)
- `destroySession(userId, sessionId)` — Kill the PTY process and clean up
- `listSessions(userId)` — Return all active session IDs for a user
- `destroyAllSessions(userId)` — Clean up on user deletion or server shutdown

PTY processes are spawned as the host OS user running the server (never root). Default shell is read from the `SHELL` environment variable.

### 4. Auth Service (`/server/services/auth.ts`)

Handles user registration and login.

- **Register:** Hash password with bcrypt (12 rounds), store user in SQLite
- **Login:** Verify password against stored hash, return a signed JWT
- **JWT payload:** `{ userId, username, iat, exp }` — tokens expire after 24 hours
- **Middleware:** `authMiddleware` extracts the JWT from the `Authorization: Bearer <token>` header and attaches the decoded user to `req.user`

### 5. SQLite Database (`/server/db/`)

Single file database at `/data/terminal.db`. Uses better-sqlite3's synchronous API.

**Schema:**

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT DEFAULT 'Terminal',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

The `sessions` table tracks terminal tab metadata. The actual PTY processes live in memory (Terminal Manager). On server restart, stale session rows are cleaned up.

### 6. Frontend Client (`/client/`)

Vanilla HTML/CSS/JS served as static files. No build step required.

**Pages:**
- `login.html` — Login and registration forms
- `index.html` — Main terminal app (redirects to login if no valid JWT)

**Key frontend modules:**
- `js/terminal.js` — xterm.js initialization, WebSocket connection, input/output handling
- `js/tabs.js` — Tab creation, switching, closing, tab bar rendering
- `js/auth.js` — Login/register API calls, JWT storage (localStorage), redirect logic
- `js/shortcuts.js` — Mobile shortcut bar event handlers
- `js/app.js` — Main entry point, orchestration

**PWA assets:**
- `manifest.json` — App name, icons, theme color, `display: standalone`
- `sw.js` — Service worker for offline shell caching (cache app assets; terminal I/O obviously requires connectivity)

### 7. Tunnel Options (`/scripts/`)

Two tunnel options are available for exposing the server to the internet. Both provide HTTPS automatically with no port forwarding needed. They are completely independent and can coexist.

#### Option A: ngrok (Free — Recommended for Getting Started)

ngrok's free tier provides one permanent static domain per account (e.g., `something.ngrok-free.app`). The same URL persists across restarts, which is essential for PWA home screen installs.

**Setup:** `npm run tunnel:setup` — interactive script that:
1. Installs `ngrok` (if not present)
2. Saves the user's authtoken from the ngrok dashboard
3. Saves the user's free static domain to `.tunnel.env` (gitignored)

**Usage:** `npm run tunnel` — starts both the Node server and ngrok tunnel, prints the public URL, and cleanly shuts down both on Ctrl+C.

**Note:** ngrok's free tier shows an interstitial "Visit Site" page on first visit. Once the PWA is installed and the service worker caches the app shell, this doesn't appear on subsequent launches.

#### Option B: Cloudflare Tunnel (Requires a Domain)

A setup script (`setup-tunnel.sh`) automates:
1. Installing `cloudflared` (if not present)
2. Authenticating with Cloudflare (`cloudflared login`)
3. Creating a named tunnel
4. Configuring the tunnel to point to `http://localhost:3000`
5. Setting up DNS routing to a user-provided domain
6. Optionally installing `cloudflared` as a system service

## Data Flow: Keystroke to Output

```
1. User taps key on mobile keyboard or shortcut bar
2. Frontend captures keypress → sends { type: 'input', data: key } over WebSocket
3. WebSocket server receives message → looks up user's PTY by sessionId
4. Writes data to PTY stdin
5. PTY process executes (e.g., bash interprets the input)
6. PTY stdout emits output
7. Server reads PTY output → sends { type: 'output', data: output } over WebSocket
8. Frontend receives message → writes to xterm.js terminal instance
9. xterm.js renders the output on screen
```

## Security Boundaries

- **Auth boundary:** All API routes (except `/api/auth/*`) require a valid JWT. WebSocket connections require a valid JWT query parameter.
- **User isolation:** Terminal Manager enforces that a user can only access PTYs they created. Session IDs are UUIDs — not guessable.
- **Process isolation:** PTYs run as the host OS user. The server should never be run as root.
- **Network boundary:** Cloudflare Tunnel provides TLS encryption. The Express server only listens on localhost.
- **Input validation:** All API inputs are validated for type and length. WebSocket messages are validated for expected structure.
