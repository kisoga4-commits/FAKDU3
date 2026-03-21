(() => {
  'use strict';

  // NOTE:
  // - Client flow is currently driven by `js/core.js`.
  // - Keep this file as a dedicated extension point for client-only behavior
  //   to avoid loading invalid HTML as JavaScript (which breaks runtime).

  const ready = () => {
    document.documentElement?.setAttribute('data-client-core', 'ready');
    if (window.console && typeof window.console.debug === 'function') {
      console.debug('[FAKDU] client-core loaded');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }
})();
