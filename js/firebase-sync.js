(() => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM',
    authDomain: 'pakdu-a26c4.firebaseapp.com',
    databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'pakdu-a26c4',
    storageBucket: 'pakdu-a26c4.firebasestorage.app',
    messagingSenderId: '414809008203',
    appId: '1:414809008203:web:757dceafa78d91900d85ce',
    measurementId: 'G-2B03KJ4D68'
  };

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function resolveApi() {
    const fb = window.firebase;
    if (!fb || typeof fb.initializeApp !== 'function' || typeof fb.database !== 'function') return null;
    if (!fb.apps || !fb.apps.length) fb.initializeApp(firebaseConfig);
    const db = fb.database();
    function shopRoot(shopId = '') {
      return `shops/${shopId}`;
    }
    return {
      async readSyncMeta(shopId = '') {
        if (!shopId) return null;
        const snap = await db.ref(`${shopRoot(shopId)}/master`).get();
        return snap.exists() ? snap.val() : null;
      },
      async writeSyncMeta(shopId = '', meta = {}) {
        if (!shopId) return;
        const safeVersion = Number(meta.syncVersion || 1);
        const payload = {
          shopId,
          shopName: meta.shopName || 'FAKDU',
          masterDeviceId: meta.masterDeviceId || '',
          currentSyncPin: meta.currentSyncPin || '',
          syncVersion: safeVersion,
          approvedClients: Array.isArray(meta.approvedClients) ? meta.approvedClients : [],
          updatedAt: Date.now()
        };
        await db.ref(`${shopRoot(shopId)}/master`).set(payload);
      },
      listen(shopId = '', minTs = Date.now(), onMessage = () => {}) {
        if (!shopId) return () => {};
        const ref = db.ref(`${shopRoot(shopId)}/events`).limitToLast(100);
        const handler = (snap) => {
          const payload = snap.val();
          if (!payload || Number(payload.createdAt || 0) < minTs) return;
          onMessage(payload);
        };
        ref.on('child_added', handler);
        return () => ref.off('child_added', handler);
      },
      async send(shopId = '', message = {}) {
        if (!shopId || !message?.type) return;
        await db.ref(`${shopRoot(shopId)}/events/${uid()}`).set({
          ...message,
          id: message.id || uid(),
          createdAt: Date.now()
        });
      },
      async writeJoinRequest(shopId = '', client = {}) {
        if (!shopId || !client?.clientId) return;
        await db.ref(`${shopRoot(shopId)}/joinRequests/${client.clientId}`).set({
          ...client,
          requestedAt: Date.now()
        });
      },
      async upsertClient(shopId = '', client = {}) {
        if (!shopId || !client?.clientId) return;
        await db.ref(`${shopRoot(shopId)}/clients/${client.clientId}`).set({
          ...client,
          updatedAt: Date.now()
        });
      },
      async clearClientSessions(shopId = '') {
        if (!shopId) return;
        await db.ref(`${shopRoot(shopId)}/clients`).remove();
      },
      async writeOperation(shopId = '', operation = {}) {
        if (!shopId || !operation?.type) return;
        const opId = String(operation.opId || operation.id || uid());
        await db.ref(`${shopRoot(shopId)}/operations/${opId}`).set({
          ...operation,
          opId,
          createdAt: Date.now()
        });
      },
      async writeSnapshot(shopId = '', snapshot = {}) {
        if (!shopId) return;
        await db.ref(`${shopRoot(shopId)}/snapshot`).set({
          ...snapshot,
          updatedAt: Date.now()
        });
      }
    };
  }

  window.FakduFirebaseSync = {
    resolveApi
  };
})();
