import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth-middleware.js';
import { validateSessionId, validateSessionUpdate } from '../middleware/validate.js';
import { createSession, destroySession, listSessions } from '../services/terminal-manager.js';
import { getDb } from '../db/database.js';

const router = Router();

router.use(authMiddleware);

router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const sessions = listSessions(userId);
  res.json(sessions);
});

router.post('/', (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const session = createSession(userId);
    res.status(201).json({ id: session.id, title: session.title, createdAt: new Date().toISOString() });
  } catch (error) {
    const err = error as Error & { status?: number };
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/:id', validateSessionId, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const sessionId = req.params.id as string;

  const destroyed = destroySession(userId, sessionId);
  if (!destroyed) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.status(204).send();
});

router.patch('/:id', validateSessionId, validateSessionUpdate, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const sessionId = req.params.id as string;
  const { title } = req.body;

  const db = getDb();
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!existing) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (title) {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?').run(title, sessionId, userId);
  }

  const updated = db.prepare('SELECT id, title, created_at as createdAt FROM sessions WHERE id = ?').get(sessionId);
  res.json(updated);
});

export default router;
