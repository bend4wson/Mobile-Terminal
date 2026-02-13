import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initDb, closeDb } from './db/database.js';
import { setupWebSocket } from './services/websocket.js';
import { destroyAllSessionsOnShutdown } from './services/terminal-manager.js';
import authRoutes from './routes/auth-routes.js';
import sessionRoutes from './routes/session-routes.js';

// Refuse to run as root
if (process.getuid && process.getuid() === 0) {
  console.error('ERROR: Do not run this server as root.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
const server = createServer(app);

// Initialize database
initDb();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));

app.use(express.json({ limit: '1kb' }));

// Rate limiting for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for session creation
const sessionCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many sessions created. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth', authRoutes);

app.use('/api/sessions', sessionCreateLimiter);
app.use('/api/sessions', sessionRoutes);

// Serve static frontend files
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// SPA fallback — serve index.html for unmatched routes
app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// WebSocket setup
setupWebSocket(server);

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  destroyAllSessionsOnShutdown();
  closeDb();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
