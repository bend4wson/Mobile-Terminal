// Terminal module — xterm.js + WebSocket connection management
const TerminalManager = (() => {
  let currentTerm = null;
  let currentWs = null;
  let currentSessionId = null;
  let reconnectTimer = null;
  const RECONNECT_DELAY = 2000;

  function getWsUrl(sessionId) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = Auth.getToken();
    return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
  }

  function createTerminal() {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: '\'SF Mono\', \'Fira Code\', \'Consolas\', \'Courier New\', monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#e0e0e0',
        cursor: '#4fc3f7',
        selectionBackground: '#4fc3f755',
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    return { term, fitAddon };
  }

  function connect(sessionId, container) {
    disconnect();
    currentSessionId = sessionId;

    // Clear container
    container.innerHTML = '';

    const { term, fitAddon } = createTerminal();
    currentTerm = { term, fitAddon };

    term.open(container);
    fitAddon.fit();

    const ws = new WebSocket(getWsUrl(sessionId));
    currentWs = ws;

    ws.onopen = () => {
      setStatus(false);
      // Send initial size
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output' && msg.data) {
          term.write(msg.data);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      if (event.code === 4004) {
        // Session not found — remove the tab
        if (typeof Tabs !== 'undefined') {
          Tabs.removeTab(sessionId);
        }
        return;
      }
      if (currentSessionId === sessionId) {
        setStatus(true);
        scheduleReconnect(sessionId, container);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    // Terminal input → WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    });
    resizeObserver.observe(container);

    // Store observer for cleanup
    currentTerm.resizeObserver = resizeObserver;

    term.focus();
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (currentWs) {
      currentWs.onclose = null;
      currentWs.onerror = null;
      currentWs.close();
      currentWs = null;
    }
    if (currentTerm) {
      if (currentTerm.resizeObserver) {
        currentTerm.resizeObserver.disconnect();
      }
      currentTerm.term.dispose();
      currentTerm = null;
    }
    currentSessionId = null;
  }

  function scheduleReconnect(sessionId, container) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (currentSessionId === sessionId) {
        connect(sessionId, container);
      }
    }, RECONNECT_DELAY);
  }

  function sendInput(data) {
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type: 'input', data }));
    }
  }

  function focusTerminal() {
    if (currentTerm) {
      currentTerm.term.focus();
    }
  }

  function setStatus(disconnected) {
    const el = document.getElementById('status-bar');
    if (el) {
      el.classList.toggle('visible', disconnected);
    }
  }

  return { connect, disconnect, sendInput, focusTerminal };
})();
