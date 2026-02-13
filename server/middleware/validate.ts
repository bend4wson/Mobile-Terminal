import { Request, Response, NextFunction } from 'express';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAuthInput(req: Request, res: Response, next: NextFunction): void {
  const { username, password } = req.body;

  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  if (!USERNAME_REGEX.test(username)) {
    res.status(400).json({ error: 'Username must be 3-30 characters, alphanumeric and underscores only' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  if (password.length > 128) {
    res.status(400).json({ error: 'Password must not exceed 128 characters' });
    return;
  }

  next();
}

export function validateSessionId(req: Request, res: Response, next: NextFunction): void {
  const id = req.params.id as string;

  if (!id || !UUID_REGEX.test(id)) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return;
  }

  next();
}

export function validateSessionUpdate(req: Request, res: Response, next: NextFunction): void {
  const { title } = req.body;

  if (title !== undefined) {
    if (typeof title !== 'string' || title.length < 1 || title.length > 50) {
      res.status(400).json({ error: 'Title must be a string between 1 and 50 characters' });
      return;
    }
  }

  next();
}
