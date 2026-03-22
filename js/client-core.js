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

  function readPendingConnect() {
    const pin = String(localStorage.getItem('FAKDU_PENDING_CLIENT_PIN') || '').trim();
    const shopId = String(localStorage.getItem('FAKDU_PENDING_MASTER_SHOP_ID') || '').trim();
    const clientId = String(localStorage.getItem('FAKDU_CLIENT_ID') || '').trim();
    return { pin, shopId, clientId };
  }

  function listenApprovalAndRedirectIfNeeded() {
    if (isClientPage()) return;
    const hasSession = !!readClientSession();
    if (hasSession) return;
    const pending = readPendingConnect();
    if (!pending.shopId || !pending.clientId) return;
    const api = window.FakduSync?.resolveApi?.();
    if (!api) return;
    const listenFn = typeof api.listenClientApprovalStatus === 'function'
      ? api.listenClientApprovalStatus.bind(api)
      : api.listenClient?.bind(api);
    if (typeof listenFn !== 'function') return;
    listenFn(pending.shopId, pending.clientId, async (payload) => {
      if (!payload) return;
      if (payload.approved === true && payload.clientSessionToken) {
        const session = {
          shopId: pending.shopId,
          clientId: pending.clientId,
          profileName: String(localStorage.getItem('FAKDU_CLIENT_PROFILE_NAME') || 'เครื่องลูก'),
          clientSessionToken: payload.clientSessionToken,
          syncVersion: Number(payload.sessionSyncVersion || payload.syncVersion || 1)
        };
        localStorage.setItem('FAKDU_CLIENT_SESSION', JSON.stringify(session));
        localStorage.setItem(LS_FORCE_CLIENT_MODE, 'true');
        if (window.FakduDB?.saveClientSession) await window.FakduDB.saveClientSession(session);
        redirectTo(CLIENT_PAGE);
      }
      if (payload.approved === false || String(payload.status || '').toLowerCase() === 'rejected') {
        localStorage.removeItem(LS_FORCE_CLIENT_MODE);
      }
    });
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
    listenApprovalAndRedirectIfNeeded();

    document.documentElement?.setAttribute('data-client-core', 'ready');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }
})();
