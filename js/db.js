(() => {
  'use strict';

  //* constants open
  const APP_VERSION = '9.46';
  const DB_NAME = 'FAKDU_V946_INDEXEDDB';
  const DB_VERSION = 1;

  const STORE_KV = 'kv';
  const STORE_META = 'meta';

  const KEY_MASTER_DB = 'master_db';
  const KEY_MASTER_SNAPSHOT = 'master_snapshot';
  const KEY_CLIENT_PROFILE = 'client_profile';
  const KEY_CLIENT_SESSION = 'client_session';
  const KEY_CLIENT_QUEUE = 'client_queue';
  const KEY_CLIENT_LAST_SYNC = 'client_last_sync';
  const KEY_DRAFTS = 'drafts';
  const KEY_SETTINGS_CACHE = 'settings_cache';

  const META_DEVICE_ID = 'device_install_id';
  const META_CREATED_AT = 'created_at';
  const META_LAST_SAVE_AT = 'last_save_at';
  const META_DB_VERSION = 'db_version';
  const META_APP_VERSION = 'app_version';
  const META_LAST_BACKUP_AT = 'last_backup_at';
  const META_LAST_IMPORT_AT = 'last_import_at';
  const META_PERSISTENT_OK = 'persistent_storage_ok';

  const LEGACY_MASTER_KEY = 'FAKDU_DB_V946';
  const LEGACY_DEVICE_KEY = 'FAKDU_DEVICE_INSTALL_ID';
  //* constants close

  //* helpers open
  function hasIndexedDB() {
    return typeof indexedDB !== 'undefined';
  }

  function jsonClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function randomHex(bytes = 8) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function makeDeviceId() {
    return `FDI-${randomHex(5).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function normalizeImportedBackup(parsed) {
    if (!parsed) throw new Error('ไฟล์สำรองข้อมูลว่างหรือไม่ถูกต้อง');

    if (isObject(parsed) && isObject(parsed.payload)) {
      return jsonClone(parsed.payload);
    }

    if (isObject(parsed) && isObject(parsed.data)) {
      return jsonClone(parsed.data);
    }

    if (isObject(parsed) && isObject(parsed.db)) {
      return jsonClone(parsed.db);
    }

    if (isObject(parsed)) {
      return jsonClone(parsed);
    }

    throw new Error('รูปแบบไฟล์สำรองข้อมูลไม่รองรับ');
  }
  //* helpers close

  //* indexeddb core open
  let dbPromise = null;

  function openIndexedDB() {
    if (!hasIndexedDB()) {
      return Promise.reject(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));
    }

    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }

        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };

      request.onsuccess = async () => {
        const db = request.result;
        db.onversionchange = () => {
          try { db.close(); } catch (_) {}
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('เปิดฐานข้อมูลไม่สำเร็จ'));
      };

      request.onblocked = () => {
        console.warn('[FAKDU DB] IndexedDB blocked');
      };
    });

    return dbPromise;
  }

  async function withStore(storeName, mode, worker) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error(`Transaction failed: ${storeName}`));
      tx.onabort = () => reject(tx.error || new Error(`Transaction aborted: ${storeName}`));

      Promise.resolve()
        .then(() => worker(store, tx))
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          try { tx.abort(); } catch (_) {}
          reject(error);
        });
    });
  }

  function idbRequestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  async function kvGet(key) {
    return withStore(STORE_KV, 'readonly', async (store) => {
      return idbRequestToPromise(store.get(key));
    });
  }

  async function kvSet(key, value) {
    return withStore(STORE_KV, 'readwrite', async (store) => {
      await idbRequestToPromise(store.put(value, key));
      return true;
    });
  }

  async function kvDelete(key) {
    return withStore(STORE_KV, 'readwrite', async (store) => {
      await idbRequestToPromise(store.delete(key));
      return true;
    });
  }

  async function metaGet(key) {
    return withStore(STORE_META, 'readonly', async (store) => {
      return idbRequestToPromise(store.get(key));
    });
  }

  async function metaSet(key, value) {
    return withStore(STORE_META, 'readwrite', async (store) => {
      await idbRequestToPromise(store.put(value, key));
      return true;
    });
  }

  async function metaDelete(key) {
    return withStore(STORE_META, 'readwrite', async (store) => {
      await idbRequestToPromise(store.delete(key));
      return true;
    });
  }
  //* indexeddb core close

  //* persistence open
  async function requestPersistentStorage() {
    try {
      if (!navigator.storage || typeof navigator.storage.persist !== 'function') return false;
      const granted = await navigator.storage.persist();
      await metaSet(META_PERSISTENT_OK, Boolean(granted));
      return Boolean(granted);
    } catch (_) {
      return false;
    }
  }

  async function estimateStorage() {
    try {
      if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
        return { quota: 0, usage: 0, usageDetails: {} };
      }
      return await navigator.storage.estimate();
    } catch (_) {
      return { quota: 0, usage: 0, usageDetails: {} };
    }
  }
  //* persistence close

  //* device id open
  async function getDeviceId() {
    const fromMeta = await metaGet(META_DEVICE_ID);
    if (fromMeta) return fromMeta;

    const legacy = localStorage.getItem(LEGACY_DEVICE_KEY);
    if (legacy) {
      await metaSet(META_DEVICE_ID, legacy);
      await metaSet(META_CREATED_AT, nowIso());
      await metaSet(META_DB_VERSION, DB_VERSION);
      await metaSet(META_APP_VERSION, APP_VERSION);
      return legacy;
    }

    const freshId = makeDeviceId();
    await metaSet(META_DEVICE_ID, freshId);
    await metaSet(META_CREATED_AT, nowIso());
    await metaSet(META_DB_VERSION, DB_VERSION);
    await metaSet(META_APP_VERSION, APP_VERSION);
    try {
      localStorage.setItem(LEGACY_DEVICE_KEY, freshId);
    } catch (_) {}
    return freshId;
  }
  //* device id close

  //* migration open
  async function migrateLegacyIfNeeded() {
    const existing = await kvGet(KEY_MASTER_DB);
    if (existing) return existing;

    const legacyRaw = localStorage.getItem(LEGACY_MASTER_KEY);
    if (!legacyRaw) return null;

    const parsed = safeParse(legacyRaw);
    if (!parsed) return null;

    await kvSet(KEY_MASTER_DB, jsonClone(parsed));
    await metaSet(META_LAST_SAVE_AT, nowIso());
    await metaSet(META_DB_VERSION, DB_VERSION);
    await metaSet(META_APP_VERSION, APP_VERSION);
    return parsed;
  }
  //* migration close

  //* master data open
  async function load() {
    await requestPersistentStorage();
    await getDeviceId();

    const existing = await kvGet(KEY_MASTER_DB);
    if (existing) return jsonClone(existing);

    const migrated = await migrateLegacyIfNeeded();
    return migrated ? jsonClone(migrated) : null;
  }

  async function save(data) {
    const cloned = jsonClone(data);
    await kvSet(KEY_MASTER_DB, cloned);
    await metaSet(META_LAST_SAVE_AT, nowIso());
    await metaSet(META_DB_VERSION, DB_VERSION);
    await metaSet(META_APP_VERSION, APP_VERSION);

    try {
      localStorage.setItem(LEGACY_MASTER_KEY, JSON.stringify(cloned));
    } catch (_) {
      // เผื่อข้อมูลใหญ่เกิน localStorage ให้ใช้ IndexedDB เป็นหลักต่อไป
    }

    return true;
  }

  async function saveSnapshot(snapshot) {
    await kvSet(KEY_MASTER_SNAPSHOT, jsonClone(snapshot));
    return true;
  }

  async function loadSnapshot() {
    const raw = await kvGet(KEY_MASTER_SNAPSHOT);
    return raw ? jsonClone(raw) : null;
  }

  async function clearMasterData() {
    await kvDelete(KEY_MASTER_DB);
    await kvDelete(KEY_MASTER_SNAPSHOT);
    try { localStorage.removeItem(LEGACY_MASTER_KEY); } catch (_) {}
    return true;
  }
  //* master data close

  //* client local open
  async function loadClientProfile() {
    const raw = await kvGet(KEY_CLIENT_PROFILE);
    return raw ? jsonClone(raw) : null;
  }

  async function saveClientProfile(profile) {
    await kvSet(KEY_CLIENT_PROFILE, jsonClone(profile || {}));
    return true;
  }

  async function loadClientSession() {
    const raw = await kvGet(KEY_CLIENT_SESSION);
    return raw ? jsonClone(raw) : null;
  }

  async function saveClientSession(session) {
    await kvSet(KEY_CLIENT_SESSION, jsonClone(session || {}));
    return true;
  }

  async function clearClientSession() {
    await kvDelete(KEY_CLIENT_SESSION);
    return true;
  }

  async function loadClientQueue() {
    const raw = await kvGet(KEY_CLIENT_QUEUE);
    return Array.isArray(raw) ? jsonClone(raw) : [];
  }

  async function saveClientQueue(queue) {
    await kvSet(KEY_CLIENT_QUEUE, Array.isArray(queue) ? jsonClone(queue) : []);
    return true;
  }

  async function pushClientQueue(op) {
    const queue = await loadClientQueue();
    queue.push(jsonClone(op));
    await saveClientQueue(queue);
    return queue.length;
  }

  async function removeClientQueueByIds(opIds = []) {
    const ids = new Set(Array.isArray(opIds) ? opIds : []);
    const queue = await loadClientQueue();
    const filtered = queue.filter((item) => !ids.has(item?.id));
    await saveClientQueue(filtered);
    return filtered.length;
  }

  async function clearClientQueue() {
    await kvDelete(KEY_CLIENT_QUEUE);
    return true;
  }

  async function loadClientLastSync() {
    const raw = await kvGet(KEY_CLIENT_LAST_SYNC);
    return raw ? jsonClone(raw) : null;
  }

  async function saveClientLastSync(payload) {
    await kvSet(KEY_CLIENT_LAST_SYNC, jsonClone(payload || {}));
    return true;
  }
  //* client local close

  //* drafts open
  async function loadDrafts() {
    const raw = await kvGet(KEY_DRAFTS);
    return isObject(raw) ? jsonClone(raw) : {};
  }

  async function saveDrafts(drafts) {
    await kvSet(KEY_DRAFTS, isObject(drafts) ? jsonClone(drafts) : {});
    return true;
  }

  async function saveUnitDraft(unitId, draftPayload) {
    const drafts = await loadDrafts();
    drafts[String(unitId)] = jsonClone(draftPayload || {});
    await saveDrafts(drafts);
    return true;
  }

  async function loadUnitDraft(unitId) {
    const drafts = await loadDrafts();
    return drafts[String(unitId)] ? jsonClone(drafts[String(unitId)]) : null;
  }

  async function clearUnitDraft(unitId) {
    const drafts = await loadDrafts();
    delete drafts[String(unitId)];
    await saveDrafts(drafts);
    return true;
  }
  //* drafts close

  //* cache helpers open
  async function loadSettingsCache() {
    const raw = await kvGet(KEY_SETTINGS_CACHE);
    return isObject(raw) ? jsonClone(raw) : {};
  }

  async function saveSettingsCache(payload) {
    await kvSet(KEY_SETTINGS_CACHE, isObject(payload) ? jsonClone(payload) : {});
    return true;
  }
  //* cache helpers close

  //* backup open
  async function exportData(data) {
    const storage = await estimateStorage();
    const payload = {
      format: 'FAKDU_BACKUP',
      app: 'FAKDU',
      version: APP_VERSION,
      schema: DB_VERSION,
      exportedAt: nowIso(),
      payload: jsonClone(data),
      meta: {
        deviceInstallId: await getDeviceId(),
        storageQuota: Number(storage.quota || 0),
        storageUsage: Number(storage.usage || 0)
      }
    };

    await metaSet(META_LAST_BACKUP_AT, payload.exportedAt);
    return JSON.stringify(payload, null, 2);
  }

  async function importData(raw) {
    const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
    const imported = normalizeImportedBackup(parsed);
    await metaSet(META_LAST_IMPORT_AT, nowIso());
    return imported;
  }
  //* backup close

  //* maintenance open
  async function clearAll({ keepDeviceId = true } = {}) {
    const deviceId = keepDeviceId ? await getDeviceId() : null;
    const db = await openIndexedDB();

    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_KV, STORE_META], 'readwrite');
      tx.objectStore(STORE_KV).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('ล้างข้อมูลไม่สำเร็จ'));
      tx.onabort = () => reject(tx.error || new Error('ยกเลิกล้างข้อมูล'));
    });

    try {
      localStorage.removeItem(LEGACY_MASTER_KEY);
      if (!keepDeviceId) localStorage.removeItem(LEGACY_DEVICE_KEY);
    } catch (_) {}

    if (keepDeviceId && deviceId) {
      await metaSet(META_DEVICE_ID, deviceId);
      await metaSet(META_CREATED_AT, nowIso());
      await metaSet(META_DB_VERSION, DB_VERSION);
      await metaSet(META_APP_VERSION, APP_VERSION);
      try { localStorage.setItem(LEGACY_DEVICE_KEY, deviceId); } catch (_) {}
    }

    return true;
  }

  async function getMetaSummary() {
    const [deviceInstallId, createdAt, lastSaveAt, lastBackupAt, lastImportAt, persistentStorage] = await Promise.all([
      metaGet(META_DEVICE_ID),
      metaGet(META_CREATED_AT),
      metaGet(META_LAST_SAVE_AT),
      metaGet(META_LAST_BACKUP_AT),
      metaGet(META_LAST_IMPORT_AT),
      metaGet(META_PERSISTENT_OK)
    ]);

    const storage = await estimateStorage();

    return {
      appVersion: APP_VERSION,
      schemaVersion: DB_VERSION,
      deviceInstallId: deviceInstallId || '',
      createdAt: createdAt || '',
      lastSaveAt: lastSaveAt || '',
      lastBackupAt: lastBackupAt || '',
      lastImportAt: lastImportAt || '',
      persistentStorage: Boolean(persistentStorage),
      storageQuota: Number(storage.quota || 0),
      storageUsage: Number(storage.usage || 0),
      usageDetails: storage.usageDetails || {}
    };
  }

  async function waitForReady(retry = 4) {
    let lastError = null;
    for (let i = 0; i < retry; i += 1) {
      try {
        await openIndexedDB();
        await getDeviceId();
        return true;
      } catch (error) {
        lastError = error;
        await sleep(120 * (i + 1));
      }
    }
      throw lastError || new Error('ฐานข้อมูลยังไม่พร้อม');
  }
  //* maintenance close

  //* public api open
  const FakduDB = {
    APP_VERSION,
    DB_NAME,
    DB_VERSION,

    open: openIndexedDB,
    ready: waitForReady,

    load,
    save,
    exportData,
    importData,
    getDeviceId,

    saveSnapshot,
    loadSnapshot,
    clearMasterData,

    loadClientProfile,
    saveClientProfile,
    loadClientSession,
    saveClientSession,
    clearClientSession,
    loadClientQueue,
    saveClientQueue,
    pushClientQueue,
    removeClientQueueByIds,
    clearClientQueue,
    loadClientLastSync,
    saveClientLastSync,

    loadDrafts,
    saveDrafts,
    saveUnitDraft,
    loadUnitDraft,
    clearUnitDraft,

    loadSettingsCache,
    saveSettingsCache,

    requestPersistentStorage,
    estimateStorage,
    getMetaSummary,
    clearAll
  };

  window.FakduDB = FakduDB;
  //* public api close
})();
