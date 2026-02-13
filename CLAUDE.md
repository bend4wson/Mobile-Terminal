# CLAUDE.md — Instructions for Claude Code

## Before Making Any Changes

**Always read `ARCHITECTURE.md` and `SPEC.md` before modifying the codebase.** These documents are the source of truth for system design and feature requirements.

## Project Overview

Self-hosted PWA terminal app. Users authenticate, get isolated terminal sessions over WebSocket, and can install the app on mobile devices. Exposed to the internet via Cloudflare Tunnel.

## Tech Stack

- **Runtime:** Node.js (>=18)
- **Language:** TypeScript (strict mode), ESM modules (`"type": "module"` in package.json)
- **Backend:** Express, ws (WebSocket), node-pty, better-sqlite3, bcrypt, jsonwebtoken, helmet, express-rate-limit
- **Frontend:** Vanilla HTML/CSS/JS (no framework), xterm.js, xterm-addon-fit, xterm-addon-web-links
- **Database:** SQLite via better-sqlite3
- **Build:** tsup for server bundling; frontend is static files served by Express

## Coding Conventions

- Use TypeScript for all server code under `/server`
- Use ESM (`import`/`export`) everywhere — no CommonJS `require()`
- Prefer `const` over `let`; never use `var`
- Use single quotes for strings
- Use 2-space indentation
- Name files in kebab-case (e.g., `auth-middleware.ts`, `terminal-manager.ts`)
- Name types/interfaces in PascalCase, variables/functions in camelCase
- Keep functions short and focused — one responsibility per function
- No `any` types unless absolutely unavoidable; prefer explicit typing
- Handle errors explicitly — no silent catches

## Project Structure

```
/server          — TypeScript backend source
  /routes        — Express route handlers
  /middleware     — Auth, rate limiting, validation middleware
  /services      — Business logic (terminal management, auth)
  /db            — Database schema and access layer
  index.ts       — Entry point
/client          — Static frontend files (HTML, CSS, JS)
  index.html     — Main app page
  login.html     — Login/register page
  js/            — Frontend JavaScript modules
  css/           — Stylesheets
  manifest.json  — PWA manifest
  sw.js          — Service worker
/scripts         — Setup and tunnel scripts
/data            — SQLite database file (gitignored)
```

## Running Locally

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Run with hot reload (tsx watch)
npm start            # Run compiled production build
```

The server starts on `http://localhost:3000` by default. Set the `PORT` environment variable to change it.

## Testing

```bash
npm test             # Run all tests
npm run lint         # Run ESLint
```

## Environment Variables

- `PORT` — Server port (default: 3000)
- `JWT_SECRET` — Secret for signing JWTs (required in production; auto-generated in dev)
- `NODE_ENV` — `development` or `production`

## Security Reminders

- Never run the server as root
- Always validate JWT before spawning a PTY or accepting WebSocket data
- Sanitize all user inputs
- PTY processes inherit the host user's permissions — never escalate
- Keep secrets out of version control (`.env` is gitignored)

## New Feature Workflow

When asked for a new feature, follow this process before writing any code.

### Step 1: Read Context

1. Read `CLAUDE.md`
2. Read `ARCHITECTURE.md`
3. Read `SPEC.md`
4. Check `docs/features/` for a detailed spec matching this feature — if one exists, read it and use it as the primary source of truth for the plan
5. Understand the current state of the project fully before proceeding

### Step 2: Create a Feature Plan

Create `docs/features/{feature-name}.md` with the following sections:

- **What** — One paragraph describing the feature.
- **Why** — What this adds to the experience, what problem it solves, or what it improves.
- **Where** — List every file that will be created or modified. Be specific with paths.
- **How** — Technical approach: libraries needed, component structure, SQLite schema changes (if any), WebSocket protocol changes, mobile considerations.
- **Tasks** — Numbered checklist of implementation steps in build order. Each task should be a committable unit of work.
- **Risks** — Anything that might break existing functionality, performance concerns, or edge cases to watch for.

### Step 3: Wait for Approval

Present the plan to me and **STOP**. Do NOT start coding until I explicitly approve or request changes.

### Step 4: Implement

- Work through the tasks list in order
- Identify tasks that are independent of each other and use the Task tool to implement them in parallel, giving each agent full context about what to build and what patterns to follow
- Tasks with dependencies on other tasks must wait — do NOT parallelize dependent work
- Check off each task as you complete it
- Commit after each logical chunk with a descriptive message
- If you hit a problem that requires deviating from the plan, stop and tell me before proceeding

### Step 5: Update Documentation

- Update `ARCHITECTURE.md` with any new components, patterns, or decisions
- Update the feature doc status to "Complete" and note any deviations from the original plan
- If the SQLite schema changed, ensure it is documented

## Key Decisions

- Frontend is intentionally vanilla JS — no React/Vue/Svelte. Keep it simple.
- One SQLite database file for all persistence. No ORM — use raw SQL via better-sqlite3's synchronous API.
- WebSocket auth happens on the initial connection via a token query parameter, not per-message.
