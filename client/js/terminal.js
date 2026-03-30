// Terminal module — xterm.js + WebSocket connection management
// Supports multiple simultaneous visible terminals for split pane layouts
const TerminalManager = (() => {
  const termInstances = {}; // { sessionId: { term, fitAddon, ws, resizeObserver, _inputDisposable } }
  let focusedSessionId = null;
  const reconnectState = {}; // { sessionId: { timer, attempts } }
  const RECONNECT_BASE_DELAY = 1000;
  const RECONNECT_MAX_DELAY = 15000;

  function getWsUrl(sessionId) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = Auth.getToken();
    return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
  }

  function createTerminal(sessionId) {
    if (termInstances[sessionId]) return termInstances[sessionId];

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
      scrollback: 5000,
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    termInstances[sessionId] = { term, fitAddon, ws: null, resizeObserver: null, _inputDisposable: null };
    return termInstances[sessionId];
  }

  function setupTouchScroll(termEl) {
    const viewport = termEl.querySelector('.xterm-viewport');
    const screen = termEl.querySelector('.xterm-screen');
    if (!viewport || !screen) return;

    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let momentumId = null;
    let isScrolling = false;
    const SCROLL_THRESHOLD = 10;

    function stopMomentum() {
      if (momentumId) {
        cancelAnimationFrame(momentumId);
        momentumId = null;
      }
    }

    screen.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      stopMomentum();
      startY = lastY = e.touches[0].clientY;
      lastTime = Date.now();
      velocity = 0;
      isScrolling = false;
    }, { passive: true });

    screen.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const totalDelta = Math.abs(startY - currentY);
      if (!isScrolling && totalDelta < SCROLL_THRESHOLD) return;
      isScrolling = true;
      e.preventDefault();
      const deltaY = lastY - currentY;
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) velocity = deltaY / dt;
      viewport.scrollTop += deltaY;
      lastY = currentY;
      lastTime = now;
    }, { passive: false });

    screen.addEventListener('touchend', () => {
      if (!isScrolling) return;
      const friction = 0.95;
      function momentumStep() {
        if (Math.abs(velocity) < 0.01) { momentumId = null; return; }
        viewport.scrollTop += velocity * 16;
        velocity *= friction;
        momentumId = requestAnimationFrame(momentumStep);
      }
      if (Math.abs(velocity) > 0.1) {
        momentumId = requestAnimationFrame(momentumStep);
      }
    }, { passive: true });
  }

  // Mount a terminal into a specific DOM element (e.g. .pane-terminal)
  function mountTerminal(sessionId, mountEl) {
    const inst = createTerminal(sessionId);

    // Already mounted here
    if (mountEl.querySelector('.xterm')) {
      inst.fitAddon.fit();
      return;
    }

    // If mounted elsewhere, move the xterm element
    const existingEl = document.querySelector(`[data-terminal-session="${sessionId}"]`);
    if (existingEl && existingEl !== mountEl) {
      // xterm is already open, just move the DOM
      while (existingEl.firstChild) {
        mountEl.appendChild(existingEl.firstChild);
      }
    } else if (!existingEl) {
      // First mount — open xterm
      mountEl.dataset.terminalSession = sessionId;
      inst.term.open(mountEl);
      setupTouchScroll(mountEl);
    }

    mountEl.dataset.terminalSession = sessionId;
    inst.fitAddon.fit();

    // Resize observer per pane
    if (inst.resizeObserver) inst.resizeObserver.disconnect();
    inst.resizeObserver = new ResizeObserver(() => {
      inst.fitAddon.fit();
      sendResize(sessionId);
    });
    inst.resizeObserver.observe(mountEl);
  }

  function sendResize(sessionId) {
    const inst = termInstances[sessionId];
    if (!inst) return;
    const dims = inst.fitAddon.proposeDimensions();
    if (dims && inst.ws && inst.ws.readyState === WebSocket.OPEN) {
      inst.ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    }
  }

  function connectSession(sessionId) {
    const inst = createTerminal(sessionId);

    // Close existing WS for this session
    if (inst.ws) {
      inst.ws.onclose = null;
      inst.ws.onerror = null;
      inst.ws.close();
      inst.ws = null;
    }

    clearReconnect(sessionId);

    const ws = new WebSocket(getWsUrl(sessionId));
    inst.ws = ws;

    ws.onopen = () => {
      clearReconnect(sessionId);
      setStatus(false);
      sendResize(sessionId);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output' && msg.data) {
          inst.term.write(msg.data);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = (event) => {
      if (event.code === 4000) return; // PTY exited
      setStatus(true);
      scheduleReconnect(sessionId);
    };

    ws.onerror = () => {};

    // Terminal input -> WS
    if (inst._inputDisposable) inst._inputDisposable.dispose();
    inst._inputDisposable = inst.term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
  }

  function disconnectSession(sessionId) {
    clearReconnect(sessionId);
    const inst = termInstances[sessionId];
    if (!inst) return;
    if (inst.ws) {
      inst.ws.onclose = null;
      inst.ws.onerror = null;
      inst.ws.close();
      inst.ws = null;
    }
  }

  function disconnectAll() {
    for (const sid of Object.keys(termInstances)) {
      disconnectSession(sid);
    }
  }

  function destroyTerminal(sessionId) {
    disconnectSession(sessionId);
    const inst = termInstances[sessionId];
    if (!inst) return;
    if (inst._inputDisposable) inst._inputDisposable.dispose();
    if (inst.resizeObserver) inst.resizeObserver.disconnect();
    inst.term.dispose();
    delete termInstances[sessionId];

    // Remove any mount points
    const el = document.querySelector(`[data-terminal-session="${sessionId}"]`);
    if (el) {
      el.innerHTML = '';
      delete el.dataset.terminalSession;
    }
  }

  function clearReconnect(sessionId) {
    const state = reconnectState[sessionId];
    if (state && state.timer) {
      clearTimeout(state.timer);
    }
    delete reconnectState[sessionId];
  }

  function scheduleReconnect(sessionId) {
    if (!reconnectState[sessionId]) {
      reconnectState[sessionId] = { timer: null, attempts: 0 };
    }
    const state = reconnectState[sessionId];
    if (state.timer) clearTimeout(state.timer);
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, state.attempts), RECONNECT_MAX_DELAY);
    state.attempts++;
    state.timer = setTimeout(() => {
      connectSession(sessionId);
    }, delay);
  }

  function sendInput(data) {
    const sid = focusedSessionId || SplitPane.getFocusedSessionId();
    const inst = sid && termInstances[sid];
    if (inst && inst.ws && inst.ws.readyState === WebSocket.OPEN) {
      inst.ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  function setFocused(sessionId) {
    focusedSessionId = sessionId;
    const inst = termInstances[sessionId];
    if (inst) inst.term.focus();
  }

  function focusTerminal() {
    const sid = focusedSessionId || SplitPane.getFocusedSessionId();
    if (sid && termInstances[sid]) {
      termInstances[sid].term.focus();
    }
  }

  function refitAll() {
    for (const inst of Object.values(termInstances)) {
      inst.fitAddon.fit();
    }
  }

  function setStatus(disconnected) {
    const el = document.getElementById('status-bar');
    if (el) el.classList.toggle('visible', disconnected);
  }

  // Legacy single-session API (used by old tab switching — still works for single pane)
  function connect(sessionId) {
    focusedSessionId = sessionId;
    createTerminal(sessionId);
    connectSession(sessionId);
  }

  function disconnect() {
    disconnectAll();
    focusedSessionId = null;
  }

  return {
    connect,
    disconnect,
    destroyTerminal,
    sendInput,
    focusTerminal,
    createTerminal,
    mountTerminal,
    connectSession,
    disconnectSession,
    disconnectAll,
    setFocused,
    refitAll,
  };
})();
