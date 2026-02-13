// App entry point — runs on index.html
(() => {
  // Require authentication
  if (!Auth.requireAuth()) return;

  // Load existing sessions or create first tab
  Tabs.loadSessions();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
})();
