const SplitPane = (() => {
  let layouts = {};
  let activeTabId = null;
  let focusedSessionId = null;
  let activeContainer = null;

  const MAX_PANES = 4;
  const MIN_RATIO = 0.15;
  const MAX_RATIO = 0.85;
  const MIN_PANE_WIDTH = 200;
  const MIN_PANE_HEIGHT = 100;
  const NARROW_VIEWPORT = 500;
  const STORAGE_KEY = 'terminal_pane_layouts';

  function makeLeaf(sessionId) {
    return { type: 'leaf', sessionId };
  }

  function makeSplit(direction, ratio, left, right) {
    return { type: 'split', direction, ratio, children: [left, right] };
  }

  function countLeaves(node) {
    if (node.type === 'leaf') return 1;
    return countLeaves(node.children[0]) + countLeaves(node.children[1]);
  }

  function collectLeaves(node, acc = []) {
    if (node.type === 'leaf') {
      acc.push(node.sessionId);
    } else {
      collectLeaves(node.children[0], acc);
      collectLeaves(node.children[1], acc);
    }
    return acc;
  }

  // Returns the parent node and which child index contains the target sessionId
  function findParent(node, sessionId, parent = null, childIndex = null) {
    if (node.type === 'leaf') {
      if (node.sessionId === sessionId) {
        return { parent, childIndex, node };
      }
      return null;
    }
    const left = findParent(node.children[0], sessionId, node, 0);
    if (left) return left;
    return findParent(node.children[1], sessionId, node, 1);
  }

  function findLeaf(node, sessionId) {
    if (node.type === 'leaf') return node.sessionId === sessionId ? node : null;
    return findLeaf(node.children[0], sessionId) || findLeaf(node.children[1], sessionId);
  }

  // Find split node that directly contains a leaf with sessionId
  function findContainingSplit(node, sessionId, splitNode = null) {
    if (node.type === 'leaf') return null;
    if (
      (node.children[0].type === 'leaf' && node.children[0].sessionId === sessionId) ||
      (node.children[1].type === 'leaf' && node.children[1].sessionId === sessionId)
    ) {
      return node;
    }
    return (
      findContainingSplit(node.children[0], sessionId) ||
      findContainingSplit(node.children[1], sessionId)
    );
  }

  function getLayout(tabId) {
    if (!layouts[tabId]) {
      layouts[tabId] = null;
    }
    return layouts[tabId];
  }

  function setActiveTab(tabId, defaultSessionId) {
    activeTabId = tabId;
    if (!layouts[tabId] && defaultSessionId) {
      layouts[tabId] = makeLeaf(defaultSessionId);
    }
    if (activeContainer) {
      render(activeContainer);
    }
  }

  function splitPane(sessionId, direction, newSessionId) {
    if (!activeTabId) return false;
    const root = layouts[activeTabId];
    if (!root) return false;

    const total = countLeaves(root);
    if (total >= MAX_PANES) return false;

    if (activeContainer) {
      const w = activeContainer.offsetWidth;
      const h = activeContainer.offsetHeight;

      if (w < NARROW_VIEWPORT && direction === 'horizontal') return false;

      const rects = computeRects(root, 0, 0, 100, 100);
      const paneRect = rects[sessionId];
      if (paneRect) {
        const pxW = (paneRect.width / 100) * w;
        const pxH = (paneRect.height / 100) * h;
        if (direction === 'horizontal' && pxW / 2 < MIN_PANE_WIDTH) return false;
        if (direction === 'vertical' && pxH / 2 < MIN_PANE_HEIGHT) return false;
      }
    }

    if (root.type === 'leaf' && root.sessionId === sessionId) {
      const newLeaf = makeLeaf(newSessionId);
      layouts[activeTabId] = makeSplit(direction, 0.5, root, newLeaf);
      if (!focusedSessionId) focusedSessionId = sessionId;
      if (activeContainer) render(activeContainer);
      saveLayouts();
      return true;
    }

    const result = findParent(root, sessionId);
    if (!result) return false;

    const { parent, childIndex } = result;
    const targetLeaf = makeLeaf(sessionId);
    const newLeaf = makeLeaf(newSessionId);
    const newSplit = makeSplit(direction, 0.5, targetLeaf, newLeaf);

    if (parent) {
      parent.children[childIndex] = newSplit;
    } else {
      layouts[activeTabId] = newSplit;
    }

    if (activeContainer) render(activeContainer);
    saveLayouts();
    return true;
  }

  function removePane(sessionId) {
    if (!activeTabId) return null;
    const root = layouts[activeTabId];
    if (!root) return null;

    if (root.type === 'leaf') {
      if (root.sessionId === sessionId) {
        layouts[activeTabId] = null;
        if (focusedSessionId === sessionId) focusedSessionId = null;
        if (activeContainer) render(activeContainer);
        saveLayouts();
      }
      return null;
    }

    const result = findParent(root, sessionId);
    if (!result || !result.parent) return null;

    const { parent, childIndex } = result;
    const siblingIndex = childIndex === 0 ? 1 : 0;
    const sibling = parent.children[siblingIndex];

    // Find parent's parent to replace parent with sibling
    const grandResult = findGrandParent(root, parent);

    if (!grandResult) {
      layouts[activeTabId] = sibling;
    } else {
      const { gParent, gChildIndex } = grandResult;
      gParent.children[gChildIndex] = sibling;
    }

    const siblingLeaves = collectLeaves(sibling);
    const siblingId = siblingLeaves[0];

    if (focusedSessionId === sessionId) {
      focusedSessionId = siblingId;
    }

    if (activeContainer) render(activeContainer);
    saveLayouts();
    return siblingId;
  }

  function findGrandParent(root, targetNode) {
    if (root.type === 'leaf') return null;
    if (root.children[0] === targetNode) return { gParent: root, gChildIndex: 0 };
    if (root.children[1] === targetNode) return { gParent: root, gChildIndex: 1 };
    return findGrandParent(root.children[0], targetNode) || findGrandParent(root.children[1], targetNode);
  }

  function setFocus(sessionId) {
    focusedSessionId = sessionId;
    if (activeContainer) {
      const panes = activeContainer.querySelectorAll('.pane');
      panes.forEach(p => {
        p.classList.toggle('focused', p.dataset.session === sessionId);
      });
    }
  }

  function getFocusedSessionId() {
    return focusedSessionId;
  }

  function resizeSplit(sessionId, newRatio) {
    if (!activeTabId) return;
    const root = layouts[activeTabId];
    if (!root) return;

    const splitNode = findContainingSplit(root, sessionId);
    if (!splitNode) return;

    splitNode.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, newRatio));
    if (activeContainer) render(activeContainer);
    saveLayouts();
  }

  function computeRects(node, top, left, width, height, acc = {}) {
    if (node.type === 'leaf') {
      acc[node.sessionId] = { top, left, width, height };
      return acc;
    }

    const { direction, ratio, children } = node;

    if (direction === 'horizontal') {
      const leftWidth = width * ratio;
      const rightWidth = width - leftWidth;
      computeRects(children[0], top, left, leftWidth, height, acc);
      computeRects(children[1], top, left + leftWidth, rightWidth, height, acc);
    } else {
      const topHeight = height * ratio;
      const bottomHeight = height - topHeight;
      computeRects(children[0], top, left, width, topHeight, acc);
      computeRects(children[1], top + topHeight, left, width, bottomHeight, acc);
    }

    return acc;
  }

  function computeDividers(node, top, left, width, height, acc = []) {
    if (node.type === 'leaf') return acc;

    const { direction, ratio, children } = node;

    if (direction === 'horizontal') {
      const leftWidth = width * ratio;
      acc.push({
        direction,
        top,
        left: left + leftWidth,
        width: 0,
        height,
        node,
      });
      computeDividers(children[0], top, left, leftWidth, height, acc);
      computeDividers(children[1], top, left + leftWidth, width - leftWidth, height, acc);
    } else {
      const topHeight = height * ratio;
      acc.push({
        direction,
        top: top + topHeight,
        left,
        width,
        height: 0,
        node,
      });
      computeDividers(children[0], top, left, width, topHeight, acc);
      computeDividers(children[1], top + topHeight, left, width, height - topHeight, acc);
    }

    return acc;
  }

  function render(container) {
    activeContainer = container;
    const root = layouts[activeTabId];

    if (!root) {
      container.innerHTML = '';
      return;
    }

    const rects = computeRects(root, 0, 0, 100, 100);
    const dividers = computeDividers(root, 0, 0, 100, 100);
    const totalPanes = Object.keys(rects).length;
    const showClose = totalPanes > 1;

    const existingPanes = new Map();
    container.querySelectorAll('.pane[data-session]').forEach(el => {
      existingPanes.set(el.dataset.session, el);
    });

    const existingDividers = Array.from(container.querySelectorAll('.pane-divider'));
    let dividerIndex = 0;

    const seenSessions = new Set();

    for (const [sessionId, rect] of Object.entries(rects)) {
      seenSessions.add(sessionId);
      let pane = existingPanes.get(sessionId);

      if (!pane) {
        pane = document.createElement('div');
        pane.className = 'pane';
        pane.dataset.session = sessionId;

        const terminal = document.createElement('div');
        terminal.className = 'pane-terminal';
        pane.appendChild(terminal);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'pane-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          container.dispatchEvent(new CustomEvent('pane-close', { detail: { sessionId } }));
        });
        pane.appendChild(closeBtn);

        pane.addEventListener('mousedown', () => setFocus(sessionId));
        pane.addEventListener('touchstart', () => setFocus(sessionId), { passive: true });

        container.appendChild(pane);
      }

      pane.style.position = 'absolute';
      pane.style.top = rect.top + '%';
      pane.style.left = rect.left + '%';
      pane.style.width = rect.width + '%';
      pane.style.height = rect.height + '%';
      pane.classList.toggle('focused', sessionId === focusedSessionId);

      const closeBtn = pane.querySelector('.pane-close');
      if (closeBtn) closeBtn.style.display = showClose ? '' : 'none';
    }

    // Remove panes no longer in tree
    existingPanes.forEach((el, sid) => {
      if (!seenSessions.has(sid)) el.remove();
    });

    // Rebuild dividers
    existingDividers.forEach(el => el.remove());

    for (const divider of dividers) {
      const el = document.createElement('div');
      el.className = 'pane-divider';
      el.dataset.direction = divider.direction;
      el.style.position = 'absolute';

      if (divider.direction === 'horizontal') {
        el.style.top = divider.top + '%';
        el.style.left = `calc(${divider.left}% - 3px)`;
        el.style.width = '6px';
        el.style.height = divider.height + '%';
        el.style.cursor = 'col-resize';
      } else {
        el.style.top = `calc(${divider.top}% - 3px)`;
        el.style.left = divider.left + '%';
        el.style.width = divider.width + '%';
        el.style.height = '6px';
        el.style.cursor = 'row-resize';
      }

      attachDividerListeners(el, divider.node, container);
      container.appendChild(el);
    }
  }

  function attachDividerListeners(el, splitNode, container) {
    let dragging = false;
    let startPos = 0;
    let startRatio = 0;
    let containerRect = null;

    function onDragStart(clientX, clientY) {
      dragging = true;
      containerRect = container.getBoundingClientRect();
      startRatio = splitNode.ratio;

      if (splitNode.direction === 'horizontal') {
        startPos = clientX;
      } else {
        startPos = clientY;
      }
    }

    function onDragMove(clientX, clientY) {
      if (!dragging) return;

      let newRatio;
      if (splitNode.direction === 'horizontal') {
        const delta = clientX - startPos;
        const containerWidth = containerRect.width;
        newRatio = startRatio + delta / containerWidth;
      } else {
        const delta = clientY - startPos;
        const containerHeight = containerRect.height;
        newRatio = startRatio + delta / containerHeight;
      }

      splitNode.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, newRatio));
      render(container);
    }

    function onDragEnd() {
      if (!dragging) return;
      dragging = false;
      saveLayouts();
      container.dispatchEvent(new CustomEvent('pane-resize'));
    }

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onDragStart(e.clientX, e.clientY);

      const onMove = (e) => onDragMove(e.clientX, e.clientY);
      const onUp = () => {
        onDragEnd();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      onDragStart(touch.clientX, touch.clientY);

      const onMove = (e) => {
        const t = e.touches[0];
        onDragMove(t.clientX, t.clientY);
      };
      const onEnd = () => {
        onDragEnd();
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      };
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
    }, { passive: false });
  }

  function getSessionIds(tabId) {
    const root = layouts[tabId];
    if (!root) return [];
    return collectLeaves(root);
  }

  function removeLayout(tabId) {
    delete layouts[tabId];
    if (activeTabId === tabId) {
      activeTabId = null;
      focusedSessionId = null;
    }
    saveLayouts();
  }

  function saveLayouts() {
    const serializable = {};
    for (const [tabId, root] of Object.entries(layouts)) {
      if (root) serializable[tabId] = root;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (_) {}
  }

  function loadLayouts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        layouts = JSON.parse(raw);
      }
    } catch (_) {
      layouts = {};
    }
  }

  let dropZoneElements = [];

  function showDropZones(sessionId) {
    hideDropZones();

    const pane = activeContainer && activeContainer.querySelector(`.pane[data-session="${sessionId}"]`);
    if (!pane) return;

    const zones = ['left', 'right', 'top', 'bottom', 'center'];
    for (const zone of zones) {
      const el = document.createElement('div');
      el.className = `pane-drop-zone pane-drop-zone--${zone}`;
      el.dataset.zone = zone;
      el.dataset.session = sessionId;
      el.style.position = 'absolute';
      el.style.pointerEvents = 'all';

      switch (zone) {
        case 'left':
          el.style.top = '10%'; el.style.left = '0'; el.style.width = '25%'; el.style.height = '80%';
          break;
        case 'right':
          el.style.top = '10%'; el.style.left = '75%'; el.style.width = '25%'; el.style.height = '80%';
          break;
        case 'top':
          el.style.top = '0'; el.style.left = '10%'; el.style.width = '80%'; el.style.height = '25%';
          break;
        case 'bottom':
          el.style.top = '75%'; el.style.left = '10%'; el.style.width = '80%'; el.style.height = '25%';
          break;
        case 'center':
          el.style.top = '25%'; el.style.left = '25%'; el.style.width = '50%'; el.style.height = '50%';
          break;
      }

      pane.appendChild(el);
      dropZoneElements.push(el);
    }
  }

  function hideDropZones() {
    for (const el of dropZoneElements) {
      el.remove();
    }
    dropZoneElements = [];
  }

  function getDropZone(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;

    const zone = el.closest('.pane-drop-zone');
    if (!zone) return null;

    return {
      sessionId: zone.dataset.session,
      zone: zone.dataset.zone,
    };
  }

  return {
    getLayout,
    setActiveTab,
    splitPane,
    removePane,
    setFocus,
    getFocusedSessionId,
    resizeSplit,
    render,
    getSessionIds,
    removeLayout,
    saveLayouts,
    loadLayouts,
    showDropZones,
    hideDropZones,
    getDropZone,
  };
})();
