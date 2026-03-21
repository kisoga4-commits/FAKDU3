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
  function normalizeSyncPin(pin = '') {
    return String(pin || '').replace(/\D/g, '').slice(0, 6);
  }

  function resolveApi() {
    const fb = window.firebase;
    if (!fb || typeof fb.initializeApp !== 'function' || typeof fb.database !== 'function') return null;
    if (!fb.apps || !fb.apps.length) fb.initializeApp(firebaseConfig);
    const db = fb.database();
    const shopRoot = (shopId = '') => `shops/${shopId}`;

    return {
      async readSyncPin(pin = '') {

        const safePin = normalizeSyncPin(pin);
        if (safePin.length !== 6) return null;

        const safePin = String(pin || '').trim();
        if (!safePin) return null;

        const snap = await db.ref(`syncPins/${safePin}`).get();
        if (!snap.exists()) return null;
        const payload = snap.val() || {};
        return {
          pin: safePin,
          shopId: String(payload.shopId || ''),
          syncVersion: Number(payload.syncVersion || 0),
          masterDeviceId: String(payload.masterDeviceId || ''),
          active: payload.active !== false,
          updatedAt: Number(payload.updatedAt || 0)
        };
      },
      async readSyncMeta(shopId = '') {
        if (!shopId) return null;
        const snap = await db.ref(`${shopRoot(shopId)}/master`).get();
        return snap.exists() ? snap.val() : null;
      },
      async writeSyncMeta(shopId = '', meta = {}) {
        if (!shopId) return;
        const safeVersion = Number(meta.syncVersion || 1);

        const safePin = normalizeSyncPin(meta.currentSyncPin || '');
        const masterPath = `${shopRoot(shopId)}/master`;
        const prevSnap = await db.ref(masterPath).get();
        const prevPin = normalizeSyncPin(prevSnap.val()?.currentSyncPin || '');

        const safePin = String(meta.currentSyncPin || '').trim();
        const masterPath = `${shopRoot(shopId)}/master`;
        const prevSnap = await db.ref(masterPath).get();
        const prevPin = String(prevSnap.val()?.currentSyncPin || '').trim();

        const payload = {
          shopId,
          shopName: meta.shopName || 'FAKDU',
          masterDeviceId: meta.masterDeviceId || '',
          currentSyncPin: safePin,
          syncVersion: safeVersion,
          approvedClients: Array.isArray(meta.approvedClients) ? meta.approvedClients : [],
          clientSessions: (meta.clientSessions && typeof meta.clientSessions === 'object') ? meta.clientSessions : {},
          updatedAt: Date.now()
        };
        await db.ref(masterPath).set(payload);
        if (safePin) {
          await db.ref(`syncPins/${safePin}`).set({
            shopId,
            syncVersion: safeVersion,
            masterDeviceId: payload.masterDeviceId,
            active: true,
            updatedAt: Date.now()
          });
        }
        if (prevPin && prevPin !== safePin) {
          await db.ref(`syncPins/${prevPin}`).update({
            shopId,
            syncVersion: safeVersion,
            masterDeviceId: payload.masterDeviceId,
            active: false,
            updatedAt: Date.now()
          });
        }
      },
      listen(shopId = '', minTs = Date.now(), onMessage = () => {}) {
        if (!shopId) return () => {};
        const ref = db.ref(`${shopRoot(shopId)}/events`).limitToLast(150);
        const handler = (snap) => {
          const payload = snap.val();
          if (!payload) return;
          const isAccessRequest = payload.type === 'CLIENT_ACCESS_REQUEST';
          if (!isAccessRequest && Number(payload.createdAt || 0) < minTs) return;
          onMessage(payload);
        };
        ref.on('child_added', handler);
        return () => ref.off('child_added', handler);
      },
      listenJoinRequests(shopId = '', onRequest = () => {}) {
        if (!shopId) return () => {};
        const ref = db.ref(`${shopRoot(shopId)}/joinRequests`);
        const handler = (snap) => {
          const payload = snap.val();
          if (!payload || !payload.clientId) return;
          onRequest(payload);
        };
        ref.on('child_added', handler);
        ref.on('child_changed', handler);
        return () => {
          ref.off('child_added', handler);
          ref.off('child_changed', handler);
        };
      },
      listenClient(shopId = '', clientId = '', onClient = () => {}) {
        if (!shopId || !clientId) return () => {};
        const ref = db.ref(`${shopRoot(shopId)}/clients/${clientId}`);
        const handler = (snap) => {
          if (!snap.exists()) return;
          onClient(snap.val());
        };
        ref.on('value', handler);
        return () => ref.off('value', handler);
      },
      listenOperations(shopId = '', minTs = Date.now(), onOperation = () => {}) {
        if (!shopId) return () => {};
        const ref = db.ref(`${shopRoot(shopId)}/operations`).limitToLast(200);
        const handler = (snap) => {
          const payload = snap.val();
          if (!payload || Number(payload.createdAt || 0) < minTs) return;
          onOperation(payload);
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
          status: 'pending',
          requestedAt: Date.now(),
          updatedAt: Date.now()
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
        await db.ref(`${shopRoot(shopId)}/joinRequests`).remove();
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
      },
      async readSnapshot(shopId = '') {
        if (!shopId) return null;
        const snap = await db.ref(`${shopRoot(shopId)}/snapshot`).get();
        return snap.exists() ? snap.val() : null;
      }
    };
  }

  window.FakduSync = { resolveApi };
  window.FakduFirebaseSync = window.FakduSync;
})();
