(() => {
  'use strict';

  const LS_FORCE_CLIENT_MODE = 'FAKDU_FORCE_CLIENT_MODE';
  const CLIENT_PAGE = 'client.html';
  const INDEX_PAGE = 'index.html';

  function readClientSession() {
    try {
      const raw = localStorage.getItem('FAKDU_CLIENT_SESSION');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.clientSessionToken ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function isClientPage() {
    return /client\.html$/i.test(window.location.pathname || '');
  }

  function isClientQueryMode() {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('mode') === 'client';
  }

  function redirectTo(path) {
    if (!path) return;
    window.location.replace(path);
  }

  const ready = () => {
    const hasSession = !!readClientSession();
    const forceClientMode = localStorage.getItem(LS_FORCE_CLIENT_MODE) === 'true';

    if (!isClientPage() && (hasSession || forceClientMode || isClientQueryMode())) {
      redirectTo(CLIENT_PAGE);
      return;
    }

    if (isClientPage() && !hasSession) {
      localStorage.removeItem(LS_FORCE_CLIENT_MODE);
      redirectTo(INDEX_PAGE);
      return;
    }

    document.documentElement?.setAttribute('data-client-core', 'ready');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }
})();
