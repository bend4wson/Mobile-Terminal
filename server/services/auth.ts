import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database.js';

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '24h';

export interface UserPayload {
  userId: number;
  username: string;
}

export interface AuthResult {
  token: string;
  user: { id: number; username: string };
}

function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return 'dev-secret-do-not-use-in-production';
}

export async function register(username: string, password: string): Promise<AuthResult> {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    const error = new Error('Username already taken');
    (error as Error & { status: number }).status = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);

  const userId = result.lastInsertRowid as number;
  const token = jwt.sign({ userId, username }, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });

  return { token, user: { id: userId, username } };
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const db = getDb();

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as
    | { id: number; username: string; password_hash: string }
    | undefined;

  if (!user) {
    const error = new Error('Invalid username or password');
    (error as Error & { status: number }).status = 401;
    throw error;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const error = new Error('Invalid username or password');
    (error as Error & { status: number }).status = 401;
    throw error;
  }

  const token = jwt.sign({ userId: user.id, username: user.username }, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });

  return { token, user: { id: user.id, username: user.username } };
}

export function verifyToken(token: string): UserPayload {
  return jwt.verify(token, getJwtSecret()) as UserPayload;
}
