// Tabs module — tab creation, switching, closing
const Tabs = (() => {
  let tabs = []; // [{ id, title }]
  let activeTabId = null;

  const tabBar = document.getElementById('tab-bar');
  const newTabBtn = document.getElementById('new-tab-btn');

  function render() {
    // Remove existing tab elements (but keep the + button)
    const existing = tabBar.querySelectorAll('.tab');
    existing.forEach((el) => el.remove());

    tabs.forEach((tab) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
      el.dataset.id = tab.id;

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

      el.addEventListener('click', () => {
        switchTab(tab.id);
      });

      tabBar.insertBefore(el, newTabBtn);
    });
  }

  async function loadSessions() {
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
      tabs = sessions.map((s) => ({ id: s.id, title: s.title }));

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
  }

  async function createTab() {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { ...Auth.authHeader(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to create session');
        return;
      }
      const session = await res.json();
      tabs.push({ id: session.id, title: session.title });
      render();
      switchTab(session.id);
    } catch (err) {
      console.error('Failed to create tab:', err);
    }
  }

  function switchTab(sessionId) {
    if (activeTabId === sessionId) return;
    activeTabId = sessionId;
    render();
    TerminalManager.connect(sessionId);
  }

  async function closeTab(sessionId) {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: Auth.authHeader(),
      });
    } catch {
      // Continue with local cleanup even if API fails
    }

    removeTab(sessionId);
  }

  function removeTab(sessionId) {
    tabs = tabs.filter((t) => t.id !== sessionId);
    TerminalManager.destroyTerminal(sessionId);

    if (activeTabId === sessionId) {
      TerminalManager.disconnect();
      if (tabs.length > 0) {
        activeTabId = null; // Reset so switchTab doesn't bail early
        switchTab(tabs[tabs.length - 1].id);
      } else {
        activeTabId = null;
        createTab();
      }
    }

    render();
  }

  // Event listeners
  newTabBtn.addEventListener('click', createTab);

  return { loadSessions, createTab, switchTab, closeTab, removeTab };
})();
