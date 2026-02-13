import { Router, Request, Response } from 'express';
import { register, login } from '../services/auth.js';
import { validateAuthInput } from '../middleware/validate.js';

const router = Router();

router.post('/register', validateAuthInput, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const result = await register(username, password);
    res.status(201).json(result);
  } catch (error) {
    const err = error as Error & { status?: number };
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/login', validateAuthInput, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const result = await login(username, password);
    res.json(result);
  } catch (error) {
    const err = error as Error & { status?: number };
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
