(() => {
  'use strict';

  /**
   * FAKDU client-core.js (refactor)
   *
   * หน้าที่ของไฟล์นี้:
   * 1) ถ้าหน้า index ของเครื่องลูกยังไม่มี session แต่มี pending PIN/request -> รอฟังผลอนุมัติ
   * 2) ถ้าอนุมัติ -> เซฟ session ลง localStorage + IndexedDB แล้วพาเข้า client.html
   * 3) ถ้าปฏิเสธ -> เคลียร์ force client mode และคงให้อยู่หน้า index
   * 4) หลีกเลี่ยงการเปิด listener ซ้ำซ้อนกับ flow เก่า
   *
   * ไฟล์นี้ออกแบบให้ทำงานร่วมกับ sync.js รีแฟกเตอร์ชุด pair_hosts / pair_requests / pair_sessions
   */

  const LS_FORCE_CLIENT_MODE = 'FAKDU_FORCE_CLIENT_MODE';
  const LS_PENDING_PAIR_REQUEST_ID = 'FAKDU_PENDING_PAIR_REQUEST_ID';
  const LS_PENDING_CLIENT_PIN = 'FAKDU_PENDING_CLIENT_PIN';
  const LS_PENDING_MASTER_SHOP_ID = 'FAKDU_PENDING_MASTER_SHOP_ID';
  const LS_CLIENT_ID = 'FAKDU_CLIENT_ID';
  const LS_CLIENT_PROFILE_NAME = 'FAKDU_CLIENT_PROFILE_NAME';
  const LS_CLIENT_SESSION = 'FAKDU_CLIENT_SESSION';
  const LS_LAST_PAIR_REJECT = 'FAKDU_LAST_PAIR_REJECT';
  const CLIENT_PAGE = 'client.html';
  const INDEX_PAGE = 'index.html';
  const RETRY_RESOLVE_API_MS = 1000;
  const MAX_RESOLVE_API_RETRIES = 15;

  let stopApprovalListener = null;
  let resolveApiRetryTimer = null;
  let resolveApiRetryCount = 0;
  let applyingApproval = false;

  function parseJson(raw, fallback = null) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeTrim(value = '') {
    return String(value || '').trim();
  }

  function normalizeSyncPin(pin = '') {
    return String(pin || '').replace(/\D/g, '').slice(0, 6);
  }

  function isClientPage() {
    return /client\.html$/i.test(window.location.pathname || '');
  }

  function isIndexLikePage() {
    return !isClientPage();
  }

  function redirectTo(path) {
    if (!path) return;
    const current = (window.location.pathname || '').split('/').pop() || '';
    if (current.toLowerCase() === path.toLowerCase()) return;
    window.location.replace(path);
  }

  function readLocalClientSession() {
    const parsed = parseJson(localStorage.getItem(LS_CLIENT_SESSION), null);
    return parsed && typeof parsed === 'object' && parsed.clientSessionToken ? parsed : null;
  }

  async function readPersistedClientSession() {
    const localSession = readLocalClientSession();
    if (localSession) return localSession;
    try {
      if (window.FakduDB?.loadClientSession) {
        const persisted = await window.FakduDB.loadClientSession();
        if (persisted && persisted.clientSessionToken) {
          localStorage.setItem(LS_CLIENT_SESSION, JSON.stringify(persisted));
          return persisted;
        }
      }
    } catch (error) {
      console.warn('[FAKDU][CLIENT-CORE] loadClientSession failed', error);
    }
    return null;
  }

  async function persistClientSession(session) {
    const safeSession = session && typeof session === 'object' ? session : null;
    if (!safeSession || !safeSession.clientSessionToken) return null;

    localStorage.setItem(LS_CLIENT_SESSION, JSON.stringify(safeSession));
    localStorage.setItem(LS_FORCE_CLIENT_MODE, 'true');

    try {
      if (window.FakduDB?.saveClientSession) {
        await window.FakduDB.saveClientSession(safeSession);
      }
    } catch (error) {
      console.warn('[FAKDU][CLIENT-CORE] saveClientSession failed', error);
    }

    return safeSession;
  }

  async function clearPersistedClientSession() {
    localStorage.removeItem(LS_CLIENT_SESSION);
    localStorage.removeItem(LS_FORCE_CLIENT_MODE);
    try {
      if (window.FakduDB?.clearClientSession) {
        await window.FakduDB.clearClientSession();
      }
    } catch (error) {
      console.warn('[FAKDU][CLIENT-CORE] clearClientSession failed', error);
    }
  }

  function readPendingConnect() {
    const pin = normalizeSyncPin(localStorage.getItem(LS_PENDING_CLIENT_PIN) || '');
    const shopId = safeTrim(localStorage.getItem(LS_PENDING_MASTER_SHOP_ID) || '');
    const clientId = safeTrim(localStorage.getItem(LS_CLIENT_ID) || '');
    const requestId = safeTrim(localStorage.getItem(LS_PENDING_PAIR_REQUEST_ID) || '');
    const profileName = safeTrim(localStorage.getItem(LS_CLIENT_PROFILE_NAME) || '') || 'เครื่องลูก';
    return { pin, shopId, clientId, requestId, profileName };
  }

  function clearPendingConnect(keepClientIdentity = true) {
    localStorage.removeItem(LS_PENDING_CLIENT_PIN);
    localStorage.removeItem(LS_PENDING_MASTER_SHOP_ID);
    localStorage.removeItem(LS_PENDING_PAIR_REQUEST_ID);
    localStorage.removeItem(LS_LAST_PAIR_REJECT);
    if (!keepClientIdentity) {
      localStorage.removeItem(LS_CLIENT_ID);
      localStorage.removeItem(LS_CLIENT_PROFILE_NAME);
    }
  }

  function markRejected(payload = {}) {
    const record = {
      status: 'rejected',
      at: Date.now(),
      reason: safeTrim(payload.reason || payload.message || '')
    };
    localStorage.setItem(LS_LAST_PAIR_REJECT, JSON.stringify(record));
    localStorage.removeItem(LS_FORCE_CLIENT_MODE);
  }

  async function handleApprovedPayload(payload, pending) {
    if (applyingApproval) return;
    applyingApproval = true;
    try {
      const token = safeTrim(payload.clientSessionToken || payload.signed_token || payload.token || '');
      if (!token) return;

      const session = {
        shopId: safeTrim(payload.shopId || pending.shopId || ''),
        clientId: safeTrim(payload.clientId || payload.child_machine_id || pending.clientId || ''),
        profileName: safeTrim(localStorage.getItem(LS_CLIENT_PROFILE_NAME) || pending.profileName || 'เครื่องลูก'),
        clientSessionToken: token,
        syncVersion: Number(payload.sessionSyncVersion || payload.syncVersion || 1),
        sessionSyncVersion: Number(payload.sessionSyncVersion || payload.syncVersion || 1),
        approvedAt: Number(payload.approvedAt || Date.now()),
        approvedBy: safeTrim(payload.approvedBy || ''),
        pin: normalizeSyncPin(payload.pin || pending.pin || '')
      };

      await persistClientSession(session);
      clearPendingConnect(true);

      if (!isClientPage()) {
        redirectTo(CLIENT_PAGE);
      }
    } finally {
      applyingApproval = false;
    }
  }

  async function handleRejectedPayload(payload = {}) {
    markRejected(payload);
    clearPendingConnect(true);
    await clearPersistedClientSession();
    if (isClientPage()) {
      redirectTo(INDEX_PAGE);
    }
  }

  function stopApprovalWatch() {
    if (typeof stopApprovalListener === 'function') {
      try {
        stopApprovalListener();
      } catch (_) {}
    }
    stopApprovalListener = null;

    if (resolveApiRetryTimer) {
      clearTimeout(resolveApiRetryTimer);
      resolveApiRetryTimer = null;
    }
    resolveApiRetryCount = 0;
  }

  function shouldStartApprovalWatch(session, pending) {
    if (session && session.clientSessionToken) return false;
    if (!pending.clientId) return false;
    if (!pending.pin) return false;
    return true;
  }

  function startApprovalWatch(pending) {
    stopApprovalWatch();

    const tryStart = () => {
      const api = window.FakduSync?.resolveApi?.();
      if (!api || typeof api.listenClientApprovalStatus !== 'function') {
        resolveApiRetryCount += 1;
        if (resolveApiRetryCount <= MAX_RESOLVE_API_RETRIES) {
          resolveApiRetryTimer = window.setTimeout(tryStart, RETRY_RESOLVE_API_MS);
        }
        return;
      }

      console.log('[FAKDU][CLIENT-CORE] waiting approval', pending);
      stopApprovalListener = api.listenClientApprovalStatus(
        pending.pin,
        pending.clientId,
        pending.requestId,
        async (payload) => {
          console.log('[FAKDU][CLIENT-CORE] approval update', payload);
          if (!payload || typeof payload !== 'object') return;

          const status = String(payload.status || '').toLowerCase();
          const approved = payload.approved === true || status === 'approved';
          const rejected = payload.approved === false || status === 'rejected';

          if (approved) {
            await handleApprovedPayload(payload, pending);
            return;
          }

          if (rejected) {
            await handleRejectedPayload(payload);
          }
        }
      );
    };

    tryStart();
  }

  async function ready() {
    const session = await readPersistedClientSession();
    const forceClientMode = localStorage.getItem(LS_FORCE_CLIENT_MODE) === 'true';
    const pending = readPendingConnect();

    if (isIndexLikePage() && session?.clientSessionToken) {
      redirectTo(CLIENT_PAGE);
      return;
    }

    if (isClientPage() && !session?.clientSessionToken && !forceClientMode) {
      redirectTo(INDEX_PAGE);
      return;
    }

    if (shouldStartApprovalWatch(session, pending)) {
      startApprovalWatch(pending);
    } else {
      stopApprovalWatch();
    }

    document.documentElement?.setAttribute('data-client-core', 'ready');
  }

  window.addEventListener('beforeunload', () => {
    stopApprovalWatch();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ready().catch((error) => console.error('[FAKDU][CLIENT-CORE] ready failed', error));
    }, { once: true });
  } else {
    ready().catch((error) => console.error('[FAKDU][CLIENT-CORE] ready failed', error));
  }
})();
