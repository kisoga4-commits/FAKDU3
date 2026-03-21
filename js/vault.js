(() => {
  'use strict';

  //* constants open
  const APP_VERSION = '9.46';
  const GENKEY_PREFIX = 'FKG1';
  const LICENSE_PREFIX = 'FKL1';
  const VAULT_SECRET = 'FAKDU_VAULT_MASTER_SECRET_V946_CHANGE_ME';

  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_VAULT_STATE = 'FAKDU_VAULT_STATE_V946';
  const LS_LAST_SHOP_ID = 'FAKDU_VAULT_LAST_SHOP_ID';
  const LS_LAST_LICENSE = 'FAKDU_VAULT_LAST_LICENSE_V946';
  const LS_LAST_STATUS = 'FAKDU_VAULT_LAST_STATUS_V946';
  //* constants close

  //* helpers open
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
    for (let i = 0; i < len; i += 1) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function makeId(prefix = 'FD', len = 10) {
    return `${prefix}-${randomString(len)}`;
  }

  function normalizeShopId(value = '') {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-');
  }

  function ensureDbShape(db) {
    const target = db || {};
    if (!target.recovery || typeof target.recovery !== 'object') {
      target.recovery = { phone: '', color: '', animal: '' };
    }
    if (typeof target.licenseToken !== 'string') target.licenseToken = '';
    if (typeof target.licenseActive !== 'boolean') target.licenseActive = false;
    if (!target.vault || typeof target.vault !== 'object') {
      target.vault = {
        installRef: '',
        softRef: '',
        activatedAt: null,
        lastValidatedAt: null,
        status: 'idle',
        note: '',
        licenseId: '',
        keyRef: ''
      };
    }
    return target;
  }

  function buildSoftFingerprintSeed() {
    const parts = [
      navigator.userAgent || '',
      navigator.language || '',
      navigator.platform || '',
      navigator.hardwareConcurrency || 0,
      screen.width || 0,
      screen.height || 0,
      screen.colorDepth || 0,
      new Date().getTimezoneOffset()
    ];
    return parts.join('|');
  }

  async function sha256Hex(message) {
    const bytes = new TextEncoder().encode(String(message || ''));
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function shortHash(message, len = 24) {
    return (await sha256Hex(message)).slice(0, len);
  }

  function toBase64Url(input) {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(input) {
    const base64 = String(input || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(String(input || '').length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function signToken(prefix, encodedPayload) {
    return sha256Hex(`${VAULT_SECRET}|${APP_VERSION}|${prefix}|${encodedPayload}`);
  }

  async function createToken(prefix, payload) {
    const encoded = toBase64Url(JSON.stringify(payload));
    const signature = await signToken(prefix, encoded);
    return `${prefix}.${encoded}.${signature}`;
  }

  async function readToken(token) {
    const raw = String(token || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 3) {
      return { ok: false, message: 'รูปแบบคีย์ไม่ถูกต้อง' };
    }

    const [prefix, encoded, signature] = parts;
    const expected = await signToken(prefix, encoded);
    if (expected !== signature) {
      return { ok: false, prefix, message: 'ลายเซ็นคีย์ไม่ถูกต้อง' };
    }

    try {
      const payload = JSON.parse(fromBase64Url(encoded));
      return { ok: true, prefix, payload, signature };
    } catch (_) {
      return { ok: false, prefix, message: 'อ่านข้อมูลคีย์ไม่สำเร็จ' };
    }
  }

  function getVaultState() {
    return safeJsonParse(localStorage.getItem(LS_VAULT_STATE), {
      installId: '',
      installRef: '',
      softRef: '',
      shopId: '',
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: '',
      licenseId: '',
      keyRef: ''
    });
  }

  function setVaultState(patch = {}) {
    const current = getVaultState();
    const next = { ...current, ...clone(patch) };
    localStorage.setItem(LS_VAULT_STATE, JSON.stringify(next));
    if (next.shopId) localStorage.setItem(LS_LAST_SHOP_ID, next.shopId);
    if (next.status) localStorage.setItem(LS_LAST_STATUS, next.status);
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
      installId = `${makeId('FDI', 8)}-${Date.now().toString(36).toUpperCase()}`;
      localStorage.setItem(LS_INSTALL_ID, installId);
    }
    return installId;
  }

  async function buildBindingRefs(shopId, installId = '') {
    const sid = normalizeShopId(shopId);
    const iid = await getInstallId(installId);
    const softSeed = buildSoftFingerprintSeed();

    const installRef = await shortHash(`${sid}|INSTALL|${iid}|${APP_VERSION}`, 24);
    const softRef = await shortHash(`${sid}|SOFT|${softSeed}|${APP_VERSION}`, 24);

    return {
      shopId: sid,
      installId: iid,
      installRef,
      softRef,
      softSeed
    };
  }

  async function ensureShopId(db) {
    ensureDbShape(db);
    let sid = normalizeShopId(db?.shopId || localStorage.getItem(LS_LAST_SHOP_ID) || '');
    if (!sid) {
      sid = `SHOP-${randomString(8)}`;
    }
    if (db) db.shopId = sid;
    localStorage.setItem(LS_LAST_SHOP_ID, sid);
    return sid;
  }
  //* helpers close

  //* license open
  async function issueLocalLicenseFromGenKey({ genPayload, shopId, installId }) {
    const binding = await buildBindingRefs(shopId, installId);
    const issuedAt = Number(genPayload.issuedAt || now());
    const activatedAt = now();
    const features = Array.isArray(genPayload.features) && genPayload.features.length
      ? genPayload.features
      : ['pro'];

    const licensePayload = {
      type: 'LICENSE',
      version: 1,
      appVersion: APP_VERSION,
      shopId: binding.shopId,
      plan: genPayload.plan || 'PRO',
      features,
      issuedAt,
      activatedAt,
      licenseId: genPayload.licenseId || makeId('LIC', 10),
      sourceKeyRef: await shortHash(JSON.stringify(genPayload), 16),
      machine: {
        installRef: binding.installRef,
        softRef: binding.softRef
      }
    };

    const token = await createToken(LICENSE_PREFIX, licensePayload);
    return {
      token,
      payload: licensePayload,
      binding
    };
  }

  async function validateGenKeyForShop(key, shopId) {
    const tokenInfo = await readToken(key);
    if (!tokenInfo.ok) {
      return { valid: false, message: tokenInfo.message || 'คีย์ไม่ถูกต้อง' };
    }

    if (tokenInfo.prefix !== GENKEY_PREFIX) {
      return { valid: false, message: 'คีย์นี้ไม่ใช่ GENKEY' };
    }

    const payload = tokenInfo.payload || {};
    if ((payload.type || 'GENKEY') !== 'GENKEY') {
      return { valid: false, message: 'ชนิดคีย์ไม่ถูกต้อง' };
    }

    const tokenShopId = normalizeShopId(payload.shopId);
    const currentShopId = normalizeShopId(shopId);
    if (!tokenShopId || tokenShopId !== currentShopId) {
      return { valid: false, message: 'คีย์นี้ไม่ตรงกับรหัสร้าน' };
    }

    return {
      valid: true,
      payload,
      message: 'GENKEY ใช้ได้'
    };
  }

  async function validateLocalLicenseToken(token, shopId, installId = '') {
    const tokenInfo = await readToken(token);
    if (!tokenInfo.ok) {
      return { valid: false, message: tokenInfo.message || 'โทเคนไม่ถูกต้อง' };
    }

    if (tokenInfo.prefix !== LICENSE_PREFIX) {
      return { valid: false, message: 'โทเคนนี้ไม่ใช่ license จริง' };
    }

    const payload = tokenInfo.payload || {};
    if ((payload.type || '') !== 'LICENSE') {
      return { valid: false, message: 'ชนิดโทเคนไม่ถูกต้อง' };
    }

    const currentShopId = normalizeShopId(shopId);
    const tokenShopId = normalizeShopId(payload.shopId);
    if (!tokenShopId || tokenShopId !== currentShopId) {
      return { valid: false, message: 'license นี้ไม่ตรงร้าน' };
    }

    const binding = await buildBindingRefs(currentShopId, installId);
    const exactMatch = payload.machine?.installRef === binding.installRef;
    const softMatch = payload.machine?.softRef === binding.softRef;

    if (!exactMatch && !softMatch) {
      return { valid: false, message: 'license นี้ไม่ตรงกับเครื่องนี้' };
    }

    return {
      valid: true,
      exactMatch,
      softMatch,
      payload,
      binding,
      message: exactMatch ? 'license ตรงกับเครื่องเดิม' : 'license ตรงกับอุปกรณ์เดิมและกู้คืนได้'
    };
  }
  //* license close

  //* public api open
  async function activateProKey({ key, shopId, deviceId = '', db = null } = {}) {
    ensureDbShape(db);

    const sid = normalizeShopId(shopId || db?.shopId || '');
    if (!sid) {
      return { valid: false, message: 'ยังไม่มีรหัสร้าน' };
    }

    const checked = await validateGenKeyForShop(key, sid);
    if (!checked.valid) {
      return checked;
    }

    const localLicense = await issueLocalLicenseFromGenKey({
      genPayload: checked.payload,
      shopId: sid,
      installId: deviceId
    });

    const licenseToken = localLicense.token;
    const keyRef = await shortHash(String(key || '').trim(), 16);

    if (db) {
      db.shopId = sid;
      db.licenseToken = licenseToken;
      db.licenseActive = true;
      db.vault = {
        ...(db.vault || {}),
        installRef: localLicense.binding.installRef,
        softRef: localLicense.binding.softRef,
        activatedAt: localLicense.payload.activatedAt,
        lastValidatedAt: now(),
        status: 'active',
        note: localLicense.binding.installRef === localLicense.binding.installRef ? 'เปิดสิทธิ์แล้ว' : '',
        licenseId: localLicense.payload.licenseId,
        keyRef
      };
    }

    setVaultState({
      installId: localLicense.binding.installId,
      installRef: localLicense.binding.installRef,
      softRef: localLicense.binding.softRef,
      shopId: sid,
      activatedAt: localLicense.payload.activatedAt,
      lastValidatedAt: now(),
      status: 'active',
      note: 'เปิดสิทธิ์สำเร็จ',
      licenseId: localLicense.payload.licenseId,
      keyRef
    });

    localStorage.setItem(LS_LAST_LICENSE, licenseToken);

    return {
      valid: true,
      token: licenseToken,
      message: 'เปิดสิทธิ์ PRO สำเร็จ',
      shopId: sid,
      plan: localLicense.payload.plan,
      licenseId: localLicense.payload.licenseId,
      exact: true
    };
  }

  async function validateProKey(key, shopId, deviceId = '') {
    const sid = normalizeShopId(shopId);
    if (!sid) {
      return { valid: false, message: 'ยังไม่มีรหัสร้าน' };
    }

    const tokenInfo = await readToken(key);
    if (!tokenInfo.ok) {
      return { valid: false, message: tokenInfo.message || 'คีย์ไม่ถูกต้อง' };
    }

    if (tokenInfo.prefix === GENKEY_PREFIX) {
      return validateGenKeyForShop(key, sid);
    }

    if (tokenInfo.prefix === LICENSE_PREFIX) {
      return validateLocalLicenseToken(key, sid, deviceId);
    }

    return { valid: false, message: 'คีย์นี้ไม่รองรับ' };
  }

  async function isProActive(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const token = String(db.licenseToken || localStorage.getItem(LS_LAST_LICENSE) || '').trim();
    if (!token) {
      db.licenseActive = false;
      db.vault.status = 'missing';
      db.vault.note = 'ยังไม่มี license';
      setVaultState({ shopId: sid, status: 'missing', note: 'ยังไม่มี license' });
      return false;
    }

    const result = await validateLocalLicenseToken(token, sid);
    if (!result.valid) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = result.message || 'license ไม่ผ่าน';
      db.vault.lastValidatedAt = now();
      setVaultState({ shopId: sid, status: 'invalid', note: db.vault.note, lastValidatedAt: now() });
      return false;
    }

    db.licenseToken = token;
    db.licenseActive = true;
    db.vault.installRef = result.binding.installRef;
    db.vault.softRef = result.binding.softRef;
    db.vault.lastValidatedAt = now();
    db.vault.status = result.exactMatch ? 'active' : 'restored';
    db.vault.note = result.exactMatch ? 'สิทธิ์ตรงกับเครื่องเดิม' : 'กู้สิทธิ์กลับมาบนอุปกรณ์เดิม';
    db.vault.licenseId = result.payload.licenseId || db.vault.licenseId || '';
    localStorage.setItem(LS_LAST_LICENSE, token);

    setVaultState({
      installId: result.binding.installId,
      installRef: result.binding.installRef,
      softRef: result.binding.softRef,
      shopId: sid,
      activatedAt: db.vault.activatedAt || result.payload.activatedAt || null,
      lastValidatedAt: now(),
      status: db.vault.status,
      note: db.vault.note,
      licenseId: result.payload.licenseId || ''
    });

    return true;
  }

  async function getActivationRequest(db = {}, deviceId = '') {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const binding = await buildBindingRefs(sid, deviceId);
    return {
      appVersion: APP_VERSION,
      shopId: sid,
      installId: binding.installId,
      installRef: binding.installRef,
      softRef: binding.softRef,
      requestedAt: now()
    };
  }

  async function clearLicense(db = {}) {
    ensureDbShape(db);
    db.licenseToken = '';
    db.licenseActive = false;
    db.vault.status = 'cleared';
    db.vault.note = 'ล้าง license แล้ว';
    db.vault.lastValidatedAt = now();
    localStorage.removeItem(LS_LAST_LICENSE);
    setVaultState({ shopId: normalizeShopId(db.shopId || ''), status: 'cleared', note: 'ล้าง license แล้ว', lastValidatedAt: now() });
    return true;
  }

  function verifyRecoveryAnswers(db = {}, answers = {}) {
    ensureDbShape(db);
    const colorOk = String(db.recovery?.color || '').trim() === String(answers.color || '').trim();
    const animalOk = String(db.recovery?.animal || '').trim() === String(answers.animal || '').trim();
    return {
      ok: Boolean(colorOk && animalOk),
      colorOk,
      animalOk
    };
  }

  async function exportVaultBackup(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const state = getVaultState();
    return JSON.stringify({
      exportedAt: now(),
      appVersion: APP_VERSION,
      shopId: sid,
      licenseToken: db.licenseToken || '',
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {}),
      recovery: {
        color: db.recovery?.color || '',
        animal: db.recovery?.animal || ''
      },
      localVaultState: state
    }, null, 2);
  }

  async function importVaultBackup(raw, db = {}) {
    ensureDbShape(db);
    const parsed = typeof raw === 'string' ? safeJsonParse(raw, null) : raw;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, message: 'ไฟล์สำรอง VAULT ไม่ถูกต้อง' };
    }

    if (parsed.shopId) db.shopId = normalizeShopId(parsed.shopId);
    if (typeof parsed.licenseToken === 'string') db.licenseToken = parsed.licenseToken;
    if (typeof parsed.licenseActive === 'boolean') db.licenseActive = parsed.licenseActive;
    db.vault = { ...(db.vault || {}), ...(parsed.vault || {}) };
    db.recovery = { ...(db.recovery || {}), ...(parsed.recovery || {}) };

    if (parsed.localVaultState && typeof parsed.localVaultState === 'object') {
      setVaultState(parsed.localVaultState);
    }

    const active = await isProActive(db);
    return {
      ok: true,
      active,
      message: active ? 'นำเข้า VAULT สำเร็จและสิทธิ์ยังใช้ได้' : 'นำเข้า VAULT แล้ว แต่สิทธิ์ยังไม่ผ่านบนเครื่องนี้'
    };
  }

  async function getStatus(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const state = getVaultState();
    const token = String(db.licenseToken || '').trim();
    const active = await isProActive(db);
    return {
      appVersion: APP_VERSION,
      shopId: sid,
      installId: await getInstallId(),
      licenseExists: Boolean(token),
      active,
      vault: clone(db.vault || {}),
      local: state
    };
  }
  //* public api close

  //* expose open
  window.FakduVault = {
    APP_VERSION,
    GENKEY_PREFIX,
    LICENSE_PREFIX,
    ensureShopId,
    getInstallId,
    getActivationRequest,
    validateProKey,
    activateProKey,
    isProActive,
    clearLicense,
    verifyRecoveryAnswers,
    exportVaultBackup,
    importVaultBackup,
    getStatus
  };
  //* expose close
})();
