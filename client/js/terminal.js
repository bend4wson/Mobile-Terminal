// Terminal module — xterm.js + WebSocket connection management
const TerminalManager = (() => {
  // Per-session terminal instances so switching tabs doesn't destroy them
  const termInstances = {}; // { sessionId: { term, fitAddon, resizeObserver } }
  let currentWs = null;
  let currentSessionId = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const RECONNECT_BASE_DELAY = 1000;
  const RECONNECT_MAX_DELAY = 15000;

  const container = document.getElementById('terminal-container');

  function getWsUrl(sessionId) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = Auth.getToken();
    return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
  }

  function getOrCreateTerminal(sessionId) {
    if (termInstances[sessionId]) {
      return termInstances[sessionId];
    }

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

    termInstances[sessionId] = { term, fitAddon, resizeObserver: null };
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

      // Don't scroll until finger has moved past threshold (allows taps through)
      if (!isScrolling && totalDelta < SCROLL_THRESHOLD) return;

      isScrolling = true;
      e.preventDefault();

      const deltaY = lastY - currentY;
      const now = Date.now();
      const dt = now - lastTime;

      if (dt > 0) {
        velocity = deltaY / dt;
      }

      viewport.scrollTop += deltaY;
      lastY = currentY;
      lastTime = now;
    }, { passive: false });

    screen.addEventListener('touchend', () => {
      if (!isScrolling) return;

      const friction = 0.95;

      function momentumStep() {
        if (Math.abs(velocity) < 0.01) {
          momentumId = null;
          return;
        }
        viewport.scrollTop += velocity * 16;
        velocity *= friction;
        momentumId = requestAnimationFrame(momentumStep);
      }

      if (Math.abs(velocity) > 0.1) {
        momentumId = requestAnimationFrame(momentumStep);
      }
    }, { passive: true });
  }

  function attachToContainer(sessionId) {
    const inst = termInstances[sessionId];
    if (!inst) return;

    // Hide all other terminal elements
    for (const el of container.children) {
      el.style.display = 'none';
    }

    // Check if this terminal already has a DOM element in the container
    let termEl = container.querySelector(`[data-session="${sessionId}"]`);
    if (!termEl) {
      termEl = document.createElement('div');
      termEl.dataset.session = sessionId;
      termEl.style.height = '100%';
      container.appendChild(termEl);
      inst.term.open(termEl);
      setupTouchScroll(termEl);
    }

    termEl.style.display = '';
    inst.fitAddon.fit();

    // Set up resize observer if not already
    if (!inst.resizeObserver) {
      inst.resizeObserver = new ResizeObserver(() => {
        if (currentSessionId === sessionId) {
          inst.fitAddon.fit();
          sendResize(inst.fitAddon);
        }
      });
      inst.resizeObserver.observe(container);
    }

    inst.term.focus();
  }

  function sendResize(fitAddon) {
    const dims = fitAddon.proposeDimensions();
    if (dims && currentWs && currentWs.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    }
  }

  function connectWs(sessionId) {
    // Close existing WebSocket without triggering full disconnect
    if (currentWs) {
      currentWs.onclose = null;
      currentWs.onerror = null;
      currentWs.close();
      currentWs = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const inst = termInstances[sessionId];
    if (!inst) return;

    const ws = new WebSocket(getWsUrl(sessionId));
    currentWs = ws;

    ws.onopen = () => {
      reconnectAttempts = 0;
      setStatus(false);
      sendResize(inst.fitAddon);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output' && msg.data) {
          inst.term.write(msg.data);
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = (event) => {
      if (event.code === 4000) {
        // PTY process exited — leave the tab but show it's dead
        return;
      }
      // For any other close (including 4004), just reconnect
      // Don't remove tabs — the session may still exist on the server
      if (currentSessionId === sessionId) {
        setStatus(true);
        scheduleReconnect(sessionId);
      }
    };

    ws.onerror = () => {
      // onclose will fire after
    };

    // Terminal input → WebSocket
    // Remove old listener if any and attach fresh one
    if (inst._inputDisposable) {
      inst._inputDisposable.dispose();
    }
    inst._inputDisposable = inst.term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
  }

  function connect(sessionId) {
    currentSessionId = sessionId;
    reconnectAttempts = 0;
    getOrCreateTerminal(sessionId);
    attachToContainer(sessionId);
    connectWs(sessionId);
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
    currentSessionId = null;
  }

  function destroyTerminal(sessionId) {
    const inst = termInstances[sessionId];
    if (!inst) return;
    if (inst._inputDisposable) inst._inputDisposable.dispose();
    if (inst.resizeObserver) inst.resizeObserver.disconnect();
    inst.term.dispose();
    delete termInstances[sessionId];

    // Remove the DOM element
    const el = container.querySelector(`[data-session="${sessionId}"]`);
    if (el) el.remove();
  }

  function scheduleReconnect(sessionId) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttempts), RECONNECT_MAX_DELAY);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      if (currentSessionId === sessionId) {
        connectWs(sessionId);
      }
    }, delay);
  }

  function sendInput(data) {
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type: 'input', data }));
    }
  }

  function focusTerminal() {
    if (currentSessionId && termInstances[currentSessionId]) {
      termInstances[currentSessionId].term.focus();
    }
  }

  function setStatus(disconnected) {
    const el = document.getElementById('status-bar');
    if (el) {
      el.classList.toggle('visible', disconnected);
    }
  }

  return { connect, disconnect, destroyTerminal, sendInput, focusTerminal };
})();
