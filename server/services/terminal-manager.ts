import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';

interface TerminalSession {
  pty: pty.IPty;
  createdAt: Date;
  lastActivity: Date;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  scrollbackBuffer: string;
  bufferListener: pty.IDisposable;
}

const DISCONNECT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_SESSIONS_PER_USER = 10;
const BUFFER_MAX_SIZE = 100 * 1024; // 100KB scrollback buffer per session

// Map<userId, Map<sessionId, TerminalSession>>
const sessions = new Map<number, Map<string, TerminalSession>>();

function getDefaultShell(): string {
  return process.env.SHELL || '/bin/bash';
}

export function createSession(userId: number): { id: string; title: string } {
  let userSessions = sessions.get(userId);
  if (!userSessions) {
    userSessions = new Map();
    sessions.set(userId, userSessions);
  }

  if (userSessions.size >= MAX_SESSIONS_PER_USER) {
    const error = new Error('Maximum number of sessions reached');
    (error as Error & { status: number }).status = 400;
    throw error;
  }

  const sessionId = uuidv4();
  const db = getDb();
  const sessionCount = userSessions.size + 1;
  const title = `Terminal ${sessionCount}`;

  const shell = getDefaultShell();
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || '/',
    env: process.env as Record<string, string>,
  });

  // Buffer all PTY output so we can replay on reconnect
  let scrollbackBuffer = '';
  const bufferListener = ptyProcess.onData((data: string) => {
    scrollbackBuffer += data;
    if (scrollbackBuffer.length > BUFFER_MAX_SIZE) {
      scrollbackBuffer = scrollbackBuffer.slice(-BUFFER_MAX_SIZE);
    }
  });

  userSessions.set(sessionId, {
    pty: ptyProcess,
    createdAt: new Date(),
    lastActivity: new Date(),
    scrollbackBuffer: '',
    bufferListener,
  });

  // Keep scrollbackBuffer reference in sync via getter pattern
  const session = userSessions.get(sessionId)!;
  Object.defineProperty(session, 'scrollbackBuffer', {
    get: () => scrollbackBuffer,
    set: (v: string) => { scrollbackBuffer = v; },
    enumerable: true,
    configurable: true,
  });

  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)').run(sessionId, userId, title);

  return { id: sessionId, title };
}

export function getSession(userId: number, sessionId: string): TerminalSession | undefined {
  const userSessions = sessions.get(userId);
  if (!userSessions) return undefined;

  const session = userSessions.get(sessionId);
  if (session) {
    session.lastActivity = new Date();
    // Clear any disconnect timer since someone is reconnecting
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = undefined;
    }
  }
  return session;
}

export function destroySession(userId: number, sessionId: string): boolean {
  const userSessions = sessions.get(userId);
  if (!userSessions) return false;

  const session = userSessions.get(sessionId);
  if (!session) return false;

  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
  }

  session.bufferListener.dispose();
  session.pty.kill();
  userSessions.delete(sessionId);

  if (userSessions.size === 0) {
    sessions.delete(userId);
  }

  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);

  return true;
}

export function listSessions(userId: number): Array<{ id: string; title: string; createdAt: string }> {
  const db = getDb();
  const rows = db.prepare('SELECT id, title, created_at as createdAt FROM sessions WHERE user_id = ? ORDER BY created_at ASC').all(userId) as Array<{ id: string; title: string; createdAt: string }>;
  return rows;
}

export function startDisconnectTimer(userId: number, sessionId: string): void {
  const userSessions = sessions.get(userId);
  if (!userSessions) return;

  const session = userSessions.get(sessionId);
  if (!session) return;

  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
  }

  session.disconnectTimer = setTimeout(() => {
    destroySession(userId, sessionId);
  }, DISCONNECT_TIMEOUT);
}

export function destroyAllSessions(userId: number): void {
  const userSessions = sessions.get(userId);
  if (!userSessions) return;

  for (const [sessionId, session] of userSessions) {
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
    }
    session.bufferListener.dispose();
    session.pty.kill();

    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  sessions.delete(userId);
}

export function destroyAllSessionsOnShutdown(): void {
  for (const [, userSessions] of sessions) {
    for (const [, session] of userSessions) {
      if (session.disconnectTimer) {
        clearTimeout(session.disconnectTimer);
      }
      session.bufferListener.dispose();
      session.pty.kill();
    }
  }
  sessions.clear();
}
