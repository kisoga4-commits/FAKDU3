(() => {
  'use strict';

  const APP_VERSION = '10.10';
  const GENKEY_PREFIX = 'FKG1';
  const LICENSE_PREFIX = 'FKL1';
  const TOKEN_VERSION = 'v1';
  const VAULT_SECRET = 'FAKDU_VAULT_MASTER_SECRET_V1010_CHANGE_ME';

  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_VAULT_STATE = 'FAKDU_VAULT_STATE_V1010';
  const LS_LAST_SHOP_ID = 'FAKDU_VAULT_LAST_SHOP_ID';
  const LS_LAST_LICENSE = 'FAKDU_VAULT_LAST_LICENSE_V1010';
  const LS_LAST_STATUS = 'FAKDU_VAULT_LAST_STATUS_V1010';

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
      .replace(/[^A-Z0-9_-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
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
        installRef: '',
        softRef: '',
        activatedAt: null,
        lastValidatedAt: null,
        status: 'idle',
        note: '',
        licenseId: '',
        keyRef: '',
        plan: 'basic'
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
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
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
    const bytes = new TextEncoder().encode(String(input || ''));
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(input) {
    const normalized = String(input || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(String(input || '').length / 4) * 4, '=');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function signToken(prefix, encodedPayload) {
    return sha256Hex(`${VAULT_SECRET}|${APP_VERSION}|${TOKEN_VERSION}|${prefix}|${encodedPayload}`);
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
      keyRef: '',
      plan: 'basic'
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
    if (!sid) sid = `SHOP-${randomString(8)}`;
    if (db) db.shopId = sid;
    localStorage.setItem(LS_LAST_SHOP_ID, sid);
    return sid;
  }

  async function getActivationRequest({ shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId({ ...db, shopId });
    const refs = await buildBindingRefs(sid, deviceId);
    const request = {
      kind: 'activation_request',
      appVersion: APP_VERSION,
      shopId: sid,
      installId: refs.installId,
      installRef: refs.installRef,
      softRef: refs.softRef,
      requestedAt: now()
    };
    return {
      ok: true,
      request,
      printable: JSON.stringify(request, null, 2)
    };
  }

  async function createGenKey({ shopId = '', installRef = '', softRef = '', issuedBy = 'owner', plan = 'pro', expiresAt = null } = {}) {
    const sid = normalizeShopId(shopId);
    if (!sid) {
      return { ok: false, message: 'ยังไม่มีรหัสร้าน' };
    }

    const payload = {
      type: 'genkey',
      version: TOKEN_VERSION,
      shopId: sid,
      installRef: String(installRef || ''),
      softRef: String(softRef || ''),
      issuedBy: String(issuedBy || 'owner'),
      issuedAt: now(),
      expiresAt: expiresAt || null,
      plan: String(plan || 'pro'),
      keyRef: `KG-${randomString(10)}`
    };

    const token = await createToken(GENKEY_PREFIX, payload);
    return { ok: true, token, payload };
  }

  async function createLicenseToken({ shopId = '', installRef = '', softRef = '', plan = 'pro', licenseId = '', note = '' } = {}) {
    const sid = normalizeShopId(shopId);
    if (!sid) {
      return { ok: false, message: 'ยังไม่มีรหัสร้าน' };
    }

    const payload = {
      type: 'license',
      version: TOKEN_VERSION,
      shopId: sid,
      installRef: String(installRef || ''),
      softRef: String(softRef || ''),
      issuedAt: now(),
      plan: String(plan || 'pro'),
      licenseId: String(licenseId || `LIC-${randomString(10)}`),
      note: String(note || '')
    };

    const token = await createToken(LICENSE_PREFIX, payload);
    return { ok: true, token, payload };
  }

  async function validateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId({ ...db, shopId });
    const refs = await buildBindingRefs(sid, deviceId);
    const tokenInfo = await readToken(key);

    if (!tokenInfo.ok) {
      return { valid: false, message: tokenInfo.message || 'คีย์ไม่ถูกต้อง' };
    }

    if (tokenInfo.prefix !== GENKEY_PREFIX) {
      return { valid: false, message: 'คีย์นี้ไม่ใช่ GENKEY' };
    }

    const payload = tokenInfo.payload || {};
    if (payload.type !== 'genkey') {
      return { valid: false, message: 'ชนิดคีย์ไม่ถูกต้อง' };
    }

    if (normalizeShopId(payload.shopId) !== sid) {
      return { valid: false, message: 'คีย์นี้ไม่ตรงกับรหัสร้าน' };
    }

    if (payload.installRef && payload.installRef !== refs.installRef) {
      return { valid: false, message: 'คีย์นี้ไม่ตรงกับเครื่องนี้' };
    }

    if (payload.softRef && payload.softRef !== refs.softRef) {
      return { valid: false, message: 'ลายนิ้วมือเครื่องไม่ตรง' };
    }

    if (payload.expiresAt && Number(payload.expiresAt) < now()) {
      return { valid: false, message: 'คีย์นี้หมดอายุแล้ว' };
    }

    return {
      valid: true,
      message: 'คีย์ถูกต้อง',
      shopId: sid,
      refs,
      payload
    };
  }

  async function validateLicenseToken({ token = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId({ ...db, shopId });
    const refs = await buildBindingRefs(sid, deviceId);
    const tokenInfo = await readToken(token);

    if (!tokenInfo.ok) {
      return { valid: false, message: tokenInfo.message || 'โทเคนไม่ถูกต้อง' };
    }

    if (tokenInfo.prefix !== LICENSE_PREFIX) {
      return { valid: false, message: 'โทเคนนี้ไม่ใช่ license จริง' };
    }

    const payload = tokenInfo.payload || {};
    if (payload.type !== 'license') {
      return { valid: false, message: 'ชนิดโทเคนไม่ถูกต้อง' };
    }

    if (normalizeShopId(payload.shopId) !== sid) {
      return { valid: false, message: 'license นี้ไม่ตรงร้าน' };
    }

    if (payload.installRef && payload.installRef !== refs.installRef) {
      return { valid: false, message: 'license นี้ไม่ตรงกับเครื่องนี้' };
    }

    if (payload.softRef && payload.softRef !== refs.softRef) {
      return { valid: false, message: 'ลายนิ้วมือเครื่องนี้ไม่ตรง license' };
    }

    return {
      valid: true,
      message: 'license ใช้งานได้',
      shopId: sid,
      refs,
      payload
    };
  }

  async function activateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId({ ...db, shopId });
    const validation = await validateProKey({ key, shopId: sid, deviceId, db });

    if (!validation.valid) {
      db.licenseActive = false;
      if (db.vault) {
        db.vault.status = 'invalid';
        db.vault.note = validation.message || 'เปิดสิทธิ์ไม่สำเร็จ';
      }
      setVaultState({ status: 'invalid', note: validation.message || 'เปิดสิทธิ์ไม่สำเร็จ', shopId: sid });
      return validation;
    }

    const refs = validation.refs;
    const genPayload = validation.payload;
    const issued = await createLicenseToken({
      shopId: sid,
      installRef: refs.installRef,
      softRef: refs.softRef,
      plan: genPayload.plan || 'pro',
      licenseId: `LIC-${randomString(12)}`,
      note: `Activated by ${genPayload.keyRef || 'genkey'}`
    });

    if (!issued.ok) {
      return { valid: false, message: issued.message || 'สร้าง license ไม่สำเร็จ' };
    }

    db.licenseToken = issued.token;
    db.licenseActive = true;
    db.shopId = sid;
    db.vault = {
      ...(db.vault || {}),
      installRef: refs.installRef,
      softRef: refs.softRef,
      activatedAt: now(),
      lastValidatedAt: now(),
      status: 'active',
      note: 'เปิดสิทธิ์สำเร็จ',
      licenseId: issued.payload.licenseId,
      keyRef: genPayload.keyRef || '',
      plan: genPayload.plan || 'pro'
    };

    localStorage.setItem(LS_LAST_LICENSE, issued.token);
    localStorage.setItem(LS_LAST_STATUS, 'active');
    setVaultState({
      installId: refs.installId,
      installRef: refs.installRef,
      softRef: refs.softRef,
      shopId: sid,
      activatedAt: db.vault.activatedAt,
      lastValidatedAt: db.vault.lastValidatedAt,
      status: 'active',
      note: 'เปิดสิทธิ์สำเร็จ',
      licenseId: issued.payload.licenseId,
      keyRef: genPayload.keyRef || '',
      plan: genPayload.plan || 'pro'
    });

    return {
      valid: true,
      message: 'เปิดสิทธิ์ PRO สำเร็จ',
      token: issued.token,
      payload: issued.payload,
      refs,
      shopId: sid
    };
  }

  async function isProActive(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const token = String(db.licenseToken || localStorage.getItem(LS_LAST_LICENSE) || '').trim();
    if (!token) {
      db.licenseActive = false;
      if (db.vault) {
        db.vault.status = 'idle';
        db.vault.note = 'ยังไม่มี license';
      }
      setVaultState({ shopId: sid, status: 'idle', note: 'ยังไม่มี license' });
      return false;
    }

    const validation = await validateLicenseToken({ token, shopId: sid, db });
    if (!validation.valid) {
      db.licenseActive = false;
      if (db.vault) {
        db.vault.status = 'invalid';
        db.vault.note = validation.message || 'license ใช้งานไม่ได้';
      }
      setVaultState({ shopId: sid, status: 'invalid', note: validation.message || 'license ใช้งานไม่ได้' });
      return false;
    }

    db.licenseToken = token;
    db.licenseActive = true;
    db.shopId = sid;
    db.vault = {
      ...(db.vault || {}),
      installRef: validation.refs.installRef,
      softRef: validation.refs.softRef,
      lastValidatedAt: now(),
      status: 'active',
      note: 'สิทธิ์ใช้งานปกติ',
      licenseId: validation.payload.licenseId || (db.vault && db.vault.licenseId) || '',
      plan: validation.payload.plan || (db.vault && db.vault.plan) || 'pro'
    };

    localStorage.setItem(LS_LAST_LICENSE, token);
    localStorage.setItem(LS_LAST_STATUS, 'active');
    setVaultState({
      installId: validation.refs.installId,
      installRef: validation.refs.installRef,
      softRef: validation.refs.softRef,
      shopId: sid,
      lastValidatedAt: db.vault.lastValidatedAt,
      status: 'active',
      note: 'สิทธิ์ใช้งานปกติ',
      licenseId: db.vault.licenseId || '',
      plan: db.vault.plan || 'pro'
    });

    return true;
  }

  async function clearLicense(db = {}) {
    ensureDbShape(db);
    db.licenseToken = '';
    db.licenseActive = false;
    db.vault = {
      ...(db.vault || {}),
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: 'ล้างสิทธิ์เรียบร้อย',
      licenseId: '',
      keyRef: '',
      plan: 'basic'
    };

    localStorage.removeItem(LS_LAST_LICENSE);
    localStorage.setItem(LS_LAST_STATUS, 'idle');
    setVaultState({
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: 'ล้างสิทธิ์เรียบร้อย',
      licenseId: '',
      keyRef: '',
      plan: 'basic'
    });

    return { ok: true, message: 'ล้างสิทธิ์สำเร็จ' };
  }

  async function verifyRecoveryAnswers({ phone = '', color = '', animal = '', db = {} } = {}) {
    ensureDbShape(db);
    const source = db.recovery || {};
    const checks = [
      ['phone', phone],
      ['color', color],
      ['animal', animal]
    ];

    const ok = checks.every(([key, value]) => {
      const left = String(source[key] || '').trim().toLowerCase();
      const right = String(value || '').trim().toLowerCase();
      return left && right && left === right;
    });

    return {
      ok,
      message: ok ? 'คำตอบกู้คืนถูกต้อง' : 'คำตอบกู้คืนไม่ถูกต้อง'
    };
  }

  async function exportVaultBackup(db = {}) {
    ensureDbShape(db);
    const payload = {
      exportedAt: now(),
      appVersion: APP_VERSION,
      shopId: await ensureShopId(db),
      licenseToken: String(db.licenseToken || ''),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {}),
      recovery: clone(db.recovery || {}),
      localVaultState: getVaultState()
    };

    return {
      ok: true,
      filename: `fakdu-vault-backup-${payload.shopId}-${new Date().toISOString().slice(0, 10)}.json`,
      data: JSON.stringify(payload, null, 2)
    };
  }

  async function importVaultBackup(rawText, db = {}) {
    ensureDbShape(db);
    const parsed = typeof rawText === 'string' ? safeJsonParse(rawText, null) : rawText;
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

  window.FakduVault = {
    APP_VERSION,
    GENKEY_PREFIX,
    LICENSE_PREFIX,
    ensureShopId,
    getInstallId,
    getActivationRequest,
    createGenKey,
    validateProKey,
    activateProKey,
    validateLicenseToken,
    createLicenseToken,
    isProActive,
    clearLicense,
    verifyRecoveryAnswers,
    exportVaultBackup,
    importVaultBackup,
    getStatus
  };
})();
