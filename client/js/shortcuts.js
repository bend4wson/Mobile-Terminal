// Shortcuts module — mobile shortcut bar handlers
(() => {
  const buttons = document.querySelectorAll('.shortcut-btn');

  function handleShortcut(e) {
    e.preventDefault();
    e.stopPropagation();

    const btn = e.currentTarget;
    const input = btn.dataset.input;
    if (input) {
      const decoded = input
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\t/g, '\t')
        .replace(/\\n/g, '\n');
      TerminalManager.sendInput(decoded);
    }
    // Re-focus terminal without opening keyboard
    TerminalManager.focusTerminal();
  }

  buttons.forEach((btn) => {
    // Use touchstart to intercept before the browser can open the keyboard
    btn.addEventListener('touchstart', handleShortcut, { passive: false });
    // Keep click for desktop users
    btn.addEventListener('click', handleShortcut);
  });
})();
