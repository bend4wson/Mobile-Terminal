# SPEC.md — Feature Specification

## 1. Multi-User Authentication

### 1.1 Registration

- **Endpoint:** `POST /api/auth/register`
- **Input:** `{ username, password }`
- **Validation:**
  - Username: 3–30 characters, alphanumeric and underscores only
  - Password: minimum 8 characters
  - Username must be unique (return 409 if taken)
- **Behavior:** Hash password with bcrypt (12 salt rounds), insert into `users` table, return a signed JWT
- **Response:** `{ token, user: { id, username } }`

### 1.2 Login

- **Endpoint:** `POST /api/auth/login`
- **Input:** `{ username, password }`
- **Validation:** Same input rules as registration
- **Behavior:** Look up user, verify password with bcrypt, return a signed JWT
- **Response:** `{ token, user: { id, username } }`
- **Rate limiting:** Max 10 attempts per IP per 15-minute window. Return 429 when exceeded.

### 1.3 JWT Tokens

- **Payload:** `{ userId, username, iat, exp }`
- **Expiry:** 24 hours
- **Storage:** Client stores the token in `localStorage`
- **Usage:**
  - HTTP requests: `Authorization: Bearer <token>` header
  - WebSocket: `?token=<token>` query parameter on connection URL

### 1.4 User Isolation

- Each user can only see and interact with their own terminal sessions
- All session operations (list, create, close) are scoped to the authenticated user's ID
- Attempting to access another user's session returns 403

---

## 2. Terminal Tab Management

### 2.1 Session Lifecycle

- **Create tab:** User clicks "+ New" button → client sends `POST /api/sessions` → server creates a PTY, inserts a session row in SQLite, returns the session ID → client opens a WebSocket to that session
- **Switch tab:** User taps a tab → client disconnects from current WebSocket → connects to the selected session's WebSocket → terminal output resumes from where it left off
- **Close tab:** User clicks the "×" on a tab → client sends `DELETE /api/sessions/:id` → server kills the PTY process, removes the session row → client removes the tab from the UI and switches to an adjacent tab
- **Reconnect:** If the WebSocket drops, the client automatically retries connection to the same session. The PTY stays alive on the server for up to 5 minutes after disconnect.

### 2.2 Session API

- `GET /api/sessions` — List all sessions for the authenticated user. Returns `[{ id, title, createdAt }]`
- `POST /api/sessions` — Create a new session. Returns `{ id, title, createdAt }`
- `DELETE /api/sessions/:id` — Close and destroy a session. Returns 204.
- `PATCH /api/sessions/:id` — Update session metadata (e.g., title). Returns updated session.

### 2.3 Tab UI

- Tab bar sits at the top of the screen, horizontally scrollable on mobile
- Each tab shows: session title (or "Terminal 1", "Terminal 2", etc.) and a close "×" button
- Active tab is visually highlighted
- A "+" button at the end of the tab bar creates a new session
- Maximum 10 concurrent tabs per user (return 400 if exceeded)

### 2.4 WebSocket Connection

- **URL:** `ws://host/ws?token=<JWT>&sessionId=<UUID>`
- **On open:** Server validates JWT, looks up session, attaches to PTY, begins streaming output
- **Client → Server messages:**
  - `{ type: 'input', data: string }` — Terminal input (keystrokes, pasted text)
  - `{ type: 'resize', cols: number, rows: number }` — Terminal dimensions changed
- **Server → Client messages:**
  - `{ type: 'output', data: string }` — Terminal output
- **On close:** PTY kept alive for reconnection (5 min timeout). After timeout, PTY is killed and session row removed.

---

## 3. Mobile UI

### 3.1 Layout

```
┌─────────────────────────────┐
│ [Tab 1] [Tab 2] [Tab 3] [+]│  ← Tab bar (scrollable)
├─────────────────────────────┤
│                             │
│                             │
│     Terminal Output         │  ← xterm.js (fills remaining space)
│     (xterm.js)              │
│                             │
│                             │
├─────────────────────────────┤
│ [y] [n] [C-c] [C-d] [Tab]  │  ← Shortcut bar row 1
│ [↑] [↓] [←] [→] [Esc]     │  ← Shortcut bar row 2
└─────────────────────────────┘
```

### 3.2 Shortcut Bar

Fixed at the bottom of the screen, above the mobile keyboard when visible. Two rows of buttons:

**Row 1 — Common inputs:**
| Button | Sends | Purpose |
|--------|-------|---------|
| `y` | `y` | Confirm prompts |
| `n` | `n` | Deny prompts |
| `Ctrl+C` | `\x03` | Interrupt/kill process |
| `Ctrl+D` | `\x04` | EOF / exit |
| `Tab` | `\t` | Autocomplete |

**Row 2 — Navigation:**
| Button | Sends | Purpose |
|--------|-------|---------|
| `↑` | `\x1b[A` | Command history / up |
| `↓` | `\x1b[B` | Command history / down |
| `←` | `\x1b[D` | Cursor left |
| `→` | `\x1b[C` | Cursor right |
| `Esc` | `\x1b` | Escape key |

