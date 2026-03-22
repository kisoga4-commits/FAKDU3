(() => {
  'use strict';

  /**
   * FAKDU sync.js (refactor)
   *
   * เป้าหมายไฟล์นี้:
   * 1) ใช้ flow pairing แค่ pair_hosts / pair_requests / pair_sessions
   * 2) ลดภาระ Firebase โดยไม่อ่าน root หรือ node ใหญ่สำหรับ pairing
   * 3) คงชื่อ API หลักให้ core.js/client-core.js เดิมยังเรียกต่อได้
   * 4) ตัดการพึ่ง CLIENT_ACCESS_REQUEST สำหรับ pairing โดยตรง
   */

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

  const PAIR_PIN_TTL_MS = 1000 * 60 * 10;        // 10 นาที
  const PAIR_REQUEST_TTL_MS = 1000 * 60 * 30;    // 30 นาที
  const PAIR_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 วัน
  const EVENTS_LIMIT = 80;
  const OPERATIONS_LIMIT = 120;

  let cachedApi = null;
  let firebaseBootstrapped = false;

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeSyncPin(pin = '') {
    return String(pin || '').replace(/\D/g, '').slice(0, 6);
  }

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function nowTs() {
    return Date.now();
  }

  function ensureFirebase() {
    const fb = window.firebase;
    if (!fb || typeof fb.initializeApp !== 'function' || typeof fb.database !== 'function') {
      return null;
    }
    if (!firebaseBootstrapped) {
      if (!fb.apps || !fb.apps.length) {
        fb.initializeApp(firebaseConfig);
      }
      firebaseBootstrapped = true;
    }
    return fb;
  }

  function resolveDb() {
    const fb = ensureFirebase();
    return fb ? fb.database() : null;
  }

  function shopRoot(shopId = '') {
    return `shops/${String(shopId || '').trim()}`;
  }

  function masterPath(shopId = '') {
    return `${shopRoot(shopId)}/master`;
  }

  function eventsPath(shopId = '') {
    return `${shopRoot(shopId)}/events`;
  }

  function operationsPath(shopId = '') {
    return `${shopRoot(shopId)}/operations`;
  }

  function snapshotPath(shopId = '') {
    return `${shopRoot(shopId)}/snapshot`;
  }

  function clientsPath(shopId = '') {
    return `${shopRoot(shopId)}/clients`;
  }

  function pairHostPath(parentMachineId = '') {
    return `pair_hosts/${String(parentMachineId || '').trim()}`;
  }

  function pairRequestsRoot(pin = '') {
    const safePin = normalizeSyncPin(pin);
    return `pair_requests/${safePin}`;
  }

  function pairRequestPath(pin = '', requestId = '') {
    const safePin = normalizeSyncPin(pin);
    const safeRequestId = String(requestId || '').trim();
    return safeRequestId ? `${pairRequestsRoot(safePin)}/${safeRequestId}` : pairRequestsRoot(safePin);
  }

  function pairSessionPath(childMachineId = '') {
    return `pair_sessions/${String(childMachineId || '').trim()}`;
  }

  async function queryPairHostByPin(db, pin = '') {
    const safePin = normalizeSyncPin(pin);
    if (safePin.length !== 6) return null;
    const snap = await db.ref('pair_hosts').orderByChild('pin').equalTo(safePin).limitToFirst(1).get();
    if (!snap.exists()) return null;
    const [hostKey, hostRaw] = Object.entries(snap.val() || {})[0] || [];
    if (!hostKey) return null;
    const host = asObject(hostRaw);
    const expiresAt = safeNumber(host.expires_at || host.expiresAt, 0);
    if (expiresAt && expiresAt < nowTs()) return null;
    return {
      key: hostKey,
      host: {
        parentMachineId: String(host.parentMachineId || hostKey || ''),
        shopId: String(host.shopId || ''),
        pin: safePin,
        syncVersion: safeNumber(host.syncVersion, 1),
        status: String(host.status || 'waiting'),
        expires_at: expiresAt,
        updatedAt: safeNumber(host.updatedAt, 0)
      }
    };
  }

  async function cleanupRequests(db, pin = '') {
    const safePin = normalizeSyncPin(pin);
    if (safePin.length !== 6) return;
    try {
      const snap = await db.ref(pairRequestsRoot(safePin)).limitToLast(100).get();
      if (!snap.exists()) return;
      const rows = snap.val() || {};
      const tasks = [];
      const now = nowTs();
      Object.entries(rows).forEach(([requestId, raw]) => {
        const payload = asObject(raw);
        const createdAt = safeNumber(payload.created_at || payload.createdAt, 0);
        const status = String(payload.status || 'pending').toLowerCase();
        const expired = createdAt > 0 && (now - createdAt) > PAIR_REQUEST_TTL_MS;
        if (expired || status === 'approved' || status === 'rejected') {
          tasks.push(db.ref(pairRequestPath(safePin, requestId)).remove());
        }
      });
      if (tasks.length) await Promise.all(tasks);
    } catch (error) {
      console.warn('[FAKDU][SYNC] cleanupRequests failed', error);
    }
  }

  async function cleanupSession(db, childMachineId = '') {
    const safeChildId = String(childMachineId || '').trim();
    if (!safeChildId) return;
    try {
      const ref = db.ref(pairSessionPath(safeChildId));
      const snap = await ref.get();
      if (!snap.exists()) return;
      const payload = asObject(snap.val());
      const updatedAt = safeNumber(payload.updatedAt || payload.approvedAt, 0);
      if (updatedAt && (nowTs() - updatedAt) > PAIR_SESSION_TTL_MS) {
        await ref.remove();
      }
    } catch (error) {
      console.warn('[FAKDU][SYNC] cleanupSession failed', error);
    }
  }

  function sanitizeJoinPayload(pin = '', client = {}) {
    const safePin = normalizeSyncPin(pin || client.pin || '');
    const clientId = String(client.clientId || client.child_machine_id || '').trim();
    const requestId = String(client.requestId || uid()).trim();
    const createdAt = safeNumber(client.created_at || client.createdAt, nowTs());
    return {
      requestId,
      pin: safePin,
      child_machine_id: clientId,
      clientId,
      child_name: String(client.child_name || client.profileName || client.name || 'เครื่องลูก'),
      child_avatar: String(client.child_avatar || client.avatar || ''),
      shopId: String(client.shopId || ''),
      syncVersion: safeNumber(client.syncVersion, 1),
      status: String(client.status || 'pending').toLowerCase(),
      approved: String(client.status || 'pending').toLowerCase() === 'approved',
      created_at: createdAt,
      updatedAt: nowTs()
    };
  }

  function sanitizeClientSession(childMachineId = '', extra = {}, status = 'approved') {
    const safeStatus = String(status || '').toLowerCase() === 'rejected' ? 'rejected' : 'approved';
    const token = String(extra.clientSessionToken || extra.signed_token || extra.token || '').trim();
    return {
      child_machine_id: String(childMachineId || extra.child_machine_id || extra.clientId || '').trim(),
      clientId: String(childMachineId || extra.clientId || extra.child_machine_id || '').trim(),
      requestId: String(extra.requestId || '').trim(),
      pin: normalizeSyncPin(extra.pin || ''),
      shopId: String(extra.shopId || ''),
      syncVersion: safeNumber(extra.sessionSyncVersion || extra.syncVersion, 1),
      sessionSyncVersion: safeNumber(extra.sessionSyncVersion || extra.syncVersion, 1),
      status: safeStatus,
      approved: safeStatus === 'approved',
      clientSessionToken: token,
      signed_token: token,
      approvedAt: safeNumber(extra.approvedAt, nowTs()),
      approvedBy: String(extra.approvedBy || extra.approved_by || ''),
      updatedAt: nowTs()
    };
  }

  function buildApi(db) {
    return {
      async lookupPinToShopId(pin = '') {
        return this.readSyncPin(pin);
      },

      async readSyncPin(pin = '') {
        const result = await queryPairHostByPin(db, pin);
        return result ? result.host : null;
      },

      async readSyncMeta(shopId = '') {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId) return null;
        const snap = await db.ref(masterPath(safeShopId)).get();
        return snap.exists() ? snap.val() : null;
      },

      async writeSyncMeta(shopId = '', meta = {}) {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId) return;

        const safePin = normalizeSyncPin(meta.currentSyncPin || '');
        const safeVersion = safeNumber(meta.syncVersion, 1);
        const safeMasterDeviceId = String(meta.masterDeviceId || '').trim();

        const payload = {
          shopId: safeShopId,
          shopName: String(meta.shopName || 'FAKDU'),
          masterDeviceId: safeMasterDeviceId,
          currentSyncPin: safePin,
          syncVersion: safeVersion,
          approvedClients: Array.isArray(meta.approvedClients) ? meta.approvedClients : [],
          clientSessions: asObject(meta.clientSessions),
          updatedAt: nowTs()
        };

        await db.ref(masterPath(safeShopId)).set(payload);

        if (safePin && safeMasterDeviceId) {
          await db.ref(pairHostPath(safeMasterDeviceId)).set({
            parentMachineId: safeMasterDeviceId,
            shopId: safeShopId,
            pin: safePin,
            syncVersion: safeVersion,
            status: 'waiting',
            expires_at: nowTs() + PAIR_PIN_TTL_MS,
            updatedAt: nowTs()
          });
          await cleanupRequests(db, safePin);
        }
      },

      listen(shopId = '', minTs = nowTs(), onMessage = () => {}) {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId || typeof onMessage !== 'function') return () => {};

        const ref = db.ref(eventsPath(safeShopId)).limitToLast(EVENTS_LIMIT);
        const handler = (snap) => {
          const payload = snap.val();
          if (!payload || typeof payload !== 'object') return;
          const createdAt = safeNumber(payload.createdAt, 0);
          if (createdAt && createdAt < minTs) return;
          onMessage(payload);
        };

        ref.on('child_added', handler);
        return () => ref.off('child_added', handler);
      },

      listenJoinRequests(pin = '', onRequest = () => {}) {
        const safePin = normalizeSyncPin(pin);
        if (safePin.length !== 6 || typeof onRequest !== 'function') return () => {};

        const ref = db.ref(pairRequestsRoot(safePin));
        const seenVersion = new Map();

        const pushRequest = (snap) => {
          const payload = asObject(snap.val());
          if (!payload.requestId && !snap.key) return;

          const requestId = String(snap.key || payload.requestId || '').trim();
          const updatedAt = safeNumber(payload.updatedAt || payload.created_at || payload.createdAt, 0);
          const lastVersion = safeNumber(seenVersion.get(requestId), 0);
          if (updatedAt && lastVersion && updatedAt < lastVersion) return;
          seenVersion.set(requestId, updatedAt || nowTs());

          const createdAt = safeNumber(payload.created_at || payload.createdAt, 0);
          if (createdAt && (nowTs() - createdAt) > PAIR_REQUEST_TTL_MS) return;

          onRequest({
            ...payload,
            requestId,
            pin: safePin
          });
        };

        ref.on('child_added', pushRequest);
        ref.on('child_changed', pushRequest);

        return () => {
          ref.off('child_added', pushRequest);
          ref.off('child_changed', pushRequest);
          seenVersion.clear();
        };
      },

      listenClientApprovalStatus(pin = '', clientId = '', requestIdOrCb = '', maybeCb = null) {
        const safePin = normalizeSyncPin(pin);
        const safeClientId = String(clientId || '').trim();
        const requestId = typeof requestIdOrCb === 'string' ? String(requestIdOrCb || '').trim() : '';
        const onStatus = typeof requestIdOrCb === 'function' ? requestIdOrCb : maybeCb;
        if (!safeClientId || typeof onStatus !== 'function') return () => {};

        const stops = [];
        const sessionRef = db.ref(pairSessionPath(safeClientId));

        const emit = (payload, source = '') => {
          const row = asObject(payload);
          if (!Object.keys(row).length) return;
          const payloadClientId = String(row.child_machine_id || row.clientId || '').trim();
          if (payloadClientId && payloadClientId !== safeClientId) return;
          onStatus({ ...row, source });
        };

        const sessionHandler = (snap) => {
          if (!snap.exists()) return;
          emit(snap.val(), 'session');
        };
        sessionRef.on('value', sessionHandler);
        stops.push(() => sessionRef.off('value', sessionHandler));

        if (safePin.length === 6 && requestId) {
          const requestRef = db.ref(pairRequestPath(safePin, requestId));
          const requestHandler = (snap) => {
            if (!snap.exists()) return;
            emit(snap.val(), 'request');
          };
          requestRef.on('value', requestHandler);
          stops.push(() => requestRef.off('value', requestHandler));
        }

        cleanupSession(db, safeClientId).catch(() => {});

        return () => {
          stops.forEach((stop) => {
            try { stop(); } catch (_) {}
          });
        };
      },

      listenClient(shopId = '', clientId = '', onClient = () => {}) {
        const safeShopId = String(shopId || '').trim();
        const safeClientId = String(clientId || '').trim();
        if (!safeShopId || !safeClientId || typeof onClient !== 'function') return () => {};

        const ref = db.ref(`${clientsPath(safeShopId)}/${safeClientId}`);
        const handler = (snap) => {
          if (!snap.exists()) return;
          onClient(snap.val());
        };

        ref.on('value', handler);
        return () => ref.off('value', handler);
      },

      listenOperations(shopId = '', minTs = nowTs(), onOperation = () => {}) {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId || typeof onOperation !== 'function') return () => {};

        const ref = db.ref(operationsPath(safeShopId)).limitToLast(OPERATIONS_LIMIT);
        const handler = (snap) => {
          const payload = snap.val();
          if (!payload || typeof payload !== 'object') return;
          const createdAt = safeNumber(payload.createdAt || payload.timestamp, 0);
          if (createdAt && createdAt < minTs) return;
          onOperation(payload);
        };

        ref.on('child_added', handler);
        return () => ref.off('child_added', handler);
      },

      async send(shopId = '', message = {}) {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId || !message || !message.type) return;
        const eventId = String(message.id || uid()).trim();
        await db.ref(`${eventsPath(safeShopId)}/${eventId}`).set({
          ...message,
          id: eventId,
          shopId: String(message.shopId || safeShopId),
          createdAt: nowTs()
        });
      },

      async writeJoinRequest(pin = '', client = {}) {
        const safe = sanitizeJoinPayload(pin, client);
        if (safe.pin.length !== 6 || !safe.clientId || !safe.requestId) return null;

        const hostInfo = await queryPairHostByPin(db, safe.pin);
        if (!hostInfo || !hostInfo.host || hostInfo.host.status !== 'waiting') {
          throw new Error('PAIR_PIN_NOT_FOUND');
        }

        const latestForClientSnap = await db.ref(pairRequestsRoot(safe.pin))
          .orderByChild('child_machine_id')
          .equalTo(safe.clientId)
          .limitToLast(5)
          .get();

        const updates = {};
        if (latestForClientSnap.exists()) {
          Object.entries(latestForClientSnap.val() || {}).forEach(([rowId, raw]) => {
            const row = asObject(raw);
            const status = String(row.status || 'pending').toLowerCase();
            if (status === 'pending' && rowId !== safe.requestId) {
              updates[pairRequestPath(safe.pin, rowId)] = null;
            }
          });
        }
        updates[pairRequestPath(safe.pin, safe.requestId)] = {
          ...safe,
          shopId: safe.shopId || hostInfo.host.shopId || '',
          syncVersion: safe.syncVersion || hostInfo.host.syncVersion || 1,
          parentMachineId: hostInfo.host.parentMachineId || '',
          hostUpdatedAt: hostInfo.host.updatedAt || 0,
          updatedAt: nowTs()
        };
        await db.ref().update(updates);
        return safe.requestId;
      },

      async sendJoinRequest(pin = '', client = {}) {
        return this.writeJoinRequest(pin, client);
      },

      async resolveJoinRequest(pin = '', clientId = '', status = 'approved', extra = {}) {
        const safePin = normalizeSyncPin(pin || extra.pin || '');
        const safeClientId = String(extra.child_machine_id || extra.clientId || clientId || '').trim();
        if (safePin.length !== 6 || !safeClientId) return;

        const safeStatus = String(status || '').toLowerCase() === 'rejected' ? 'rejected' : 'approved';
        let targetRequestId = String(extra.requestId || '').trim();

        if (!targetRequestId) {
          const snap = await db.ref(pairRequestsRoot(safePin))
            .orderByChild('child_machine_id')
            .equalTo(safeClientId)
            .limitToLast(1)
            .get();
          if (snap.exists()) {
            targetRequestId = Object.keys(snap.val() || {})[0] || '';
          }
        }

        const updates = {};
        if (targetRequestId) {
          updates[pairRequestPath(safePin, targetRequestId)] = {
            ...sanitizeJoinPayload(safePin, {
              requestId: targetRequestId,
              clientId: safeClientId,
              child_machine_id: safeClientId,
              child_name: extra.child_name || extra.profileName || extra.name || 'เครื่องลูก',
              child_avatar: extra.child_avatar || extra.avatar || '',
              shopId: extra.shopId || '',
              syncVersion: extra.syncVersion || 1,
              created_at: extra.created_at || nowTs()
            }),
            status: safeStatus,
            approved: safeStatus === 'approved',
            clientSessionToken: String(extra.clientSessionToken || extra.signed_token || ''),
            signed_token: String(extra.signed_token || extra.clientSessionToken || ''),
            approvedAt: safeNumber(extra.approvedAt, nowTs()),
            approvedBy: String(extra.approvedBy || extra.approved_by || ''),
            updatedAt: nowTs()
          };
        }

        updates[pairSessionPath(safeClientId)] = sanitizeClientSession(safeClientId, {
          ...extra,
          pin: safePin,
          requestId: targetRequestId || String(extra.requestId || ''),
          child_machine_id: safeClientId,
          clientId: safeClientId
        }, safeStatus);

        await db.ref().update(updates);
      },

      async approveClient(pin = '', clientId = '', extra = {}) {
        return this.resolveJoinRequest(pin, clientId, 'approved', extra);
      },

      async rejectClient(pin = '', clientId = '', extra = {}) {
        return this.resolveJoinRequest(pin, clientId, 'rejected', extra);
      },

      async upsertClient(shopId = '', client = {}) {
        const safeShopId = String(shopId || '').trim();
        const safeClientId = String(client.clientId || '').trim();
        if (!safeShopId || !safeClientId) return;

        await db.ref(`${clientsPath(safeShopId)}/${safeClientId}`).set({
          ...client,
          clientId: safeClientId,
          sessionVersion: safeNumber(client.sessionVersion || client.sessionSyncVersion || client.syncVersion, 1),
          updatedAt: nowTs()
        });
      },

      async clearClientSessions(shopId = '') {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId) return;
        await db.ref(clientsPath(safeShopId)).remove();
      },

      async writeOperation(shopId = '', operation = {}) {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId || !operation || !operation.type) return;
        const opId = String(operation.opId || operation.id || uid()).trim();
        await db.ref(`${operationsPath(safeShopId)}/${opId}`).set({
          ...operation,
          shopId: String(operation.shopId || safeShopId),
          opId,
          timestamp: safeNumber(operation.timestamp, nowTs()),
          createdAt: nowTs()
        });
      },

      async writeSnapshot(shopId = '', snapshot = {}) {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId) return;
        await db.ref(snapshotPath(safeShopId)).set({
          ...snapshot,
          shopId: String(snapshot.shopId || safeShopId),
          updatedAt: nowTs()
        });
      },

      async readSnapshot(shopId = '') {
        const safeShopId = String(shopId || '').trim();
        if (!safeShopId) return null;
        const snap = await db.ref(snapshotPath(safeShopId)).get();
        return snap.exists() ? snap.val() : null;
      }
    };
  }

  function resolveApi() {
    if (cachedApi) return cachedApi;
    const db = resolveDb();
    if (!db) return null;
    cachedApi = buildApi(db);
    return cachedApi;
  }

  window.FakduSync = { resolveApi };
  window.FakduFirebaseSync = window.FakduSync;
})();
