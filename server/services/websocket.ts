import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { verifyToken, UserPayload } from './auth.js';
import { getSession, startDisconnectTimer } from './terminal-manager.js';

interface WsMessage {
  type: string;
  data?: string;
  cols?: number;
  rows?: number;
}

export function setupWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    const sessionId = url.searchParams.get('sessionId');

    if (!token || !sessionId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let user: UserPayload;
    try {
      user = verifyToken(token);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user, sessionId);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user: UserPayload, sessionId: string) => {
    const session = getSession(user.userId, sessionId);

    if (!session) {
      ws.close(4004, 'Session not found');
      return;
    }

    const ptyProcess = session.pty;

    // PTY output → WebSocket
    const dataHandler = ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    // WebSocket → PTY input
    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());

        if (msg.type === 'input' && typeof msg.data === 'string') {
          ptyProcess.write(msg.data);
        } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          const cols = Math.min(Math.max(Math.floor(msg.cols), 1), 500);
          const rows = Math.min(Math.max(Math.floor(msg.rows), 1), 200);
          ptyProcess.resize(cols, rows);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Handle PTY exit
    const exitHandler = ptyProcess.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(4000, 'Terminal process exited');
      }
    });

    // Handle WebSocket close
    ws.on('close', () => {
      dataHandler.dispose();
      exitHandler.dispose();
      startDisconnectTimer(user.userId, sessionId);
    });

    ws.on('error', () => {
      dataHandler.dispose();
      exitHandler.dispose();
      startDisconnectTimer(user.userId, sessionId);
    });
  });

  return wss;
}