### 3.3 Touch & Display

- Minimum touch target size: 44×44px (per Apple HIG)
- Tab bar uses large, tappable areas with generous padding
- Terminal font size defaults to 14px (readable on mobile)
- The terminal viewport uses `xterm-addon-fit` to fill available space and resizes on orientation change or keyboard show/hide
- No pinch-to-zoom on the terminal area (use `touch-action: manipulation`)
- Full-width layout, no horizontal scrolling except in the tab bar

### 3.4 Desktop Compatibility

- The same UI works on desktop browsers
- Shortcut bar is still visible on desktop (useful for quick access)
- Standard keyboard input works as expected in addition to the shortcut bar

---

## 4. PWA Requirements

### 4.1 Web App Manifest (`manifest.json`)

```json
{
  "name": "Terminal Mobile",
  "short_name": "Terminal",
  "description": "Self-hosted mobile terminal",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1e1e1e",
  "theme_color": "#1e1e1e",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 4.2 Service Worker (`sw.js`)

- **Strategy:** Cache app shell (HTML, CSS, JS, icons) on install. Network-first for API calls.
- **Cached assets:** `index.html`, `login.html`, `css/*`, `js/*`, `manifest.json`, icons
- **Not cached:** WebSocket connections, API responses (these require live connectivity)
- **Update:** On activation, delete old caches and claim clients immediately
- **Offline page:** When offline and no cached page is available, show a simple "You are offline — terminal requires a connection" message

### 4.3 Install Experience

- The app meets PWA installability criteria (manifest + service worker + HTTPS via Cloudflare)
- On supported browsers, the user gets the native "Add to Home Screen" prompt
- When launched from the home screen, it opens in standalone mode (no browser chrome)
- Status bar matches the terminal theme color (dark)

---

## 5. Security

### 5.1 HTTP Security Headers

Applied via Helmet:
- `Content-Security-Policy`: Restrict scripts to self, restrict connections to self and WSS
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security` (when behind Cloudflare)

### 5.2 Rate Limiting

- **Login endpoint:** 10 requests per IP per 15-minute window
- **Registration endpoint:** 5 requests per IP per 15-minute window
- **Session creation:** 10 requests per user per minute
- Returns `429 Too Many Requests` with a `Retry-After` header

### 5.3 Input Validation

- All API request bodies validated for expected fields, types, and lengths
- Reject unexpected fields (strict schema)
- WebSocket messages validated for `type` field and expected structure
- Session IDs validated as UUID format before database lookup

### 5.4 PTY Security

- PTY processes run as the OS user who started the server
- Server must not be run as root (check at startup, exit with error if UID is 0)
- No shell injection — user input goes directly to PTY stdin, never to `exec()` or `spawn()` arguments
- Default shell is read from `$SHELL` or falls back to `/bin/bash`

### 5.5 Database Security

- Passwords stored as bcrypt hashes (12 salt rounds), never plaintext
- Database file permissions set to 600 (owner read/write only)
- Use parameterized queries exclusively — no string concatenation in SQL

### 5.6 WebSocket Security

- JWT validated on every new WebSocket connection before any PTY interaction
- Invalid or expired tokens result in immediate connection close with code 4001
- No broadcasting — each WebSocket is a point-to-point connection between one client and one PTY

---

## 6. Deployment via Cloudflare Tunnel

### 6.1 Setup Script (`scripts/setup-tunnel.sh`)

Interactive script that walks the user through:

1. **Check prerequisites:** Ensure Node.js >= 18 is installed
2. **Install cloudflared:** Detect OS, download and install the appropriate binary (or prompt to install via package manager)
3. **Authenticate:** Run `cloudflared login` — opens a browser for Cloudflare dashboard auth
4. **Create tunnel:** Run `cloudflared tunnel create terminal-mobile` — generates a credentials file
5. **Configure routing:** Prompt for domain name, create a config file pointing `http://localhost:3000` to the tunnel
6. **Set up DNS:** Run `cloudflared tunnel route dns terminal-mobile <domain>` — creates a CNAME record
7. **Install as service (optional):** Offer to install `cloudflared` as a system service for auto-start on boot

### 6.2 Running in Production

```bash
# Start the app
NODE_ENV=production JWT_SECRET=<your-secret> npm start

# In a separate terminal (or as a service):
cloudflared tunnel run terminal-mobile
```

### 6.3 HTTPS

- Cloudflare Tunnel handles TLS termination automatically
- The Express server only listens on `localhost:3000` (HTTP)
- Cloudflare provides a valid HTTPS certificate for the configured domain
- No self-signed certs or Let's Encrypt setup required

### 6.4 Sharing

- This is a self-hosted app — each person runs their own instance
- To share: point a friend to the repo with setup instructions
- Each instance is independent with its own user database and tunnel
