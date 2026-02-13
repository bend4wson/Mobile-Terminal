// Shortcuts module — mobile shortcut bar handlers
(() => {
  const buttons = document.querySelectorAll('.shortcut-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const input = btn.dataset.input;
      if (input) {
        // Decode escape sequences from data attributes
        const decoded = input
          .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\t/g, '\t')
          .replace(/\\n/g, '\n');
        TerminalManager.sendInput(decoded);
      }
      TerminalManager.focusTerminal();
    });
  });
})();
