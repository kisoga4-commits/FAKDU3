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
    return {
      async readSyncMeta(shopId = '') {
        if (!shopId) return null;
        const snap = await db.ref(`fakduSync/${shopId}/meta`).get();
        return snap.exists() ? snap.val() : null;
      },
      async writeSyncMeta(shopId = '', meta = {}) {
        if (!shopId) return;
        await db.ref(`fakduSync/${shopId}/meta`).set({ ...meta, updatedAt: Date.now() });
      },
      listen(shopId = '', minTs = Date.now(), onMessage = () => {}) {
        if (!shopId) return () => {};
        const ref = db.ref(`fakduSync/${shopId}/events`).limitToLast(100);
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
        await db.ref(`fakduSync/${shopId}/events/${uid()}`).set({
          ...message,
          id: message.id || uid(),
          createdAt: Date.now()
        });
      }
    };
  }

  window.FakduFirebaseSync = {
    resolveApi
  };
})();
