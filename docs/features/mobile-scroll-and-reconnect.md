# Feature: Mobile Scroll & Reconnect Persistence

**Status:** Proposed

## What

Fix two related mobile UX issues: (1) terminal output should be scrollable via touch on mobile devices, and (2) terminal output should not disappear when the phone screen is locked/unlocked or the app is backgrounded and reopened.

## Why

Currently, users can't scroll back through terminal history on mobile, and reconnecting after a screen lock wipes all visible output — making the app feel broken on phones.

## Where

Files modified:

- `client/js/terminal.js` — Reconnect without destroying terminal; add visibility change handler; enable scrollback
- `client/css/style.css` — Fix touch-action on terminal viewport to allow xterm.js touch scrolling
- `server/services/terminal-manager.ts` — Add circular output buffer per session
- `server/services/websocket.ts` — Replay buffered output on reconnection

## How

### 1. Mobile Touch Scrolling

xterm.js supports touch scrolling natively, but the current CSS sets `touch-action: manipulation` on `html, body` and `overflow: hidden` on `.terminal-container`. This may interfere with xterm.js's internal touch scroll handling.

Fix:
- Keep `touch-action: manipulation` on `html, body` (prevents double-tap zoom)
- Remove `overflow: hidden` from `.terminal-container` and instead let xterm.js manage its own viewport scrolling
- Explicitly set `scrollback: 5000` in the xterm.js Terminal options (up from default 1000) for more scrollback history

### 2. Server-Side Output Buffer

Add a circular buffer to each terminal session that captures PTY output. When a client reconnects to an existing session, the server replays the buffer before streaming live output.

- Buffer size: 100KB per session (enough for ~2000+ lines of typical terminal output)
- Stored as a simple string that gets trimmed from the front when it exceeds the limit
- Added to the `TerminalSession` interface in `terminal-manager.ts`
- Buffer is populated by a persistent `onData` listener attached when the PTY is created (not per-WebSocket)

### 3. Client-Side Reconnect Without Destroying Terminal

Rework `terminal.js` so that reconnecting to the **same** session preserves the xterm.js instance:

- Keep the `term` and `fitAddon` alive when only the WebSocket disconnects
- On reconnect, reuse the existing terminal — just create a new WebSocket
- Only dispose the terminal when **switching tabs** (different session) or **closing a tab**
- Add a `visibilitychange` listener: when the page becomes visible, check WebSocket state and reconnect immediately if closed (don't wait for the 2s timer)

### 4. Replay Protocol

When the server sends buffered output on reconnect, it uses the existing `{ type: 'output', data }` message — no protocol changes needed. The buffer is sent as a single message before live streaming begins. The client receives it like normal output and xterm.js renders it.

To avoid the client seeing duplicate output (buffer overlaps with what's already on screen), the client should `term.clear()` before the replay when reconnecting, OR the server can send a marker message `{ type: 'replay-start' }` and `{ type: 'replay-end' }` so the client knows to clear first.

Chosen approach: The client clears the terminal and the server replays the full buffer. This is simplest and guarantees consistency.

## Tasks

1. [ ] **Server: Add output buffer to terminal sessions** — Add a `scrollbackBuffer` string field to `TerminalSession`. Attach a persistent `onData` listener when the PTY is spawned in `createSession()` that appends to the buffer (trimming from front at 100KB). Export a `getSessionBuffer()` function.

2. [ ] **Server: Replay buffer on WebSocket connect** — In `websocket.ts`, after attaching to a session, send the buffer contents as a `{ type: 'output', data: buffer }` message before attaching the live `onData` listener.

3. [ ] **Client: Preserve terminal on reconnect** — Refactor `terminal.js` so that `connect()` to the same session reuses the existing xterm instance. Only create a new terminal when the session ID changes. Clear the terminal before replay.

4. [ ] **Client: Add visibility change handler** — Listen for `visibilitychange` events. When the page becomes visible and the WebSocket is closed, trigger an immediate reconnect instead of waiting for the timer.

5. [ ] **Client: Fix touch scrolling CSS** — Adjust `.terminal-container` CSS and add explicit `scrollback: 5000` to xterm.js options to ensure touch scrolling works on mobile.

## Risks

- **Buffer memory usage:** 100KB per session, max 10 sessions per user. Worst case ~1MB per user — negligible for a self-hosted single/few-user app.
- **Duplicate output on replay:** Mitigated by clearing the terminal before replaying the buffer. User sees a brief flash but gets consistent state.
- **Race condition on reconnect:** If the visibility change fires while a reconnect timer is already pending, we need to cancel the timer first. Already handled by the existing `reconnectTimer` check in `connect()`.
