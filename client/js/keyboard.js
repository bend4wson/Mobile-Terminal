// Keyboard module — handles iOS virtual keyboard viewport issues
(() => {
  const app = document.querySelector('.app');
  const toggleBtn = document.getElementById('keyboard-toggle');
  let keyboardDismissed = false;

  // Use visualViewport API to resize app when iOS keyboard opens
  if (window.visualViewport) {
    const onViewportResize = () => {
      const vvh = window.visualViewport.height;
      document.body.style.setProperty('--vvh', String(Math.floor(vvh)));

      // Detect if keyboard is likely open (viewport significantly smaller than window)
      const keyboardOpen = window.innerHeight - vvh > 100;
      document.body.classList.toggle('keyboard-open', keyboardOpen);

      // Scroll to keep the app pinned to the top of the visual viewport
      window.scrollTo(0, 0);
    };

    window.visualViewport.addEventListener('resize', onViewportResize);
    window.visualViewport.addEventListener('scroll', () => window.scrollTo(0, 0));
    // Run once on init
    onViewportResize();
  }

  // Toggle button: blur terminal to dismiss keyboard, or refocus to open it
  if (toggleBtn) {
    toggleBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (keyboardDismissed) {
        // Re-open keyboard by focusing terminal
        keyboardDismissed = false;
        toggleBtn.classList.remove('keyboard-hidden');
        TerminalManager.focusTerminal();
      } else {
        // Dismiss keyboard by blurring everything
        keyboardDismissed = true;
        toggleBtn.classList.add('keyboard-hidden');
        document.activeElement?.blur();
        // Also blur the hidden textarea xterm uses for input
        const xtermTextarea = document.querySelector('.xterm-helper-textarea');
        if (xtermTextarea) xtermTextarea.blur();
      }
    }, { passive: false });

    // Desktop fallback
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (keyboardDismissed) {
        keyboardDismissed = false;
        toggleBtn.classList.remove('keyboard-hidden');
        TerminalManager.focusTerminal();
      } else {
        keyboardDismissed = true;
        toggleBtn.classList.add('keyboard-hidden');
        document.activeElement?.blur();
      }
    });
  }
})();
