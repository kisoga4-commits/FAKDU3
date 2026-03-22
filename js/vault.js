(() => {
  'use strict';

  const APP_VERSION = '10.21-online-activation';
  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_VAULT_STATE = 'FAKDU_VAULT_STATE_V1021';
  const LS_LAST_SHOP_ID = 'FAKDU_VAULT_LAST_SHOP_ID';
  const LS_LAST_LICENSE = 'FAKDU_VAULT_LAST_LICENSE_V1021';
  const LS_ACTIVATION_CACHE = 'FAKDU_VAULT_ACTIVATION_CACHE_V1021';
  const SERVER_SECRET_ENV = 'FAKDU_VAULT_MASTER_SECRET';

  function now() {
    return Date.now();
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function randomString(len = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function normalizeShopId(value = '') {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normalizeLicenseCode(value = '') {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9._-]/g, '');
  }

  function getLicenseApi() {
    const api = window.FakduLicenseApi;
    if (!api || typeof api !== 'object') return null;
    return api;
  }

  function getServerSecretHint() {
    return `ต้องตั้งค่า ${SERVER_SECRET_ENV} ไว้เฉพาะฝั่ง owner/server เท่านั้น`;
  }

  function ensureDbShape(db) {
    const target = db && typeof db === 'object' ? db : {};

    if (!target.recovery || typeof target.recovery !== 'object') {
      target.recovery = { phone: '', color: '', animal: '' };
    }

    if (typeof target.licenseToken !== 'string') target.licenseToken = '';
    if (typeof target.licenseActive !== 'boolean') target.licenseActive = false;
    if (typeof target.shopId !== 'string') target.shopId = '';

    if (!target.vault || typeof target.vault !== 'object') {
      target.vault = {
        installId: '',
        activatedAt: null,
        lastValidatedAt: null,
        status: 'idle',
        note: '',
        licenseId: '',
        plan: 'basic'
      };
    }

    return target;
  }

  function getVaultState() {
    return safeJsonParse(localStorage.getItem(LS_VAULT_STATE), {
      installId: '',
      shopId: '',
      licenseCode: '',
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: '',
      licenseId: '',
      plan: 'basic'
    });
  }

  function setVaultState(patch = {}) {
    const next = { ...getVaultState(), ...clone(patch) };
    localStorage.setItem(LS_VAULT_STATE, JSON.stringify(next));
    if (next.shopId) localStorage.setItem(LS_LAST_SHOP_ID, next.shopId);
    if (next.licenseCode) localStorage.setItem(LS_LAST_LICENSE, next.licenseCode);
    return next;
  }

  function getActivationCache() {
    return safeJsonParse(localStorage.getItem(LS_ACTIVATION_CACHE), {
      shopId: '',
      licenseCode: '',
      installId: '',
      activationId: '',
      activatedAt: null,
      verifiedAt: null,
      ownerApprovedAt: null
    });
  }

  function setActivationCache(payload = {}) {
    const next = { ...getActivationCache(), ...clone(payload) };
    localStorage.setItem(LS_ACTIVATION_CACHE, JSON.stringify(next));
    return next;
  }

  async function getInstallId(provided = '') {
    const direct = String(provided || '').trim();
    if (direct) {
      localStorage.setItem(LS_INSTALL_ID, direct);
      return direct;
    }

    let installId = localStorage.getItem(LS_INSTALL_ID) || '';
    if (!installId) {
      installId = `FDI-${randomString(8)}-${Date.now().toString(36).toUpperCase()}`;
      localStorage.setItem(LS_INSTALL_ID, installId);
    }
    return installId;
  }

  async function ensureShopId(db, requestedShopId = '') {
    ensureDbShape(db);
    let sid = normalizeShopId(requestedShopId || db?.shopId || localStorage.getItem(LS_LAST_SHOP_ID) || '');
    if (!sid) sid = `SHOP-${randomString(8)}`;
    if (db) db.shopId = sid;
    localStorage.setItem(LS_LAST_SHOP_ID, sid);
    return sid;
  }

  async function getActivationRequest({ shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const installId = await getInstallId(deviceId);
    const licenseCode = normalizeLicenseCode(db.licenseToken || localStorage.getItem(LS_LAST_LICENSE) || '');
    const request = {
      kind: 'activation_request',
      appVersion: APP_VERSION,
      shopId: sid,
      licenseCode,
      installId,
      requestedAt: now(),
      note: 'Activation is online-only. Owner approval/reset may be required for new devices.'
    };
    return { ok: true, request, printable: JSON.stringify(request, null, 2) };
  }

  async function createGenKey() {
    return { ok: false, message: 'ปิดการสร้าง GENKEY ในแอป (ต้องทำฝั่ง owner/server)' };
  }

  async function createLicenseToken() {
    return { ok: false, message: 'ปิดการสร้าง license ในแอป (ต้องทำฝั่ง owner/server)' };
  }

  async function validateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const installId = await getInstallId(deviceId);
    const licenseCode = normalizeLicenseCode(key);

    if (!licenseCode) {
      return { valid: false, message: 'กรอก licenseCode ก่อน' };
    }

    if (!navigator.onLine) {
      return { valid: false, message: 'ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อยืนยัน licenseCode ครั้งแรก' };
    }

    const api = getLicenseApi();
    if (!api || typeof api.verifyLicenseOnline !== 'function') {
      return { valid: false, message: `ยังไม่ได้ตั้งค่า License API ฝั่งเซิร์ฟเวอร์ (${getServerSecretHint()})` };
    }

    try {
      const result = await api.verifyLicenseOnline({
        licenseCode,
        shopId: sid,
        installId,
        appVersion: APP_VERSION
      });

      if (!result || result.valid !== true) {
        return { valid: false, message: result?.message || 'licenseCode ไม่ผ่านการยืนยัน' };
      }

      return {
        valid: true,
        message: result.message || 'ยืนยัน licenseCode สำเร็จ',
        shopId: normalizeShopId(result.shopId || sid),
        licenseId: String(result.licenseId || ''),
        plan: String(result.plan || 'pro')
      };
    } catch (_) {
      return { valid: false, message: 'เชื่อมต่อเซิร์ฟเวอร์ยืนยัน licenseCode ไม่สำเร็จ' };
    }
  }

  async function validateLicenseToken({ token = '', shopId = '', deviceId = '', db = {} } = {}) {
    return validateProKey({ key: token, shopId, deviceId, db });
  }

  async function activateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const installId = await getInstallId(deviceId);
    const licenseCode = normalizeLicenseCode(key || db.licenseToken);

    if (!licenseCode) {
      db.licenseActive = false;
      return { valid: false, message: 'ต้องระบุ licenseCode' };
    }

    if (!navigator.onLine) {
      db.licenseActive = false;
      return { valid: false, message: 'การ Activate ต้องออนไลน์เท่านั้น' };
    }

    const api = getLicenseApi();
    if (!api || typeof api.activateOnline !== 'function') {
      db.licenseActive = false;
      return { valid: false, message: `ยังไม่ได้ตั้งค่า License API ฝั่งเซิร์ฟเวอร์ (${getServerSecretHint()})` };
    }

    try {
      const activated = await api.activateOnline({
        shopId: sid,
        licenseCode,
        installId,
        appVersion: APP_VERSION
      });

      if (!activated || activated.valid !== true) {
        db.licenseActive = false;
        const code = String(activated?.code || '').toUpperCase();
        if (code === 'OWNER_APPROVAL_REQUIRED' || code === 'DEVICE_NOT_APPROVED') {
          return { valid: false, message: activated?.message || 'อุปกรณ์ใหม่ต้องให้เจ้าของรีเซ็ต/อนุมัติก่อนใช้งาน' };
        }
        return { valid: false, message: activated?.message || 'เปิดสิทธิ์ไม่สำเร็จ' };
      }

      const resolvedShopId = normalizeShopId(activated.shopId || sid);
      const persistedLicenseCode = normalizeLicenseCode(activated.licenseCode || licenseCode);
      const licenseId = String(activated.licenseId || `LIC-${randomString(10)}`);
      const plan = String(activated.plan || 'pro');

      db.shopId = resolvedShopId;
      db.licenseToken = persistedLicenseCode;
      db.licenseActive = true;
      db.vault.installId = installId;
      db.vault.activatedAt = now();
      db.vault.lastValidatedAt = now();
      db.vault.status = 'active';
      db.vault.note = activated.message || 'Activated online';
      db.vault.licenseId = licenseId;
      db.vault.plan = plan;

      setActivationCache({
        shopId: resolvedShopId,
        licenseCode: persistedLicenseCode,
        installId,
        activationId: String(activated.activationId || ''),
        activatedAt: db.vault.activatedAt,
        verifiedAt: db.vault.lastValidatedAt,
        ownerApprovedAt: Number(activated.ownerApprovedAt || db.vault.activatedAt)
      });

      setVaultState({
        installId,
        shopId: resolvedShopId,
        licenseCode: persistedLicenseCode,
        activatedAt: db.vault.activatedAt,
        lastValidatedAt: db.vault.lastValidatedAt,
        status: db.vault.status,
        note: db.vault.note,
        licenseId,
        plan
      });

      return {
        valid: true,
        token: persistedLicenseCode,
        shopId: resolvedShopId,
        licenseId,
        plan,
        message: db.vault.note
      };
    } catch (_) {
      db.licenseActive = false;
      return { valid: false, message: 'เชื่อมต่อเซิร์ฟเวอร์ activate ไม่สำเร็จ' };
    }
  }

  async function isProActive(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const installId = await getInstallId();
    const licenseCode = normalizeLicenseCode(db.licenseToken || localStorage.getItem(LS_LAST_LICENSE) || '');
    const cache = getActivationCache();

    const exactMatch = Boolean(
      licenseCode
      && sid === cache.shopId
      && licenseCode === cache.licenseCode
      && installId === cache.installId
    );

    if (exactMatch) {
      db.licenseToken = licenseCode;
      db.licenseActive = true;
      db.vault.installId = installId;
      db.vault.status = 'active';
      db.vault.note = navigator.onLine ? 'Activated (online check optional)' : 'Activated (offline allowed)';
      db.vault.licenseId = db.vault.licenseId || getVaultState().licenseId || '';
      return true;
    }

    const sameLicenseDifferentDevice = Boolean(
      licenseCode
      && sid === cache.shopId
      && licenseCode === cache.licenseCode
      && cache.installId
      && cache.installId !== installId
    );

    db.licenseActive = false;
    db.vault.installId = installId;
    db.vault.status = 'invalid';
    db.vault.note = sameLicenseDifferentDevice
      ? 'อุปกรณ์ใหม่ต้องให้เจ้าของรีเซ็ต/อนุมัติก่อนใช้งาน license นี้'
      : 'ยังไม่ผ่านการ activate ออนไลน์บนอุปกรณ์นี้';
    return false;
  }

  async function clearLicense(db = {}) {
    ensureDbShape(db);
    db.licenseToken = '';
    db.licenseActive = false;
    db.vault = {
      installId: db.vault.installId || '',
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: '',
      licenseId: '',
      plan: 'basic'
    };

    localStorage.removeItem(LS_LAST_LICENSE);
    localStorage.removeItem(LS_ACTIVATION_CACHE);
    setVaultState({
      shopId: db.shopId || '',
      licenseCode: '',
      status: 'idle',
      note: '',
      activatedAt: null,
      lastValidatedAt: null,
      licenseId: '',
      plan: 'basic'
    });

    return { ok: true };
  }

  async function verifyRecoveryAnswers({ phone = '', color = '', animal = '', db = {} } = {}) {
    ensureDbShape(db);
    const expected = db.recovery || {};
    const ok = String(phone || '').trim() === String(expected.phone || '').trim()
      && String(color || '').trim() === String(expected.color || '').trim()
      && String(animal || '').trim() === String(expected.animal || '').trim();
    return { valid: ok, message: ok ? 'ข้อมูลช่วยจำถูกต้อง' : 'ข้อมูลช่วยจำไม่ตรงกัน' };
  }

  async function exportVaultBackup(db = {}) {
    ensureDbShape(db);
    const payload = {
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      shopId: db.shopId || localStorage.getItem(LS_LAST_SHOP_ID) || '',
      licenseToken: String(db.licenseToken || ''),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {}),
      activationCache: getActivationCache()
    };
    return {
      ok: true,
      payload,
      raw: JSON.stringify(payload, null, 2),
      filename: `fakdu-vault-backup-${payload.shopId || 'unknown'}-${new Date().toISOString().slice(0, 10)}.json`
    };
  }

  async function importVaultBackup(rawText, db = {}) {
    ensureDbShape(db);
    const parsed = safeJsonParse(rawText);
    if (!parsed || typeof parsed !== 'object') return { ok: false, message: 'ไฟล์ backup ไม่ถูกต้อง' };

    db.shopId = normalizeShopId(parsed.shopId || db.shopId || '');
    if (typeof parsed.licenseToken === 'string') db.licenseToken = normalizeLicenseCode(parsed.licenseToken);
    if (typeof parsed.licenseActive === 'boolean') db.licenseActive = parsed.licenseActive;
    if (parsed.vault && typeof parsed.vault === 'object') db.vault = { ...db.vault, ...clone(parsed.vault) };

    localStorage.setItem(LS_LAST_SHOP_ID, db.shopId || '');
    localStorage.setItem(LS_LAST_LICENSE, db.licenseToken || '');
    if (parsed.activationCache && typeof parsed.activationCache === 'object') {
      setActivationCache(parsed.activationCache);
    }

    setVaultState({
      installId: db.vault.installId || localStorage.getItem(LS_INSTALL_ID) || '',
      shopId: db.shopId,
      licenseCode: db.licenseToken || '',
      status: db.vault.status || (db.licenseActive ? 'active' : 'idle'),
      note: db.vault.note || '',
      licenseId: db.vault.licenseId || '',
      plan: db.vault.plan || 'basic'
    });

    return { ok: true, message: 'นำเข้าข้อมูล vault สำเร็จ' };
  }

  async function getStatus(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    return {
      appVersion: APP_VERSION,
      shopId: sid,
      installId: await getInstallId(),
      licenseExists: Boolean(String(db.licenseToken || '').trim()),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {}),
      activationCache: getActivationCache()
    };
  }

  window.FakduVault = {
    APP_VERSION,
    normalizeShopId,
    getActivationRequest,
    createGenKey,
    createLicenseToken,
    validateProKey,
    validateLicenseToken,
    activateProKey,
    isProActive,
    clearLicense,
    verifyRecoveryAnswers,
    exportVaultBackup,
    importVaultBackup,
    getStatus
  };
})();
