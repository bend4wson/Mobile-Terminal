// Tabs module — tab creation, switching, closing, drag-and-drop split panes
const Tabs = (() => {
  let tabs = []; // [{ id, title }]
  let activeTabId = null;

  const tabBar = document.getElementById('tab-bar');
  const newTabBtn = document.getElementById('new-tab-btn');
  const container = document.getElementById('terminal-container');

  // Drag state
  let dragSessionId = null;
  let dragGhost = null;
  let touchDragId = null;

  function render() {
    const existing = tabBar.querySelectorAll('.tab');
    existing.forEach((el) => el.remove());

    tabs.forEach((tab) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
      el.dataset.id = tab.id;
      el.draggable = true;

      const label = document.createElement('span');
      label.textContent = tab.title;

      const close = document.createElement('span');
      close.className = 'close-tab';
      close.textContent = '\u00d7';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });

      el.appendChild(label);
      el.appendChild(close);

      el.addEventListener('click', () => switchTab(tab.id));

      // HTML5 drag (desktop)
      el.addEventListener('dragstart', (e) => {
        dragSessionId = tab.id;
        e.dataTransfer.setData('text/plain', tab.id);
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => container.classList.add('drag-active'));
      });

      el.addEventListener('dragend', () => {
        endDrag();
      });

      // Touch drag (mobile)
      el.addEventListener('touchstart', (e) => {
        touchDragId = setTimeout(() => {
          startTouchDrag(e, tab);
        }, 300); // Long press to start drag
      }, { passive: true });

      el.addEventListener('touchend', () => {
        if (touchDragId) {
          clearTimeout(touchDragId);
          touchDragId = null;
        }
      });

      el.addEventListener('touchmove', () => {
        // Cancel long-press if finger moves (it's a scroll)
        if (touchDragId) {
          clearTimeout(touchDragId);
          touchDragId = null;
        }
      }, { passive: true });

      tabBar.insertBefore(el, newTabBtn);
    });
  }

  function startTouchDrag(startEvent, tab) {
    touchDragId = null;
    dragSessionId = tab.id;

    // Create ghost
    dragGhost = document.createElement('div');
    dragGhost.className = 'tab-drag-ghost';
    dragGhost.textContent = tab.title;
    document.body.appendChild(dragGhost);

    const touch = startEvent.touches[0];
    positionGhost(touch.clientX, touch.clientY);

    container.classList.add('drag-active');
    let lastDropTarget = null;

    function onTouchMove(e) {
      e.preventDefault();
      const t = e.touches[0];
      positionGhost(t.clientX, t.clientY);

      // Find which pane we're over and show drop zones
      const paneEl = getPaneAtPoint(t.clientX, t.clientY);
      if (paneEl && paneEl.dataset.session) {
        const sid = paneEl.dataset.session;
        if (sid !== lastDropTarget) {
          SplitPane.hideDropZones();
          SplitPane.showDropZones(sid);
          lastDropTarget = sid;
        }
        // Highlight active drop zone
        highlightDropZone(t.clientX, t.clientY);
      }
    }

    function onTouchEnd(e) {
      const t = e.changedTouches[0];
      const dropInfo = SplitPane.getDropZone(t.clientX, t.clientY);
      if (dropInfo) {
        handleDrop(dropInfo.sessionId, dropInfo.zone);
      }
      endDrag();
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    }

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }

  function positionGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = (x + 12) + 'px';
    dragGhost.style.top = (y - 20) + 'px';
  }

  function getPaneAtPoint(x, y) {
    const els = document.elementsFromPoint(x, y);
    return els.find(el => el.classList.contains('pane'));
  }

  function highlightDropZone(x, y) {
    // Clear all active states
    document.querySelectorAll('.pane-drop-zone.active').forEach(el => el.classList.remove('active'));
    const zone = SplitPane.getDropZone(x, y);
    if (zone) {
      const el = document.querySelector(`.pane-drop-zone[data-zone="${zone.zone}"][data-session="${zone.sessionId}"]`);
      if (el) el.classList.add('active');
    }
  }

  function endDrag() {
    dragSessionId = null;
    container.classList.remove('drag-active');
    SplitPane.hideDropZones();
    document.querySelectorAll('.pane-drop-zone.active').forEach(el => el.classList.remove('active'));
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
  }

  async function handleDrop(targetSessionId, zone) {
    if (!dragSessionId) return;

    // "center" means replace the pane content (switch tab into it) — not a split
    if (zone === 'center') {
      // If dragging the same session, do nothing
      if (dragSessionId === targetSessionId) return;

      // If the dragged tab is already in this tab's layout, just focus it
      const layoutSessions = SplitPane.getSessionIds(activeTabId);
      if (layoutSessions.includes(dragSessionId)) {
        SplitPane.setFocus(dragSessionId);
        TerminalManager.setFocused(dragSessionId);
        return;
      }

      // Otherwise create a new session and split
      const newSession = await createSession();
      if (!newSession) return;

      const direction = 'vertical';
      if (SplitPane.splitPane(targetSessionId, direction, newSession.id)) {
        mountAndConnect(newSession.id);
      }
      return;
    }

    const directionMap = {
      left: 'horizontal',
      right: 'horizontal',
      top: 'vertical',
      bottom: 'vertical',
    };
    const direction = directionMap[zone];
    if (!direction) return;

    // Create a new session for the split
    const newSession = await createSession();
    if (!newSession) return;

    // For left/top drops, we want the new pane on the left/top side
    // splitPane always puts new session as the second child (right/bottom)
    // So for left/top, we split then the caller handles the swap
    if (zone === 'left' || zone === 'top') {
      // Split target, new goes right/bottom, then swap ratio to put it left/top
      if (SplitPane.splitPane(targetSessionId, direction, newSession.id)) {
        // Swap: we actually want the new session on the first side
        // Easiest: just re-render with swapped children in the tree
        swapSplitChildren(targetSessionId, newSession.id);
        mountAndConnect(newSession.id);
      }
    } else {
      if (SplitPane.splitPane(targetSessionId, direction, newSession.id)) {
        mountAndConnect(newSession.id);
      }
    }
  }

  function swapSplitChildren(sessionId1, sessionId2) {
    // Find the split node that contains both of these as direct children
    const root = SplitPane.getLayout(activeTabId);
    if (!root) return;
    const splitNode = findSplitContaining(root, sessionId1, sessionId2);
    if (splitNode) {
      const tmp = splitNode.children[0];
      splitNode.children[0] = splitNode.children[1];
      splitNode.children[1] = tmp;
      SplitPane.render(container);
      SplitPane.saveLayouts();
    }
  }

  function findSplitContaining(node, sid1, sid2) {
    if (node.type === 'leaf') return null;
    const c0 = node.children[0];
    const c1 = node.children[1];
    if (
      (c0.type === 'leaf' && c0.sessionId === sid1 && c1.type === 'leaf' && c1.sessionId === sid2) ||
      (c0.type === 'leaf' && c0.sessionId === sid2 && c1.type === 'leaf' && c1.sessionId === sid1)
    ) {
      return node;
    }
    return findSplitContaining(c0, sid1, sid2) || findSplitContaining(c1, sid1, sid2);
  }

  function mountAndConnect(sessionId) {
    const pane = container.querySelector(`.pane[data-session="${sessionId}"]`);
    if (pane) {
      const mountEl = pane.querySelector('.pane-terminal');
      if (mountEl) {
        TerminalManager.mountTerminal(sessionId, mountEl);
        TerminalManager.connectSession(sessionId);
      }
    }
  }

  // Desktop drag-over handling on the container
  function setupContainerDragEvents() {
    let lastDropTarget = null;

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const paneEl = getPaneAtPoint(e.clientX, e.clientY);
      if (paneEl && paneEl.dataset.session) {
        const sid = paneEl.dataset.session;
        if (sid !== lastDropTarget) {
          SplitPane.hideDropZones();
          SplitPane.showDropZones(sid);
          lastDropTarget = sid;
        }
        highlightDropZone(e.clientX, e.clientY);
      }
    });

    container.addEventListener('dragleave', (e) => {
      if (!container.contains(e.relatedTarget)) {
        SplitPane.hideDropZones();
        lastDropTarget = null;
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const dropInfo = SplitPane.getDropZone(e.clientX, e.clientY);
      if (dropInfo) {
        handleDrop(dropInfo.sessionId, dropInfo.zone);
      }
      endDrag();
      lastDropTarget = null;
    });
  }

  // Handle pane close and resize events from SplitPane
  function setupPaneEvents() {
    container.addEventListener('pane-close', async (e) => {
      const { sessionId } = e.detail;
      // Delete the session from server
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: 'DELETE',
          headers: Auth.authHeader(),
        });
      } catch { /* continue cleanup */ }

      TerminalManager.destroyTerminal(sessionId);
      const remaining = SplitPane.removePane(sessionId);

      // Remove from tabs list if no longer in any layout
      const allInLayout = SplitPane.getSessionIds(activeTabId);
      if (!allInLayout.includes(sessionId)) {
        tabs = tabs.filter(t => t.id !== sessionId);
      }

      if (remaining) {
        SplitPane.setFocus(remaining);
        TerminalManager.setFocused(remaining);
      } else {
        // Last pane in this tab was closed — create a fresh session for it
        const newSession = await createSession(false);
        if (newSession && activeTabId) {
          SplitPane.setActiveTab(activeTabId, newSession.id);
          SplitPane.render(container);
          mountAndConnect(newSession.id);
          SplitPane.setFocus(newSession.id);
          TerminalManager.setFocused(newSession.id);
        }
      }
      render();
    });

    container.addEventListener('pane-resize', () => {
      TerminalManager.refitAll();
    });
  }

  // Create a server-side session. addToTabs controls whether it shows in the tab bar.
  async function createSession(addToTabs = false) {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { ...Auth.authHeader(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to create session');
        return null;
      }
      const session = await res.json();
      if (addToTabs) {
        tabs.push({ id: session.id, title: session.title });
        render();
      }
      return session;
    } catch (err) {
      console.error('Failed to create session:', err);
      return null;
    }
  }

  async function loadSessions() {
    SplitPane.loadLayouts();

    try {
      const res = await fetch('/api/sessions', { headers: Auth.authHeader() });
      if (!res.ok) {
        if (res.status === 401) {
          Auth.clearAuth();
          window.location.href = '/login.html';
          return;
        }
        throw new Error('Failed to load sessions');
      }
      const sessions = await res.json();
      const allSessions = sessions.map((s) => ({ id: s.id, title: s.title }));

      // Figure out which sessions are "child" panes in saved layouts
      const childSessionIds = new Set();
      for (const session of allSessions) {
        const layoutSessions = SplitPane.getSessionIds(session.id);
        for (const sid of layoutSessions) {
          if (sid !== session.id) childSessionIds.add(sid);
        }
      }

      // Only show root-level sessions as tabs
      tabs = allSessions.filter(s => !childSessionIds.has(s.id));

      if (tabs.length === 0) {
        await createTab();
      } else {
        render();
        switchTab(tabs[0].id);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
      await createTab();
    }

    setupContainerDragEvents();
    setupPaneEvents();
  }

  async function createTab() {
    const session = await createSession(true);
    if (!session) return;
    switchTab(session.id);
  }

  function switchTab(sessionId) {
    if (activeTabId === sessionId) return;

    // Disconnect all current sessions
    if (activeTabId) {
      const currentSessions = SplitPane.getSessionIds(activeTabId);
      for (const sid of currentSessions) {
        TerminalManager.disconnectSession(sid);
      }
    }

    activeTabId = sessionId;
    render();

    // Initialize layout for this tab if needed
    SplitPane.setActiveTab(sessionId, sessionId);

    // Render the pane layout
    SplitPane.render(container);

    // Mount and connect all sessions in this tab's layout
    const layoutSessions = SplitPane.getSessionIds(sessionId);
    for (const sid of layoutSessions) {
      mountAndConnect(sid);
    }

    // Focus the first session (or the previously focused one)
    const focused = SplitPane.getFocusedSessionId();
    const toFocus = (focused && layoutSessions.includes(focused)) ? focused : layoutSessions[0];
    if (toFocus) {
      SplitPane.setFocus(toFocus);
      TerminalManager.setFocused(toFocus);
    }
  }

  async function closeTab(sessionId) {
    // Close all sessions in this tab's layout
    const layoutSessions = SplitPane.getSessionIds(sessionId);
    const sessionsToClose = layoutSessions.length > 0 ? layoutSessions : [sessionId];

    for (const sid of sessionsToClose) {
      try {
        await fetch(`/api/sessions/${sid}`, {
          method: 'DELETE',
          headers: Auth.authHeader(),
        });
      } catch { /* continue */ }
      TerminalManager.destroyTerminal(sid);
    }

    SplitPane.removeLayout(sessionId);
    tabs = tabs.filter(t => !sessionsToClose.includes(t.id));

    if (activeTabId === sessionId) {
      TerminalManager.disconnect();
      if (tabs.length > 0) {
        activeTabId = null;
        switchTab(tabs[tabs.length - 1].id);
      } else {
        activeTabId = null;
        await createTab();
      }
    }

    render();
  }

  function removeTab(sessionId) {
    closeTab(sessionId);
  }

  newTabBtn.addEventListener('click', createTab);

  return { loadSessions, createTab, switchTab, closeTab, removeTab };
})();
