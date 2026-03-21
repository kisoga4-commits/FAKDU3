(() => {
  'use strict';

  //* constants open
  const APP_VERSION = '9.46';
  const LS_ADMIN = 'FAKDU_ADMIN_LOGGED_IN';
  const LS_DEFERRED_INSTALL = 'FAKDU_DEFERRED_INSTALL';
  const LS_SNAPSHOT_PREFIX = 'FAKDU_SYNC_SNAPSHOT_';
  const LS_PENDING_SYNC_VERSION = 'FAKDU_PENDING_SYNC_VERSION';
  const LS_CLIENT_OP_QUEUE = 'FAKDU_CLIENT_OP_QUEUE';
  const LS_FORCE_CLIENT_MODE = 'FAKDU_FORCE_CLIENT_MODE';
  const HEARTBEAT_INTERVAL_MS = 5000;
  const CLIENT_AVATAR_MAX_BYTES = 1.5 * 1024 * 1024;
  const COLOR_MAP = {
    red: 'สีแดง',
    white: 'สีขาว',
    blue: 'สีน้ำเงิน',
    green: 'สีเขียว',
    yellow: 'สีเหลือง',
    black: 'สีดำ',
    pink: 'สีชมพู'
  };
  const ANIMAL_MAP = {
    dog: 'หมา', cat: 'แมว', bird: 'นก', fish: 'ปลา', elephant: 'ช้าง', horse: 'ม้า',
    cow: 'วัว', buffalo: 'ควาย', pig: 'หมู', chicken: 'ไก่', duck: 'เป็ด', tiger: 'เสือ',
    lion: 'สิงโต', bear: 'หมี', monkey: 'ลิง', snake: 'งู', crocodile: 'จระเข้', turtle: 'เต่า',
    frog: 'กบ', rabbit: 'กระต่าย'
  };
  const DEFAULT_DB = {
    version: APP_VERSION,
    shopId: null,
    shopName: 'FAKDU',
    logo: '',
    theme: '#800000',
    bgColor: '#f8fafc',
    bank: '',
    ppay: '',
    qrOffline: '',
    adminPin: '1234',
    licenseToken: '',
    licenseActive: false,
    unitType: 'โต๊ะ',
    unitCount: 4,
    soundEnabled: true,
    items: [],
    units: [],
    carts: {},
    sales: [],
    opLog: [],
    fraudLogs: [],
    recovery: {
      phone: '',
      color: '',
      animal: ''
    },
    sync: {
      masterDeviceId: '',
      syncVersion: 1,
      currentSyncPin: '',
      key: '',
      keyResetDate: '',
      keyResetCount: 0,
      approvedClients: [],
      clients: [],
      clientSession: null,
      approvals: [],
      lastCheck: {
        status: 'idle',
        text: 'ยังไม่ได้ตรวจ',
        hint: 'กดปุ่มเช็คเมื่อต้องการปิดร้านหรือเช็กความตรงกัน',
        at: null
      }
    }
  };
  const TRIAL_LIMITS = {
    unitMax: 4,
    menuMax: 4,
    onlineClientMax: 1,
    topBasicMax: 3,
    themePalette: ['#800000', '#1d4ed8', '#0f766e', '#b45309', '#111827']
  };
  const state = {
    db: structuredClone(DEFAULT_DB),
    isAdminLoggedIn: localStorage.getItem(LS_ADMIN) === 'true',
    activeTab: 'customer',
    activeManageSub: 'dash',
    activeDashSub: 'history',
    activeUnitId: null,
    gridZoom: 2,
    customerGridCollapsed: true,
    shopQueueCollapsed: true,
    pendingAdminAction: null,
    tempAddons: [],
    tempImg: '',
    pendingAddonItem: null,
    currentAddonQty: 1,
    currentCheckoutTotal: 0,
    qrScanner: null,
    deferredInstallPrompt: null,
    syncButtonResetTimer: null,
    syncChannel: null,
    syncPollTimer: null,
    firebaseSyncApi: null,
    stopFirebaseListener: null,
    processedSyncMessages: new Set(),
    clientQueueFlushTimer: null,
    liveTick: null,
    autoSaveTimer: null,
    audioCtx: null,
    hwid: '',
    isPro: false,
    lastClientHeartbeatAt: 0
  };
  const IS_CLIENT_NODE = /client\.html$/i.test(window.location.pathname || '');
  //* constants close

  //* adapter open
  const fallbackDbAdapter = {
    async load() {
      try {
        const raw = localStorage.getItem('FAKDU_DB_V946');
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    },
    async save(data) {
      localStorage.setItem('FAKDU_DB_V946', JSON.stringify(data));
    },
    async exportData(data) {
      return JSON.stringify(data, null, 2);
    },
    async importData(raw) {
      return JSON.parse(raw);
    },
    async getDeviceId() {
      let id = localStorage.getItem('FAKDU_DEVICE_INSTALL_ID');
      if (!id) {
        id = 'FD-' + Math.random().toString(36).slice(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
        localStorage.setItem('FAKDU_DEVICE_INSTALL_ID', id);
      }
      return id;
    }
  };

  function resolveDbApi() {
    if (window.FakduDB && typeof window.FakduDB.load === 'function' && typeof window.FakduDB.save === 'function') {
      return window.FakduDB;
    }
    return fallbackDbAdapter;
  }

  function resolveVaultApi() {
    return window.FakduVault || {};
  }
  //* adapter close

  //* helpers open
  function qs(id) { return document.getElementById(id); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function now() { return Date.now(); }
  function thaiDate(ts = Date.now()) {
    return new Date(ts).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function getLocalYYYYMMDD(d = new Date()) {
    const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Intl.DateTimeFormat('en-CA', options).format(d);
  }
  function getTimeHHMM(d = new Date()) {
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }
  function formatMoney(n) {
    return Number(n || 0).toLocaleString('th-TH');
  }
  function isTransferMethod(method = '') {
    const value = String(method || '').toLowerCase();
    return value === 'transfer' || value === 'qr' || value === 'promptpay';
  }
  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  function getUnitLabel(id) {
    return `${state.db.unitType || 'โต๊ะ'} ${id}`;
  }
  function getActorLabel() {
    if (IS_CLIENT_NODE) return 'client';
    return state.isAdminLoggedIn ? 'admin' : 'master';
  }
  function getCurrentProfileName() {
    if (IS_CLIENT_NODE) return getClientProfile().profileName;
    return state.db.shopName || 'เครื่องแม่';
  }
  function getCurrentDeviceId() {
    if (IS_CLIENT_NODE) return getClientProfile().clientId;
    return state.hwid || state.db.sync.masterDeviceId || 'MASTER';
  }
  function canManageOrders() {
    return !IS_CLIENT_NODE && state.isAdminLoggedIn;
  }
  function formatDurationFrom(startTs) {
    if (!startTs) return 'ยังไม่เริ่มจับเวลา';
    const diff = Math.max(0, Date.now() - startTs);
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const remain = mins % 60;
    if (hours > 0) return `${hours} ชม. ${remain} นาที`;
    return `${mins} นาที`;
  }
  function hashLike(text = '') {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = ((h << 5) - h) + text.charCodeAt(i);
    return Math.abs(h).toString(36).toUpperCase();
  }
  function makeShopId() {
    const base = `${state.db.shopName || 'FAKDU'}-${state.hwid || 'DEVICE'}`;
    return `SHOP-${hashLike(base).slice(0, 8)}`;
  }
  function generateSyncKey(seed = '') {
    const entropy = `${seed}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const numeric = hashLike(entropy).replace(/\D/g, '');
    const base = numeric.slice(0, 6).padEnd(6, '7');
    return base.slice(0, 6);
  }
  function generateSyncPin(shopId = '', syncVersion = 1) {
    const random = String(Math.floor(100000 + Math.random() * 900000));
    const binding = hashLike(`${shopId}-${syncVersion}-${random}`);
    const digits = binding.replace(/\D/g, '');
    if (digits.length >= 2) {
      return `${random.slice(0, 4)}${digits.slice(0, 2)}`;
    }
    return random;
  }
  function ensureClientId() {
    let clientId = localStorage.getItem('FAKDU_CLIENT_ID') || '';
    if (!clientId) {
      clientId = `CLI-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      localStorage.setItem('FAKDU_CLIENT_ID', clientId);
    }
    return clientId;
  }
  function getClientProfile() {
    return {
      clientId: ensureClientId(),
      profileName: localStorage.getItem('FAKDU_CLIENT_PROFILE_NAME') || 'เครื่องลูก',
      avatar: localStorage.getItem('FAKDU_CLIENT_AVATAR') || ''
    };
  }
  function getPendingSyncVersion() {
    const raw = Number(localStorage.getItem(LS_PENDING_SYNC_VERSION) || 0);
    return raw > 0 ? raw : Number(state.db.sync.syncVersion || 1);
  }
  function getPendingMasterShopId() {
    return localStorage.getItem('FAKDU_PENDING_MASTER_SHOP_ID') || state.db.shopId || '';
  }
  function issueClientSessionToken({ shopId, clientId, syncVersion }) {
    const payload = `${shopId}|${clientId}|${syncVersion}|${Date.now()}|${Math.random().toString(36).slice(2, 10)}`;
    return `SESS-${hashLike(payload).padEnd(16, '0').slice(0, 16)}`;
  }

  function makeSyncMessageId() {
    return `MSG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  }
  function resolveFirebaseSyncApi() {
    if (state.firebaseSyncApi) return state.firebaseSyncApi;
    const factory = window.FakduFirebaseSync && typeof window.FakduFirebaseSync.resolveApi === 'function'
      ? window.FakduFirebaseSync.resolveApi
      : null;
    if (!factory) return null;
    try {
      state.firebaseSyncApi = factory();
      return state.firebaseSyncApi;
    } catch (error) {
      console.warn('Firebase sync unavailable', error);
      return null;
    }
  }
  function getClientStatus(client) {
    if (!client) return 'offline';
    const lastSeen = Number(client.lastSeen || 0);
    if (!lastSeen) return 'offline';
    return (Date.now() - lastSeen) <= 25000 ? 'online' : 'offline';
  }
  function openModal(id) {
    const el = qs(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('flex');
    el.style.display = 'flex';
  }
  function closeModal(id) {
    const el = qs(id);
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('flex');
    el.style.display = 'none';
  }
  //* helpers close

  //* sound open
  function playSound(type = 'click') {
    if (!state.db.soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!state.audioCtx) state.audioCtx = new AudioContext();
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(state.audioCtx.destination);
      if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420, state.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(920, state.audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, state.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, state.audioCtx.currentTime + 0.2);
        osc.start();
        osc.stop(state.audioCtx.currentTime + 0.22);
        return;
      }
      if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(190, state.audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, state.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, state.audioCtx.currentTime + 0.18);
        osc.start();
        osc.stop(state.audioCtx.currentTime + 0.18);
        return;
      }
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, state.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, state.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, state.audioCtx.currentTime + 0.05);
      osc.start();
      osc.stop(state.audioCtx.currentTime + 0.06);
    } catch (_) {}
  }

  function showToast(message, type = 'click') {
    playSound(type);
    const el = qs('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'show';
    setTimeout(() => {
      if (el.className === 'show') el.className = '';
    }, 2800);
  }
  //* sound close

  //* normalize open
  function normalizeUnit(unit, id) {
    return {
      id,
      status: unit?.status || 'idle',
      startTime: unit?.startTime || null,
      lastActivityAt: unit?.lastActivityAt || null,
      checkoutRequested: Boolean(unit?.checkoutRequested),
      checkoutRequestedAt: unit?.checkoutRequestedAt || null,
      newItemsQty: Number(unit?.newItemsQty || 0),
      lastOrderBy: unit?.lastOrderBy || '',
      orders: Array.isArray(unit?.orders) ? unit.orders.map((order) => ({
        id: order.id || `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemId: order.itemId || null,
        name: order.name || '-',
        baseName: order.baseName || order.name || '-',
        qty: Number(order.qty || 1),
        price: Number(order.price || 0),
        total: Number(order.total || 0),
        addons: Array.isArray(order.addons) ? order.addons : [],
        note: order.note || '',
        orderBy: order.orderBy || 'Master',
        source: order.source || 'master',
        createdAt: order.createdAt || Date.now()
      })) : []
    };
  }

  function normalizeDb(raw) {
    const merged = { ...clone(DEFAULT_DB), ...(raw || {}) };
    merged.recovery = { ...clone(DEFAULT_DB.recovery), ...(raw?.recovery || {}) };
    merged.sync = {
      ...clone(DEFAULT_DB.sync),
      ...(raw?.sync || {}),
      lastCheck: {
        ...clone(DEFAULT_DB.sync.lastCheck),
        ...(raw?.sync?.lastCheck || {})
      },
      clients: Array.isArray(raw?.sync?.clients) ? raw.sync.clients : [],
      approvals: Array.isArray(raw?.sync?.approvals) ? raw.sync.approvals : [],
      approvedClients: Array.isArray(raw?.sync?.approvedClients) ? raw.sync.approvedClients : [],
      clientSession: raw?.sync?.clientSession && typeof raw.sync.clientSession === 'object'
        ? clone(raw.sync.clientSession)
        : null
    };
    merged.items = Array.isArray(raw?.items) ? raw.items.map((item) => ({
      id: item.id || `ITM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: item.name || '',
      price: Number(item.price || 0),
      img: item.img || '',
      addons: Array.isArray(item.addons) ? item.addons.map((addon) => ({
        name: addon.name || '',
        price: Number(addon.price || 0)
      })) : []
    })) : [];
    merged.units = [];
    const maxCount = Math.max(1, Number(merged.unitCount || 4));
    for (let i = 1; i <= maxCount; i += 1) {
      const existing = Array.isArray(raw?.units) ? raw.units.find((u) => Number(u.id) === i) : null;
      merged.units.push(normalizeUnit(existing, i));
    }
    merged.unitCount = merged.units.length;
    merged.carts = typeof raw?.carts === 'object' && raw?.carts ? raw.carts : {};
    for (let i = 1; i <= merged.unitCount; i += 1) {
      if (!Array.isArray(merged.carts[i])) merged.carts[i] = [];
    }
    merged.sales = Array.isArray(raw?.sales) ? raw.sales : [];
    merged.opLog = Array.isArray(raw?.opLog) ? raw.opLog : [];
    merged.fraudLogs = Array.isArray(raw?.fraudLogs) ? raw.fraudLogs : [];
    if (!merged.shopId) merged.shopId = makeShopId();
    if (!merged.sync.syncVersion || Number(merged.sync.syncVersion) < 1) merged.sync.syncVersion = 1;
    if (!merged.sync.masterDeviceId) merged.sync.masterDeviceId = state.hwid || '';
    if (!merged.sync.currentSyncPin) {
      const legacyKey = String(merged.sync.key || '');
      merged.sync.currentSyncPin = (legacyKey && legacyKey !== String(merged.shopId || ''))
        ? legacyKey
        : generateSyncPin(merged.shopId, merged.sync.syncVersion);
    }
    merged.sync.key = merged.sync.currentSyncPin;
    return merged;
  }
  //* normalize close

  //* save/load open
  async function saveDb({ render = true, sync = true } = {}) {
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(async () => {
      const dbApi = resolveDbApi();
      await dbApi.save(state.db);
      if (render) renderAll();
      if (!IS_CLIENT_NODE) syncMasterMetaToFirebase();
      if (sync) broadcastSnapshot();
    }, 30);
  }

  function logOperation(type, payload = {}) {
    const entry = {
      opId: `OP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      id: `OP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      shopId: state.db.shopId,
      clientId: payload.clientId || (IS_CLIENT_NODE ? getClientProfile().clientId : (state.db.sync.masterDeviceId || state.hwid || 'MASTER')),
      deviceId: payload.deviceId || getCurrentDeviceId(),
      profileName: payload.profileName || getCurrentProfileName(),
      role: payload.role || (IS_CLIENT_NODE ? 'client' : 'master'),
      tableId: payload.tableId || payload.unitId || null,
      type,
      payload: { ...payload, actor: getActorLabel() },
      timestamp: Date.now(),
      at: Date.now()
    };
    state.db.opLog.push(entry);
    if (state.db.opLog.length > 400) state.db.opLog = state.db.opLog.slice(-400);
    const writeTypes = new Set([
      'SEND_ORDER',
      'CLIENT_APPEND_ORDER',
      'CLIENT_APPEND_ORDER_REQUEST',
      'REQUEST_CHECKOUT',
      'CLIENT_REQUEST_CHECKOUT',
      'CHECKOUT_REQUEST_TOGGLE',
      'CONFIRM_PAYMENT'
    ]);
    if (writeTypes.has(type)) {
      const api = resolveFirebaseSyncApi();
      if (api && state.db.shopId) {
        api.writeOperation(state.db.shopId, entry).catch(() => {});
      }
    }
  }
  //* save/load close

  //* theme open
  function applyTheme() {
    if (!state.isPro && !TRIAL_LIMITS.themePalette.includes((state.db.theme || '').toLowerCase())) {
      state.db.theme = TRIAL_LIMITS.themePalette[0];
      if (qs('sys-theme')) qs('sys-theme').value = state.db.theme;
    }
    document.documentElement.style.setProperty('--primary', state.db.theme || '#800000');
    document.documentElement.style.setProperty('--bg', state.db.bgColor || '#f8fafc');
    document.body.style.background = state.db.bgColor || '#f8fafc';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', state.db.theme || '#800000');
    const logo = state.db.logo || qs('shop-logo')?.src;
    if (qs('shop-logo') && logo) qs('shop-logo').src = logo;
    if (qs('system-logo-preview')) qs('system-logo-preview').src = state.db.logo || qs('system-logo-preview').src;
    if (qs('display-shop-name')) qs('display-shop-name').textContent = state.db.shopName || 'FAKDU';
    const trial = qs('trial-badge');
    if (trial) {
      trial.classList.toggle('hidden', state.isPro);
    }
    const recoveryBox = qs('pro-recovery-setup');
    if (recoveryBox) recoveryBox.classList.toggle('hidden', !state.isPro);
    const forgotBtn = qs('btn-open-recovery');
    if (forgotBtn) {
      forgotBtn.disabled = !state.isPro;
      forgotBtn.classList.toggle('opacity-40', !state.isPro);
    }
  }
  //* theme close

  //* header and status open
  function updateMasterConnectionUi() {
    const online = navigator.onLine;
    const dot = qs('online-status-dot');
    const chip = qs('shop-connection-text');
    const mini = qs('shop-status-mini');
    const systemChip = qs('master-online-chip');
    if (dot) {
      dot.classList.toggle('bg-green-500', online);
      dot.classList.toggle('bg-red-500', !online);
    }
    if (chip) {
      chip.textContent = online ? 'ONLINE' : 'OFFLINE';
      chip.className = online
        ? 'text-[10px] font-black px-2 py-0.5 rounded-full bg-white/90 text-emerald-700'
        : 'text-[10px] font-black px-2 py-0.5 rounded-full bg-white/90 text-red-600';
    }
    if (mini) mini.textContent = online ? 'พร้อมใช้งาน' : 'กำลังทำงานแบบออฟไลน์';
    if (systemChip) {
      systemChip.textContent = online ? 'MASTER ONLINE' : 'MASTER OFFLINE';
      systemChip.className = online
        ? 'px-3 py-1.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700'
        : 'px-3 py-1.5 rounded-full text-[10px] font-black bg-red-50 text-red-700';
    }
  }

  function renderOnlineClientsUi() {
    const clients = state.db.sync.clients.filter((client) => client.approved && Number(client.sessionSyncVersion || 0) === Number(state.db.sync.syncVersion || 1));
    const onlineClients = clients.filter((client) => getClientStatus(client) === 'online');
    const strip = qs('header-client-avatars');
    const miniBar = qs('header-online-clients-mini');

    if (miniBar) {
      miniBar.innerHTML = onlineClients.slice(0, 3).map((client) => {
        const avatar = client.avatar
          ? `<img src="${client.avatar}" class="w-full h-full object-cover">`
          : `<span class="text-[10px] font-black text-gray-600">${escapeHtml((client.name || 'C').slice(0, 1).toUpperCase())}</span>`;
        return `<div title="${escapeHtml(client.name || client.clientId)}" class="w-6 h-6 rounded-full bg-white border overflow-hidden flex items-center justify-center shadow-sm">${avatar}</div>`;
      }).join('');
    }

    if (strip) {
      strip.classList.toggle('hidden', onlineClients.length === 0);
      strip.innerHTML = onlineClients.map((client) => {
        const avatar = client.avatar
          ? `<img src="${client.avatar}" class="w-full h-full object-cover">`
          : `<span class="text-[10px] font-black text-gray-700">${escapeHtml((client.name || 'C').slice(0, 1).toUpperCase())}</span>`;
        return `
          <div class="flex items-center gap-1.5 bg-white/85 rounded-full pr-2 pl-1 py-1 shadow-sm border border-white/80">
            <div class="w-5 h-5 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">${avatar}</div>
            <div class="text-[10px] font-black text-gray-700 max-w-[72px] truncate">${escapeHtml(client.name || client.clientId)}</div>
          </div>
        `;
      }).join('');
    }

    renderSyncSlots(onlineClients);
  }

  function renderSyncSlots(onlineClients) {
    const slots = [qs('sync-client-slot-1'), qs('sync-client-slot-2')];
    slots.forEach((slot, index) => {
      if (!slot) return;
      const client = onlineClients[index];
      if (!client) {
        slot.innerHTML = `${index + 1}`;
        slot.className = 'w-6 h-6 rounded-full border-2 border-white bg-gray-200 text-[10px] flex items-center justify-center overflow-hidden';
        return;
      }
      slot.className = 'w-6 h-6 rounded-full border-2 border-white bg-white text-[10px] flex items-center justify-center overflow-hidden shadow-sm';
      slot.innerHTML = client.avatar
        ? `<img src="${client.avatar}" class="w-full h-full object-cover">`
        : `<span class="font-black text-gray-700">${escapeHtml((client.name || 'C').slice(0, 1).toUpperCase())}</span>`;
    });
  }
  //* header and status close

  //* tab open
  function switchTab(id, element = null) {
    state.activeTab = id;
    document.querySelectorAll('.screen').forEach((screen) => {
      screen.classList.add('hidden');
      screen.classList.remove('active');
    });
    const screen = qs(`screen-${id}`);
    if (screen) {
      screen.classList.remove('hidden');
      screen.classList.add('active');
    }
    document.querySelectorAll('.nav-tab').forEach((tab) => tab.classList.remove('active'));
    if (element?.classList) element.classList.add('active');
    else qs(`tab-${id}`)?.classList.add('active');
    if (id === 'customer') renderCustomerGrid();
    if (id === 'shop') renderShopQueue();
    if (id === 'manage') renderAnalytics();
    if (id === 'system') renderSystemPanels();
  }

  function attemptAdmin(target, element) {
    if (state.isAdminLoggedIn) {
      switchTab(target, element);
      return;
    }
    state.pendingAdminAction = { target, elementId: element?.id || null };
    const desc = qs('admin-pin-desc');
    if (desc) desc.textContent = target === 'manage' ? 'รหัสผ่านเพื่อเข้าหลังร้าน' : 'รหัสผ่านเพื่อเข้าระบบ';
    if (qs('admin-pin-input')) qs('admin-pin-input').value = '';
    openModal('modal-admin-pin');
  }

  function verifyAdminPin() {
    const pin = String(qs('admin-pin-input')?.value || '').trim();
    if (!pin) return showToast('กรุณากรอก PIN', 'error');
    if (pin !== String(state.db.adminPin || '1234')) return showToast('PIN ไม่ถูกต้อง', 'error');
    state.isAdminLoggedIn = true;
    localStorage.setItem(LS_ADMIN, 'true');
    closeModal('modal-admin-pin');
    showToast('เข้าใช้งานแอดมินแล้ว', 'success');
    if (state.pendingAdminAction) {
      const target = state.pendingAdminAction.target;
      const el = state.pendingAdminAction.elementId ? qs(state.pendingAdminAction.elementId) : qs(`tab-${target}`);
      switchTab(target, el);
      state.pendingAdminAction = null;
    }
  }

  function adminLogout() {
    const hasPending = state.db.units.some((unit) => unit.orders.length > 0 || (state.db.carts[unit.id] || []).length > 0);
    state.isAdminLoggedIn = false;
    localStorage.setItem(LS_ADMIN, 'false');
    switchTab('customer', qs('tab-customer'));
    showToast(hasPending ? 'ออกจากโหมดแอดมินแล้ว มีรายการค้างในร้าน' : 'ล็อคแอดมินแล้ว', hasPending ? 'error' : 'success');
  }
  //* tab close

  //* grid open
  function changeGridZoom(direction) {
    playSound('click');
    state.gridZoom += direction;
    if (state.gridZoom < 1) state.gridZoom = 1;
    if (state.gridZoom > 3) state.gridZoom = 3;
    updateGridZoomUi();
    renderCustomerGrid();
  }

  function updateGridZoomUi() {
    const text = qs('zoom-level-text');
    const grid = qs('grid-units');
    if (text) text.textContent = state.gridZoom === 1 ? 'S' : state.gridZoom === 2 ? 'M' : 'L';
    if (!grid) return;
    grid.classList.remove('grid-cols-1', 'grid-cols-2', 'grid-cols-3');
    grid.classList.add(state.gridZoom === 1 ? 'grid-cols-3' : state.gridZoom === 2 ? 'grid-cols-2' : 'grid-cols-1');
  }

 // codex/remove-notifications-and-fix-pin-access-f1rtk5
  function getUnitCardClass(unit) {
    const cart = state.db.carts[unit.id] || [];
    if (cart.length > 0) return 'unit-card--draft';
    if (unit.orders.length > 0 || unit.checkoutRequested) return 'unit-card--busy';
    return 'unit-card--idle';
  }

function getUnitCardClass(unit) {
  const cart = state.db.carts[unit.id] || [];
  if (cart.length > 0) return 'unit-card--draft';
  if (unit.orders.length > 0 || unit.checkoutRequested) return 'unit-card--busy';
  return 'unit-card--idle';
}

  function getUnitStatusMeta(unit) {
    const cart = state.db.carts[unit.id] || [];
    if (cart.length > 0) return { cls: 'status-draft', label: '' };
    if (unit.checkoutRequested) return { cls: 'status-active', label: '' };
    if (unit.orders.length > 0) return { cls: 'status-active', label: '' };
    return { cls: 'status-idle', label: 'ว่าง' };
  }

  function toggleCustomerGridCollapse() {
    state.customerGridCollapsed = !state.customerGridCollapsed;
    renderCustomerGrid();
  }

  function toggleShopQueueCollapse() {
    state.shopQueueCollapsed = !state.shopQueueCollapsed;
    renderShopQueue();
  }

  function renderCustomerGrid() {
    const grid = qs('grid-units');
    if (!grid) return;
    updateGridZoomUi();
    const toolbar = qs('customer-grid-toolbar');
    const toggleBtn = qs('btn-toggle-grid-collapse');
    const shouldCollapse = state.db.units.length > 12;
    if (toolbar && toggleBtn) {
      toolbar.classList.toggle('hidden', !shouldCollapse);
      toggleBtn.textContent = state.customerGridCollapsed ? `ดูทั้งหมด (${state.db.units.length})` : 'ย่อรายการ';
    }
    const unitsToRender = shouldCollapse && state.customerGridCollapsed ? state.db.units.slice(0, 12) : state.db.units;
    grid.innerHTML = unitsToRender.map((unit) => {
      const cart = state.db.carts[unit.id] || [];
      const total = unit.orders.reduce((sum, order) => sum + order.total, 0);
      const cartTotal = cart.reduce((sum, item) => sum + item.total, 0);
      const statusMeta = getUnitStatusMeta(unit);
      const statusText = statusMeta.label;
      const statusPillClass = statusMeta.cls === 'status-draft'
        ? 'bg-amber-100 text-amber-700'
        : statusMeta.cls === 'status-active'
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-gray-100 text-gray-500';
      const secondary = cart.length > 0
          ? `ตะกร้า ฿${formatMoney(cartTotal)}`
        : unit.orders.length > 0
          ? `ยอดรวม ฿${formatMoney(total)}`
          : '-';
      const timeText = unit.startTime ? formatDurationFrom(unit.startTime) : '-';
      return `
        <button onclick="openTable(${unit.id})" class="unit-status-ring ${statusMeta.cls} text-left p-4 rounded-[26px] border-2 shadow-sm transition active:scale-[0.98] ${getUnitCardClass(unit)}">
          <div class="flex items-start justify-between gap-2 mb-3">
            <div>
              <div class="text-[11px] font-bold text-gray-400 uppercase tracking-widest">${escapeHtml(state.db.unitType)}</div>
              <div class="font-black text-3xl text-gray-800 leading-none">${unit.id}</div>
            </div>
            <div class="text-right">
              ${statusText ? `<div class="text-[11px] px-2 py-1 rounded-full font-black ${statusPillClass}" title="${statusMeta.label}">${statusText}</div>` : ''}
              ${unit.newItemsQty > 0 ? `<div class="text-[10px] mt-2 font-black text-red-500">+${unit.newItemsQty} ใหม่</div>` : ''}
            </div>
          </div>
          <div class="text-[12px] font-black text-gray-700 mb-1">${secondary}</div>
          <div class="flex justify-between items-center text-[10px] text-gray-500 font-bold">
            <span class="admin-timer" data-start="${unit.startTime || ''}">${timeText}</span>
            <span>${unit.orders.length > 0 ? `${unit.orders.reduce((s, o) => s + o.qty, 0)} รายการ` : `${cart.length} ตะกร้า`}</span>
          </div>
        </button>
      `;
    }).join('');
  }
  //* grid close

  //* order open
  function openTable(id) {
    state.activeUnitId = Number(id);
    const unit = state.db.units.find((item) => item.id === Number(id));
    if (!unit) return;
    const title = qs('active-unit-id');
    const time = qs('active-unit-time');
    if (title) title.textContent = id;
    if (time) time.textContent = unit.startTime ? `ใช้งานมาแล้ว ${formatDurationFrom(unit.startTime)}` : 'ยังไม่เริ่มจับเวลา';
    renderOrderedItemsBar(unit);
    renderItemList();
    updateCartTotal();
    switchTab('order');
  }

  function renderOrderedItemsBar(unit) {
    const box = qs('ordered-items-bar');
    const list = qs('ordered-items-list');
    if (!box || !list) return;
    if (!unit || unit.orders.length === 0) {
      box.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    list.innerHTML = unit.orders.map((order) => `
      <div class="flex justify-between gap-2">
        <span>${escapeHtml(order.name)} x${order.qty}</span>
        <span class="font-black">฿${formatMoney(order.total)}</span>
      </div>
    `).join('');
  }

  function renderItemList() {
    const list = qs('item-list');
    if (!list) return;
    if (state.db.items.length === 0) {
      list.innerHTML = `
        <div class="bg-white rounded-[24px] p-6 border text-center text-gray-400 font-bold">
          ยังไม่มีรายการเมนู<br><span class="text-[11px]">เข้าไปเพิ่มที่ หลังร้าน → จัดการร้าน</span>
        </div>
      `;
      return;
    }
    list.innerHTML = state.db.items.map((item, index) => `
      <button onclick="handleItemClickByIndex(${index})" class="w-full bg-white p-3 rounded-[24px] border shadow-sm flex gap-3 active:scale-[0.99]">
        ${item.img
          ? `<img src="${item.img}" class="w-20 h-20 rounded-[18px] object-cover bg-gray-100">`
          : `<div class="w-20 h-20 rounded-[18px] bg-gray-100 flex items-center justify-center text-3xl">🍽️</div>`}
        <div class="flex-1 text-left min-w-0">
          <div class="flex justify-between gap-2 items-start">
            <div class="font-black text-lg text-gray-800 truncate">${escapeHtml(item.name)}</div>
            <div class="font-black theme-text text-xl whitespace-nowrap">฿${formatMoney(item.price)}</div>
          </div>
          <div class="mt-2 text-[11px] text-gray-500 font-bold">${item.addons?.length ? `มีรายการเสริม ${item.addons.length} ตัวเลือก` : 'แตะเพื่อใส่ตะกร้า'}</div>
          ${item.addons?.length ? '<div class="mt-2 inline-flex px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black">+ Add-on</div>' : ''}
        </div>
      </button>
    `).join('');
  }

  function handleItemClick(itemId) {
    const item = state.db.items.find((row) => String(row.id) === String(itemId));
    if (!item || !state.activeUnitId) return;
    playSound('click');
    if (item.addons?.length) {
      state.pendingAddonItem = item;
      state.currentAddonQty = 1;
      if (qs('addon-modal-name')) qs('addon-modal-name').textContent = item.name;
      if (qs('addon-modal-price')) qs('addon-modal-price').textContent = formatMoney(item.price);
      if (qs('addon-qty-display')) qs('addon-qty-display').textContent = '1';
      const options = qs('addon-options-list');
      if (options) {
        options.innerHTML = item.addons.map((addon, index) => `
          <label class="flex items-center justify-between gap-2 bg-gray-50 rounded-xl p-3 border cursor-pointer">
            <div>
              <div class="font-black text-gray-800">${escapeHtml(addon.name)}</div>
              <div class="text-[11px] text-gray-500 font-bold">+฿${formatMoney(addon.price)}</div>
            </div>
            <input type="checkbox" class="addon-checkbox w-5 h-5" data-name="${escapeHtml(addon.name)}" data-price="${Number(addon.price || 0)}" value="${index}">
          </label>
        `).join('');
      }
      openModal('modal-addon-select');
      return;
    }
    addToCartActual(item, [], 1);
  }

  function adjustAddonQty(delta) {
    state.currentAddonQty += delta;
    if (state.currentAddonQty < 1) state.currentAddonQty = 1;
    if (qs('addon-qty-display')) qs('addon-qty-display').textContent = String(state.currentAddonQty);
    playSound('click');
  }

  function confirmAddonSelection() {
    if (!state.pendingAddonItem) return;
    const addons = [...document.querySelectorAll('.addon-checkbox:checked')].map((checkbox) => ({
      name: checkbox.getAttribute('data-name') || '',
      price: Number(checkbox.getAttribute('data-price') || 0)
    }));
    addToCartActual(state.pendingAddonItem, addons, state.currentAddonQty);
    state.pendingAddonItem = null;
    state.currentAddonQty = 1;
    closeModal('modal-addon-select');
  }

  function addToCartActual(item, addons = [], qty = 1) {
    if (!state.activeUnitId) return;
    const unitCart = state.db.carts[state.activeUnitId] || [];
    const addonNames = addons.map((addon) => addon.name).join(', ');
    const addonPrice = addons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
    const linePrice = Number(item.price || 0) + addonPrice;
    const lineName = addonNames ? `${item.name} (${addonNames})` : item.name;
    const existing = unitCart.find((row) => row.name === lineName && row.price === linePrice);
    if (existing) {
      existing.qty += qty;
      existing.total = existing.qty * existing.price;
    } else {
      unitCart.push({
        id: `CART-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemId: item.id,
        baseName: item.name,
        name: lineName,
        price: linePrice,
        qty,
        total: qty * linePrice,
        addons: clone(addons),
        createdAt: Date.now()
      });
    }
    state.db.carts[state.activeUnitId] = unitCart;
    logOperation('ADD_TO_CART', { unitId: state.activeUnitId, itemId: item.id, qty, addons });
    updateCartTotal();
    saveDb({ render: true, sync: true });
    showToast('ใส่ตะกร้าแล้ว', 'success');
  }

  function updateCartTotal() {
    const cart = state.activeUnitId ? (state.db.carts[state.activeUnitId] || []) : [];
    const total = cart.reduce((sum, row) => sum + row.total, 0);
    const qty = cart.reduce((sum, row) => sum + row.qty, 0);
    if (qs('cart-total')) qs('cart-total').textContent = formatMoney(total);
    if (qs('cart-count')) qs('cart-count').textContent = String(qty);
    const sendBtn = qs('btn-send-order');
    if (sendBtn) {
      const enabled = qty > 0;
      sendBtn.disabled = !enabled;
      sendBtn.classList.toggle('is-disabled', !enabled);
      sendBtn.classList.toggle('is-ready', enabled);
    }
  }

  function handleItemClickByIndex(index) {
    const item = state.db.items[index];
    if (!item) return;
    handleItemClick(item.id);
  }

  function reviewCart() {
    openReviewCartModal();
  }

  function openReviewCartModal() {
    const cart = state.activeUnitId ? (state.db.carts[state.activeUnitId] || []) : [];
    if (!cart.length) return showToast('ตะกร้าว่าง', 'error');
    if (qs('review-unit-id')) qs('review-unit-id').textContent = String(state.activeUnitId);
    const list = qs('review-list');
    if (list) {
      list.innerHTML = cart.map((row, index) => `
        <div class="py-3 flex items-center justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="font-black text-gray-800 truncate">${escapeHtml(row.name)}</div>
            <div class="text-[11px] text-gray-500 font-bold">฿${formatMoney(row.price)} × ${row.qty}</div>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="editCartItem(${index}, -1)" class="w-8 h-8 rounded-lg bg-gray-100 font-black">-</button>
            <span class="font-black text-lg w-6 text-center">${row.qty}</span>
            <button onclick="editCartItem(${index}, 1)" class="w-8 h-8 rounded-lg bg-gray-100 font-black">+</button>
          </div>
          <div class="font-black theme-text w-20 text-right">฿${formatMoney(row.total)}</div>
        </div>
      `).join('');
    }
    const total = cart.reduce((sum, row) => sum + row.total, 0);
    if (qs('review-total-price')) qs('review-total-price').textContent = formatMoney(total);
    openModal('modal-review');
  }

  function editCartItem(index, delta) {
    const cart = state.activeUnitId ? (state.db.carts[state.activeUnitId] || []) : [];
    const item = cart[index];
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
      cart.splice(index, 1);
    } else {
      item.total = item.qty * item.price;
    }
    state.db.carts[state.activeUnitId] = cart;
    updateCartTotal();
    openReviewCartModal();
    saveDb({ render: true, sync: false });
  }

  async function confirmOrderSend() {
    const unit = state.db.units.find((row) => row.id === Number(state.activeUnitId));
    const cart = state.db.carts[state.activeUnitId] || [];
    if (!unit || !cart.length) return showToast('ไม่มีรายการส่ง', 'error');
    if (IS_CLIENT_NODE) {
      const session = getStoredClientSession();
      if (!session?.clientSessionToken) return showToast('ยังไม่ได้รับสิทธิ์จากเครื่องแม่', 'error');
      const profile = getClientProfile();
      const action = {
        type: 'APPEND_ORDER',
        opId: `OP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        shopId: session.shopId,
        syncVersion: Number(session.syncVersion || 1),
        clientId: profile.clientId,
        clientSessionToken: session.clientSessionToken,
        profileName: profile.profileName,
        unitId: state.activeUnitId,
        items: clone(cart)
      };
      await enqueueClientOp(action);
      await flushClientOpQueue();
      logOperation('CLIENT_APPEND_ORDER_REQUEST', { unitId: state.activeUnitId, profileName: profile.profileName, clientId: profile.clientId, role: 'client' });
      state.db.carts[state.activeUnitId] = [];
      closeModal('modal-review');
      renderOrderedItemsBar(unit);
      updateCartTotal();
      saveDb({ render: true, sync: false });
      showToast(navigator.onLine ? 'ส่งออร์เดอร์ไปเครื่องแม่แล้ว' : 'บันทึกคิวไว้แล้ว จะซิงก์เมื่อออนไลน์', navigator.onLine ? 'success' : 'click');
      switchTab('customer', qs('tab-customer'));
      return;
    }
    if (!unit.startTime) unit.startTime = Date.now();
    unit.lastActivityAt = Date.now();
    unit.status = 'active';
    unit.checkoutRequested = false;
    unit.checkoutRequestedAt = null;
    unit.lastOrderBy = 'Master';

    cart.forEach((row) => {
      const copy = {
        id: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemId: row.itemId,
        baseName: row.baseName,
        name: row.name,
        qty: row.qty,
        price: row.price,
        total: row.total,
        addons: clone(row.addons || []),
        source: 'master',
        orderBy: 'Master',
        createdAt: Date.now()
      };
      unit.orders.push(copy);
      unit.newItemsQty += row.qty;
    });

    logOperation('SEND_ORDER', { unitId: state.activeUnitId, lines: clone(cart) });
    state.db.carts[state.activeUnitId] = [];
    closeModal('modal-review');
    renderOrderedItemsBar(unit);
    updateCartTotal();
    saveDb({ render: true, sync: true });
    showToast('ส่งออร์เดอร์แล้ว', 'success');
    switchTab('customer', qs('tab-customer'));
  }
  //* order close

  //* queue and checkout open
  function renderShopQueue() {
    const queue = qs('shop-queue');
    const count = qs('shop-request-count');
    if (!queue) return;
    const activeUnits = state.db.units
      .filter((unit) => unit.orders.length > 0 || (state.db.carts[unit.id] || []).length > 0)
      .sort((a, b) => Number(b.checkoutRequested) - Number(a.checkoutRequested) || (a.startTime || 0) - (b.startTime || 0));
    if (count) count.textContent = `${activeUnits.length} รายการ`;
    const queueToolbar = qs('shop-queue-toolbar');
    const queueToggle = qs('btn-toggle-queue-collapse');
    const shouldCollapse = activeUnits.length > 10;
    if (queueToolbar && queueToggle) {
      queueToolbar.classList.toggle('hidden', !shouldCollapse);
      queueToggle.textContent = state.shopQueueCollapsed ? `ดูทั้งหมด (${activeUnits.length})` : 'ย่อรายการ';
    }
    const queueRows = shouldCollapse && state.shopQueueCollapsed ? activeUnits.slice(0, 10) : activeUnits;
    if (!activeUnits.length) {
      queue.innerHTML = '<div class="bg-white p-6 rounded-[24px] border text-center text-gray-400 font-bold">ยังไม่มีโต๊ะที่รอเช็คบิล</div>';
      return;
    }
    queue.innerHTML = queueRows.map((unit) => {
      const cart = state.db.carts[unit.id] || [];
      const hasDraft = cart.length > 0;
      const statusMeta = getUnitStatusMeta(unit);
      const total = unit.orders.reduce((sum, row) => sum + row.total, 0);
      const draftTotal = cart.reduce((sum, row) => sum + row.total, 0);
      const checkoutActionLabel = hasDraft
        ? 'ไปส่งออร์เดอร์'
        : IS_CLIENT_NODE
          ? 'ดูสถานะ'
          : 'เปิดบิล';
      const checkoutAction = hasDraft ? `openTable(${unit.id})` : `openCheckout(${unit.id})`;
      const checkoutRequestBtn = hasDraft
        ? `<button onclick="markCheckoutRequest(${unit.id})" class="bg-amber-50 text-amber-700 border border-amber-200 px-4 py-3 rounded-2xl font-black text-sm active:scale-95 opacity-60 pointer-events-none">ขอเช็คบิล</button>`
        : IS_CLIENT_NODE
          ? `<button onclick="markCheckoutRequest(${unit.id})" class="bg-amber-50 text-amber-700 border border-amber-200 px-4 py-3 rounded-2xl font-black text-sm active:scale-95 ${unit.checkoutRequested ? 'opacity-60 pointer-events-none' : ''}">${unit.checkoutRequested ? 'ขอเช็คบิลแล้ว' : 'ขอเช็คบิล'}</button>`
          : '';
      return `
        <div class="unit-status-ring ${statusMeta.cls} bg-white p-4 rounded-[24px] border-2 shadow-sm relative ${getUnitCardClass(unit)}">
          ${unit.newItemsQty > 0 ? `<div class="absolute -top-2 -left-2 bg-red-500 text-white text-[9px] font-black px-2 py-1 rounded-full shadow border-2 border-white">+${unit.newItemsQty}</div>` : ''}
          <div class="flex items-start justify-between gap-3 mb-3">
            <div>
              <div class="font-black text-2xl text-gray-800">${getUnitLabel(unit.id)}</div>
              <div class="text-[11px] font-bold text-gray-400">${hasDraft ? 'มีรายการค้างในตะกร้า' : unit.checkoutRequested ? 'รอเช็คบิล' : 'ยังไม่มีคำขอเช็คบิล'}</div>
            </div>
            <div class="text-right">
              <div class="font-black text-xl text-gray-800">฿${formatMoney(hasDraft ? draftTotal : total)}</div>
              <div class="text-[10px] text-gray-400 font-bold">${formatDurationFrom(unit.startTime)}</div>
            </div>
          </div>
          <div class="text-[11px] text-gray-500 font-bold mb-3 truncate">${hasDraft ? cart.map((row) => `${row.baseName || row.name} x${row.qty}`).join(', ') : unit.orders.map((row) => `${row.baseName || row.name} x${row.qty}`).join(', ')}</div>
          <div class="flex gap-2">
            <button onclick="${checkoutAction}" class="flex-1 bg-slate-900 text-white py-3 rounded-2xl font-black text-sm active:scale-95">${checkoutActionLabel}</button>
            ${checkoutRequestBtn}
          </div>
        </div>
      `;
    }).join('');
  }

  async function markCheckoutRequest(unitId) {
    const unit = state.db.units.find((row) => row.id === Number(unitId));
    if (!unit) return;
    if (IS_CLIENT_NODE && unit.checkoutRequested) {
      showToast('ส่งคำขอเช็คบิลแล้ว รอเครื่องแม่ดำเนินการ', 'click');
      return;
    }
    if (IS_CLIENT_NODE) {
      const session = getStoredClientSession();
      if (!session?.clientSessionToken) return showToast('ยังไม่ได้รับสิทธิ์จากเครื่องแม่', 'error');
      const profile = getClientProfile();
      const action = {
        type: 'REQUEST_CHECKOUT',
        opId: `OP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        shopId: session.shopId,
        syncVersion: Number(session.syncVersion || 1),
        clientId: profile.clientId,
        clientSessionToken: session.clientSessionToken,
        profileName: profile.profileName,
        unitId
      };
      await enqueueClientOp(action);
      await flushClientOpQueue();
      showToast(navigator.onLine ? 'ส่งคำขอเช็คบิลไปเครื่องแม่แล้ว' : 'บันทึกคำขอไว้แล้ว จะซิงก์เมื่อออนไลน์', navigator.onLine ? 'success' : 'click');
      return;
    }
    if (!IS_CLIENT_NODE && unit.checkoutRequested && !canManageOrders()) {
      showToast('ต้องเข้าโหมดแอดมินก่อนจึงยกเลิกคำขอเช็คบิลได้', 'error');
      return;
    }
    unit.checkoutRequested = !unit.checkoutRequested;
    unit.checkoutRequestedAt = unit.checkoutRequested ? Date.now() : null;
    logOperation('CHECKOUT_REQUEST_TOGGLE', {
      unitId,
      unitLabel: getUnitLabel(unit.id),
      value: unit.checkoutRequested
    });
    saveDb({ render: true, sync: true });
  }

  function openCheckout(unitId) {
    const unit = state.db.units.find((row) => row.id === Number(unitId));
    if (!unit) return;
    state.activeUnitId = Number(unitId);
    unit.newItemsQty = 0;
    const list = qs('checkout-item-list');
    const total = unit.orders.reduce((sum, row) => sum + row.total, 0);
    state.currentCheckoutTotal = total;
    if (qs('checkout-unit-id')) qs('checkout-unit-id').textContent = String(unit.id);
    if (qs('checkout-total')) qs('checkout-total').textContent = formatMoney(total);
    if (qs('checkout-live-time')) qs('checkout-live-time').textContent = `เวลาใช้งาน: ${formatDurationFrom(unit.startTime)}`;
    if (list) {
      list.innerHTML = unit.orders.map((row, index) => `
        <div class="flex justify-between items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <div class="font-black text-gray-800 truncate">${escapeHtml(row.name)}</div>
            <div class="text-[10px] text-gray-400 font-bold mt-1">${row.orderBy || 'Master'} • ${thaiDate(row.createdAt)}</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div class="font-black">x${row.qty}</div>
            <div class="font-black w-16 text-right">฿${formatMoney(row.total)}</div>
            ${canManageOrders() ? `<button onclick="deleteOrderItem(${index})" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 font-black">×</button>` : ''}
          </div>
        </div>
      `).join('');
    }
    updateQrDisplay();
    openModal('modal-checkout');
    const paymentButtons = qs('checkout-payment-buttons');
    if (paymentButtons) paymentButtons.classList.toggle('hidden', IS_CLIENT_NODE);
    renderShopQueue();
  }

  function updateQrDisplay() {
    const offlineImg = qs('qr-offline-img');
    const genArea = qs('qr-gen-area');
    const status = qs('qr-status-text');
    if (!offlineImg || !genArea || !status) return;
    offlineImg.classList.add('hidden');
    genArea.innerHTML = '';
    status.textContent = '';

    if (state.db.qrOffline) {
      offlineImg.src = state.db.qrOffline;
      offlineImg.classList.remove('hidden');
      status.textContent = state.db.bank && state.db.ppay ? `${state.db.bank} • ${state.db.ppay}` : 'ใช้ QR ที่ร้านอัปไว้';
      return;
    }

    if (typeof QRCode === 'function' && state.db.ppay) {
      new QRCode(genArea, {
        text: `${state.db.ppay}|${state.currentCheckoutTotal}|${state.db.shopName}`,
        width: 150,
        height: 150
      });
      status.textContent = `${state.db.bank || 'พร้อมเพย์'} • ${state.db.ppay}`;
      return;
    }

    genArea.innerHTML = '<div class="text-xs text-gray-400 font-bold text-center">ยังไม่มี QR<br>กรุณาอัปโหลดในหน้าระบบ</div>';
    status.textContent = 'ไม่มี QR พร้อมใช้งาน';
  }

  function deleteOrderItem(index) {
    if (!canManageOrders()) {
      showToast('เฉพาะเครื่องแม่ที่เข้าโหมดแอดมินเท่านั้นที่ลบออร์เดอร์ได้', 'error');
      return;
    }
    const unit = state.db.units.find((row) => row.id === Number(state.activeUnitId));
    if (!unit) return;
    const removed = unit.orders.splice(index, 1);
    if (removed.length) {
      logOperation('DELETE_ORDER_ITEM', {
        unitId: unit.id,
        unitLabel: getUnitLabel(unit.id),
        deletedAt: Date.now(),
        item: removed[0]
      });
    }
    if (!unit.orders.length) {
      unit.status = 'idle';
      unit.startTime = null;
      unit.lastActivityAt = null;
      unit.checkoutRequested = false;
      unit.checkoutRequestedAt = null;
      unit.newItemsQty = 0;
    }
    saveDb({ render: true, sync: true });
    if (!unit.orders.length) {
      closeModal('modal-checkout');
      showToast('ลบรายการแล้ว โต๊ะว่างแล้ว', 'success');
      return;
    }
    openCheckout(unit.id);
  }

  function confirmPayment(method) {
    if (IS_CLIENT_NODE) {
      showToast('เครื่องลูกดูสถานะบิลได้อย่างเดียว ให้ปิดบิลที่เครื่องแม่', 'error');
      return;
    }
    const unit = state.db.units.find((row) => row.id === Number(state.activeUnitId));
    if (!unit || !unit.orders.length) return;
    const total = unit.orders.reduce((sum, row) => sum + row.total, 0);
    const timestamp = new Date();
    state.db.sales.push({
      id: `SALE-${Date.now()}`,
      unitId: unit.id,
      unitType: state.db.unitType,
      items: clone(unit.orders),
      total,
      method,
      date: getLocalYYYYMMDD(timestamp),
      time: getTimeHHMM(timestamp),
      startedAt: unit.startTime,
      closedAt: Date.now()
    });
    logOperation('CONFIRM_PAYMENT', { unitId: unit.id, total, method });
    state.db.carts[unit.id] = [];
    unit.orders = [];
    unit.status = 'idle';
    unit.startTime = null;
    unit.lastActivityAt = null;
    unit.checkoutRequested = false;
    unit.checkoutRequestedAt = null;
    unit.newItemsQty = 0;
    unit.lastOrderBy = '';
    closeModal('modal-checkout');
    saveDb({ render: true, sync: true });
    showToast(method === 'transfer' ? 'ปิดบิล (โอน/QR) แล้ว' : 'ปิดบิล (เงินสด) แล้ว', 'success');
    if (state.activeTab === 'shop') renderShopQueue();
    if (state.activeTab === 'manage') renderAnalytics();
  }
  //* queue and checkout close

  //* analytics open
  function switchManageSub(name, element) {
    state.activeManageSub = name;
    document.querySelectorAll('.manage-tab').forEach((tab) => {
      tab.classList.remove('active', 'bg-white', 'shadow-sm', 'text-gray-800');
      tab.classList.add('text-gray-500');
    });
    element?.classList?.remove('text-gray-500');
    element?.classList?.add('active', 'bg-white', 'shadow-sm', 'text-gray-800');
    if (qs('sub-dash')) qs('sub-dash').classList.toggle('hidden', name !== 'dash');
    if (qs('sub-menu')) qs('sub-menu').classList.toggle('hidden', name !== 'menu');
    if (name === 'menu') renderAdminLists();
    if (name === 'dash') renderAnalytics();
  }

  function switchDashTab(name, element) {
    state.activeDashSub = name;
    document.querySelectorAll('.dash-sub-tab').forEach((tab) => {
      tab.classList.remove('active', 'bg-white', 'shadow-sm', 'text-gray-800');
      tab.classList.add('text-gray-500');
    });
    element?.classList?.remove('text-gray-500');
    element?.classList?.add('active', 'bg-white', 'shadow-sm', 'text-gray-800');
    if (qs('dash-history')) qs('dash-history').classList.toggle('hidden', name !== 'history');
    if (qs('dash-top')) qs('dash-top').classList.toggle('hidden', name !== 'top');
    renderAnalytics();
  }

  function calculateSalesBuckets() {
    let today = 0;
    let week = 0;
    let month = 0;
    const todayStr = getLocalYYYYMMDD();
    const todayObj = new Date(todayStr);
    const itemCounts = {};

    state.db.sales.forEach((sale) => {
      const saleDateObj = new Date(sale.date);
      const diffDays = Math.floor((todayObj - saleDateObj) / 86400000);
      if (sale.date === todayStr) today += Number(sale.total || 0);
      if (diffDays >= 0 && diffDays < 7) week += Number(sale.total || 0);
      if (diffDays >= 0 && diffDays < 30) month += Number(sale.total || 0);
      (sale.items || []).forEach((row) => {
        const base = row.baseName || (row.name || '').split(' (')[0] || 'ไม่ระบุ';
        itemCounts[base] = (itemCounts[base] || 0) + Number(row.qty || 0);
      });
    });

    return { today, week, month, itemCounts };
  }

  function getSearchDateRange() {
    const today = getLocalYYYYMMDD();
    const startInput = qs('search-start');
    const endInput = qs('search-end');
    let start = startInput?.value || '';
    let end = endInput?.value || '';
    if (!state.isPro) {
      start = today;
      end = today;
      if (startInput) startInput.value = today;
      if (endInput) endInput.value = today;
    } else if (!start && !end) {
      start = today;
      end = today;
      if (startInput) startInput.value = today;
      if (endInput) endInput.value = today;
    } else {
      start = start || end;
      end = end || start;
      if (start > end) [start, end] = [end, start];
      if (startInput) startInput.value = start;
      if (endInput) endInput.value = end;
    }
    return { start, end };
  }

  function getSalesBySelectedRange() {
    const { start, end } = getSearchDateRange();
    return state.db.sales.filter((sale) => sale.date >= start && sale.date <= end);
  }

  function syncCustomSearchUiMode() {
    const startInput = qs('search-start');
    const endInput = qs('search-end');
    const proLockNote = qs('search-pro-lock-note');
    const locked = !state.isPro;
    if (startInput) startInput.disabled = locked;
    if (endInput) endInput.disabled = locked;
    if (proLockNote) proLockNote.classList.toggle('hidden', !locked);
  }

  function renderAnalytics() {
    const { today, week, month } = calculateSalesBuckets();
    if (qs('stat-today')) qs('stat-today').textContent = formatMoney(today);
    if (qs('stat-week')) qs('stat-week').textContent = formatMoney(week);
    if (qs('stat-month')) qs('stat-month').textContent = formatMoney(month);
    const cashTotal = state.db.sales.reduce((sum, sale) => !isTransferMethod(sale.method) ? sum + Number(sale.total || 0) : sum, 0);
    const transferTotal = state.db.sales.reduce((sum, sale) => isTransferMethod(sale.method) ? sum + Number(sale.total || 0) : sum, 0);
    const grandTotal = cashTotal + transferTotal;
    if (qs('stat-grand-total')) qs('stat-grand-total').textContent = formatMoney(grandTotal);
    if (qs('stat-cash-total')) qs('stat-cash-total').textContent = formatMoney(cashTotal);
    if (qs('stat-transfer-total')) qs('stat-transfer-total').textContent = formatMoney(transferTotal);

    const filteredSales = getSalesBySelectedRange();
    const filteredItemCounts = {};
    let filteredAmount = 0;
    filteredSales.forEach((sale) => {
      filteredAmount += Number(sale.total || 0);
      (sale.items || []).forEach((row) => {
        const base = row.baseName || (row.name || '').split(' (')[0] || 'ไม่ระบุ';
        filteredItemCounts[base] = (filteredItemCounts[base] || 0) + Number(row.qty || 0);
      });
    });
    if (qs('search-total')) qs('search-total').textContent = formatMoney(filteredAmount);

    const history = qs('sales-history');
    if (history) {
      if (!filteredSales.length) {
        history.innerHTML = '<div class="py-8 text-center text-gray-400 font-bold">ยังไม่มีประวัติยอดขาย</div>';
      } else {
        history.innerHTML = [...filteredSales].reverse().slice(0, 60).map((sale) => `
          <div class="py-3 flex justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="font-black text-gray-800">${sale.date} <span class="text-gray-400 ml-1">${sale.time}</span></div>
              <div class="text-[10px] text-gray-400 font-bold mt-1 truncate">${(sale.items || []).map((row) => `${row.baseName || row.name} x${row.qty}`).join(', ')}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-black theme-text text-lg">฿${formatMoney(sale.total)}</div>
              <div class="text-[10px] text-gray-500 font-black">${isTransferMethod(sale.method) ? '📱 โอน/QR' : '💵 เงินสด'}</div>
            </div>
          </div>
        `).join('');
      }
    }

    const topBox = qs('top-items-list');
    if (topBox) {
      const top = Object.entries(filteredItemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const topDisplay = state.isPro ? top : top.slice(0, TRIAL_LIMITS.topBasicMax);
      if (!topDisplay.length) {
        topBox.innerHTML = '<div class="py-8 text-center text-gray-400 font-bold">ยังไม่มียอดฮิต</div>';
      } else {
        topBox.innerHTML = topDisplay.map(([name, qty], idx) => `
          <div class="flex justify-between items-center bg-gray-50 p-3 rounded-2xl border">
            <div class="font-black text-gray-800">${idx + 1}. ${escapeHtml(name)}</div>
            <div class="text-[10px] font-black px-2 py-1 rounded-full bg-white border text-gray-500">${qty} ครั้ง</div>
          </div>
        `).join('');
      }
    }

  }

  function calculateCustomSalesRealtime() {
    getSearchDateRange();
    renderAnalytics();
  }

  function clearSales() {
    if (IS_CLIENT_NODE) return showToast('รีเซ็ตยอดขายได้เฉพาะเครื่องแม่', 'error');
    if (!canManageOrders()) return showToast('ต้องเข้าโหมดแอดมินก่อนรีเซ็ตยอดขาย', 'error');
    if (!confirm('ล้างประวัติยอดขายทั้งหมด?')) return;
    state.db.sales = [];
    logOperation('CLEAR_SALES');
    saveDb({ render: true, sync: true });
    showToast('ล้างยอดขายทั้งหมดแล้ว', 'success');
  }
  //* analytics close

  //* menu open
  function renderAdminLists() {
    const list = qs('admin-menu-list');
    if (qs('menu-count')) qs('menu-count').textContent = String(state.db.items.length);
    if (!list) return;
    if (!state.db.items.length) {
      list.innerHTML = '<div class="bg-gray-50 border rounded-[24px] p-6 text-center text-gray-400 font-bold">ยังไม่มีเมนูในระบบ</div>';
      return;
    }
    list.innerHTML = state.db.items.map((item) => `
      <div class="bg-gray-50 border rounded-[24px] p-4">
        <div class="flex gap-4">
          ${item.img ? `<img src="${item.img}" class="w-20 h-20 rounded-[18px] object-cover bg-white border">` : '<div class="w-20 h-20 rounded-[18px] bg-white border flex items-center justify-center text-2xl">🍱</div>'}
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start gap-3">
              <div class="min-w-0">
                <div class="font-black text-lg text-gray-800 truncate">${escapeHtml(item.name)}</div>
                <div class="text-[11px] text-gray-500 font-bold mt-1">฿${formatMoney(item.price)}</div>
              </div>
              <div class="flex gap-2 shrink-0">
                <button onclick="editItem('${item.id}')" class="px-3 py-2 rounded-xl bg-white border text-blue-600 text-xs font-black">แก้ไข</button>
                <button onclick="deleteItem('${item.id}')" class="px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 text-xs font-black">ลบ</button>
              </div>
            </div>
            <div class="mt-3 text-[11px] text-gray-500 font-bold">${item.addons?.length ? `เสริม ${item.addons.map((addon) => `${addon.name}+${addon.price}`).join(', ')}` : 'ไม่มีรายการเสริม'}</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  function openMenuModal(itemId = null) {
    state.tempAddons = [];
    state.tempImg = '';
    if (qs('form-menu-id')) qs('form-menu-id').value = '';
    if (qs('form-menu-name')) qs('form-menu-name').value = '';
    if (qs('form-menu-price')) qs('form-menu-price').value = '';
    if (qs('form-menu-preview')) {
      qs('form-menu-preview').classList.add('hidden');
      qs('form-menu-preview').src = '';
    }
    const title = document.querySelector('#modal-menu-form h3');
    if (title) title.textContent = itemId ? 'แก้ไขรายการเมนู' : 'เพิ่มรายการเมนู';

    if (itemId) {
      const item = state.db.items.find((row) => String(row.id) === String(itemId));
      if (!item) return;
      if (qs('form-menu-id')) qs('form-menu-id').value = String(item.id);
      if (qs('form-menu-name')) qs('form-menu-name').value = item.name;
      if (qs('form-menu-price')) qs('form-menu-price').value = String(item.price);
      state.tempAddons = clone(item.addons || []);
      state.tempImg = item.img || '';
      if (state.tempImg && qs('form-menu-preview')) {
        qs('form-menu-preview').src = state.tempImg;
        qs('form-menu-preview').classList.remove('hidden');
      }
    }
    renderAddonFields();
    openModal('modal-menu-form');
  }

  function editItem(itemId) {
    openMenuModal(itemId);
  }

  function addAddonField() {
    state.tempAddons.push({ name: '', price: 0 });
    renderAddonFields();
  }

  function removeAddonField(index) {
    state.tempAddons.splice(index, 1);
    renderAddonFields();
  }

  function updateAddonField(index, field, value) {
    if (!state.tempAddons[index]) return;
    state.tempAddons[index][field] = field === 'price' ? Number(value || 0) : value;
  }

  function renderAddonFields() {
    const box = qs('addon-fields-container');
    if (!box) return;
    if (!state.tempAddons.length) {
      box.innerHTML = '<div class="text-[11px] text-gray-400 font-bold">ยังไม่มี add-on</div>';
      return;
    }
    box.innerHTML = state.tempAddons.map((addon, index) => `
      <div class="grid grid-cols-[1fr,110px,44px] gap-2">
        <input value="${escapeHtml(addon.name)}" oninput="updateAddonField(${index}, 'name', this.value)" placeholder="ชื่อ add-on" class="border p-3 rounded-xl text-sm font-bold outline-none bg-white">
        <input value="${Number(addon.price || 0)}" oninput="updateAddonField(${index}, 'price', this.value)" type="number" placeholder="ราคา" class="border p-3 rounded-xl text-sm font-bold outline-none bg-white text-center">
        <button onclick="removeAddonField(${index})" class="bg-red-50 border border-red-100 rounded-xl text-red-500 font-black">×</button>
      </div>
    `).join('');
  }

  function saveMenuItem() {
    const id = qs('form-menu-id')?.value?.trim();
    const name = qs('form-menu-name')?.value?.trim();
    const price = Number(qs('form-menu-price')?.value || 0);
    if (!name || price <= 0) return showToast('กรอกชื่อและราคาก่อน', 'error');
    const addons = state.tempAddons.filter((addon) => addon.name?.trim()).map((addon) => ({
      name: addon.name.trim(),
      price: Number(addon.price || 0)
    }));
    if (id) {
      const target = state.db.items.find((row) => String(row.id) === String(id));
      if (!target) return showToast('ไม่พบเมนูที่ต้องการแก้', 'error');
      target.name = name;
      target.price = price;
      target.addons = addons;
      if (state.tempImg) target.img = state.tempImg;
      logOperation('UPDATE_MENU_ITEM', { itemId: target.id });
    } else {
      if (!state.isPro && state.db.items.length >= TRIAL_LIMITS.menuMax) {
        return showToast(`รุ่นทดลองเพิ่มเมนูได้สูงสุด ${TRIAL_LIMITS.menuMax} รายการ`, 'error');
      }
      state.db.items.push({
        id: `ITM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        price,
        img: state.tempImg || '',
        addons
      });
      logOperation('CREATE_MENU_ITEM', { name, price });
    }
    closeModal('modal-menu-form');
    saveDb({ render: true, sync: true });
    showToast('บันทึกเมนูแล้ว', 'success');
  }

  function deleteItem(itemId) {
    if (!confirm('ลบเมนูนี้ใช่ไหม?')) return;
    state.db.items = state.db.items.filter((row) => String(row.id) !== String(itemId));
    logOperation('DELETE_MENU_ITEM', { itemId });
    saveDb({ render: true, sync: true });
    showToast('ลบเมนูแล้ว', 'success');
  }

  function updateUnits() {
    const rawCount = Math.max(1, Number(qs('config-unit-count')?.value || state.db.unitCount || 4));
    const count = state.isPro ? rawCount : Math.min(TRIAL_LIMITS.unitMax, rawCount);
    const type = qs('config-unit-type')?.value || 'โต๊ะ';
    if (!state.isPro && rawCount > TRIAL_LIMITS.unitMax) {
      showToast(`รุ่นทดลองจำกัด ${TRIAL_LIMITS.unitMax} ${type}`, 'error');
    }
    forceRebuildUnits(count, type);
    saveDb({ render: true, sync: true });
    showToast('อัปเดตจำนวนโต๊ะ/คิวแล้ว', 'success');
  }

  function forceRebuildUnits(count, type) {
    const nextUnits = [];
    const nextCarts = {};
    for (let i = 1; i <= count; i += 1) {
      const existing = state.db.units.find((unit) => Number(unit.id) === i);
      nextUnits.push(normalizeUnit(existing, i));
      nextCarts[i] = Array.isArray(state.db.carts[i]) ? state.db.carts[i] : [];
    }
    state.db.unitType = type;
    state.db.unitCount = count;
    state.db.units = nextUnits;
    state.db.carts = nextCarts;
    logOperation('REBUILD_UNITS', { count, type });
  }
  //* menu close

  //* system open
  function loadSettingsToForm() {
    if (qs('sys-shop-name')) qs('sys-shop-name').value = state.db.shopName || '';
    if (qs('sys-theme')) qs('sys-theme').value = state.db.theme || '#800000';
    if (qs('sys-bg')) qs('sys-bg').value = state.db.bgColor || '#f8fafc';
    if (qs('sys-bank')) qs('sys-bank').value = state.db.bank || '';
    if (qs('sys-ppay')) qs('sys-ppay').value = state.db.ppay || '';
    if (qs('sys-pin')) qs('sys-pin').value = state.db.adminPin || '';
    if (qs('config-unit-type')) qs('config-unit-type').value = state.db.unitType || 'โต๊ะ';
    if (qs('config-unit-count')) qs('config-unit-count').value = String(state.db.unitCount || 4);
    if (qs('system-logo-preview') && state.db.logo) qs('system-logo-preview').src = state.db.logo;
    updateRecoveryStateLabels();
  }

  function saveSystemSettings() {
    const newPin = String(qs('sys-pin')?.value || '').trim();
    state.db.shopName = qs('sys-shop-name')?.value?.trim() || 'FAKDU';
    state.db.theme = qs('sys-theme')?.value || '#800000';
    state.db.bgColor = qs('sys-bg')?.value || '#f8fafc';
    state.db.bank = qs('sys-bank')?.value?.trim() || '';
    state.db.ppay = qs('sys-ppay')?.value?.trim() || '';
    if (newPin) state.db.adminPin = newPin;
    if (!state.db.shopId) state.db.shopId = makeShopId();
    logOperation('SAVE_SYSTEM_SETTINGS', { shopName: state.db.shopName });
    applyTheme();
    saveDb({ render: true, sync: true });
    showToast('บันทึกการตั้งค่าแล้ว', 'success');
  }

  function handleImage(event, type) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result || '';
      if (type === 'logo') {
        state.db.logo = result;
        if (qs('system-logo-preview')) qs('system-logo-preview').src = result;
        if (qs('shop-logo')) qs('shop-logo').src = result;
        saveDb({ render: false, sync: true });
        return;
      }
      if (type === 'qr') {
        state.db.qrOffline = result;
        saveDb({ render: false, sync: true });
        showToast('อัปเดต QR Offline แล้ว', 'success');
        return;
      }
      if (type === 'temp') {
        state.tempImg = result;
        if (qs('form-menu-preview')) {
          qs('form-menu-preview').src = result;
          qs('form-menu-preview').classList.remove('hidden');
        }
      }
    };
    reader.readAsDataURL(file);
  }

  async function exportBackup() {
    if (!state.isPro) return showToast('รุ่นทดลองไม่รองรับ Backup', 'error');
    const dbApi = resolveDbApi();
    const raw = dbApi.exportData ? await dbApi.exportData(state.db) : JSON.stringify(state.db, null, 2);
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FAKDU_Backup_${getLocalYYYYMMDD()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('สร้างไฟล์ Backup แล้ว', 'success');
  }

  async function importBackup(event) {
    if (!state.isPro) return showToast('รุ่นทดลองไม่รองรับ Restore', 'error');
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!confirm('ข้อมูลในเครื่องจะถูกแทนที่ด้วยไฟล์ backup นี้ ยืนยันหรือไม่?')) return;
    const text = await file.text();
    try {
      const dbApi = resolveDbApi();
      const imported = dbApi.importData ? await dbApi.importData(text) : JSON.parse(text);
      state.db = normalizeDb(imported);
      await resolveDbApi().save(state.db);
      loadSettingsToForm();
      applyTheme();
      renderAll();
      showToast('กู้คืนข้อมูลสำเร็จ', 'success');
    } catch (error) {
      console.error(error);
      showToast('ไฟล์ Backup ไม่ถูกต้อง', 'error');
    }
  }

  function renderSystemPanels() {
    loadSettingsToForm();
    updateSyncUi();
    renderClientApprovalList();
    updateSyncCheckStatusUi();
  }
  //* system close

  //* recovery open
  function updateRecoveryStateLabels() {
    if (qs('recovery-phone-state')) qs('recovery-phone-state').textContent = state.db.recovery.phone || 'ยังไม่ตั้งค่า';
    if (qs('recovery-color-state')) qs('recovery-color-state').textContent = COLOR_MAP[state.db.recovery.color] || 'ยังไม่ตั้งค่า';
    if (qs('recovery-animal-state')) qs('recovery-animal-state').textContent = ANIMAL_MAP[state.db.recovery.animal] || 'ยังไม่ตั้งค่า';
  }

  function saveRecoveryData() {
    const phone = qs('setup-rec-phone')?.value?.trim() || '';
    const color = qs('setup-rec-color')?.value || '';
    const animal = qs('setup-rec-animal')?.value || '';
    if (!phone || !color || !animal) return showToast('กรอกข้อมูลช่วยจำให้ครบ', 'error');
    state.db.recovery = { phone, color, animal };
    logOperation('SAVE_RECOVERY');
    updateRecoveryStateLabels();
    closeModal('modal-recovery-setup');
    saveDb({ render: false, sync: false });
    showToast('บันทึกข้อมูลช่วยจำแล้ว', 'success');
  }

  function executeRecovery() {
    if (!state.isPro) return showToast('รุ่นทดลองยังไม่รองรับลืมรหัส Admin', 'error');
    const phone = qs('rec-ans-phone')?.value?.trim() || '';
    const color = qs('rec-ans-color')?.value || '';
    const animal = qs('rec-ans-animal')?.value || '';
    if (!phone || !color || !animal) return showToast('ตอบให้ครบก่อน', 'error');
    const ok = phone === state.db.recovery.phone && color === state.db.recovery.color && animal === state.db.recovery.animal;
    if (!ok) {
      state.db.fraudLogs.push({ type: 'RECOVERY_FAIL', at: Date.now() });
      saveDb({ render: false, sync: false });
      return showToast('ข้อมูลช่วยจำไม่ตรง', 'error');
    }
    state.db.adminPin = '1234';
    if (qs('sys-pin')) qs('sys-pin').value = '1234';
    closeModal('modal-recovery');
    saveDb({ render: false, sync: false });
    showToast('รีเซ็ต PIN เป็น 1234 แล้ว', 'success');
  }
  //* recovery close

  //* pro/vault open
  async function syncProStatus() {
    const vault = resolveVaultApi();
    if (typeof vault.isProActive === 'function') {
      try {
        state.isPro = Boolean(await vault.isProActive(state.db));
      } catch (_) {
        state.isPro = Boolean(state.db.licenseActive || state.db.licenseToken);
      }
    } else {
      state.isPro = Boolean(state.db.licenseActive || state.db.licenseToken);
    }
    syncCustomSearchUiMode();
  }

  async function validateProKey() {
    const key = qs('pro-key-input')?.value?.trim() || '';
    if (!key) return showToast('กรอกรหัสปลดล็อกก่อน', 'error');
    const vault = resolveVaultApi();
    let result = null;
    if (typeof vault.activateProKey === 'function') {
      try {
        result = await vault.activateProKey({ key, shopId: state.db.shopId, deviceId: state.hwid, db: state.db });
      } catch (error) {
        console.error(error);
      }
    } else if (typeof vault.validateProKey === 'function') {
      try {
        result = await vault.validateProKey(key, state.db.shopId, state.hwid);
      } catch (error) {
        console.error(error);
      }
    }

    if (result && result.valid === false) {
      return showToast(result.message || 'คีย์ไม่ถูกต้อง', 'error');
    }
    if (!result && key.length < 6) {
      return showToast('คีย์ไม่ถูกต้อง', 'error');
    }

    state.db.licenseToken = result?.token || key;
    state.db.licenseActive = true;
    logOperation('ACTIVATE_PRO');
    await syncProStatus();
    applyTheme();
    closeModal('modal-pro-unlock');
    saveDb({ render: true, sync: false });
    showToast('ปลดล็อก PRO สำเร็จ', 'success');
  }

  function handleLockedFeatureClick() {
    if (state.isPro) return;
    openModal('modal-pro-unlock');
  }

  function applyTrialUiGuards() {
    if (state.isPro) return;
    if ((state.db.unitCount || 0) > TRIAL_LIMITS.unitMax) {
      forceRebuildUnits(TRIAL_LIMITS.unitMax, state.db.unitType || 'โต๊ะ');
    }
    if (state.db.items.length > TRIAL_LIMITS.menuMax) {
      state.db.items = state.db.items.slice(0, TRIAL_LIMITS.menuMax);
    }
    if (Array.isArray(state.db.sync.clients) && state.db.sync.clients.length > TRIAL_LIMITS.onlineClientMax) {
      state.db.sync.clients = state.db.sync.clients.slice(0, TRIAL_LIMITS.onlineClientMax);
    }
    const unitInput = qs('config-unit-count');
    if (unitInput) unitInput.max = String(TRIAL_LIMITS.unitMax);
    const addMenuBtn = qs('btn-add-menu-item');
    if (addMenuBtn) addMenuBtn.disabled = state.db.items.length >= TRIAL_LIMITS.menuMax;
    const backupBtn = qs('btn-export-backup');
    if (backupBtn) backupBtn.disabled = true;
    const restoreWrap = qs('btn-import-backup-wrap');
    const restoreInput = qs('input-import-backup');
    if (restoreWrap) restoreWrap.classList.add('opacity-50', 'pointer-events-none');
    if (restoreInput) restoreInput.disabled = true;
  }
  //* pro/vault close

  //* sync open
  async function dispatchIncomingSyncMessage(msg) {
    if (!msg?.type) return;
    if (msg.originDeviceId && msg.originDeviceId === state.hwid) return;
    const msgId = String(msg.id || '');
    if (msgId) {
      if (state.processedSyncMessages.has(msgId)) return;
      state.processedSyncMessages.add(msgId);
      if (state.processedSyncMessages.size > 400) {
        const oldest = state.processedSyncMessages.values().next().value;
        if (oldest) state.processedSyncMessages.delete(oldest);
      }
    }
    if (msg.type === 'CLIENT_HEARTBEAT') handleClientHeartbeat(msg.client);
    if (msg.type === 'CLIENT_ACCESS_REQUEST') handleClientAccessRequest(msg.client);
    if (msg.type === 'CLIENT_ACTION') handleClientAction(msg.action);
    if (msg.type === 'CLIENT_SYNC_CHECK_ACK') handleClientSyncAck(msg.payload);
    if (msg.type === 'MASTER_SNAPSHOT') handleMasterSnapshot(msg.payload);
    if (msg.type === 'MASTER_APPROVAL') handleMasterApproval(msg.payload);
    if (msg.type === 'MASTER_ACTION_ACK') handleMasterActionAck(msg.payload);
    if (msg.type === 'MASTER_SYNC_ROTATED') handleMasterSyncRotated(msg.payload);
  }

  async function emitSyncMessage(msg = {}, { withFirebase = true } = {}) {
    const payload = {
      ...msg,
      id: msg.id || makeSyncMessageId(),
      originDeviceId: state.hwid,
      sentAt: Date.now()
    };
    try {
      state.syncChannel?.postMessage(payload);
    } catch (_) {}
    if (withFirebase) {
      const api = resolveFirebaseSyncApi();
      if (api && state.db.shopId) {
        try { await api.send(state.db.shopId, payload); } catch (_) {}
      }
    }
  }

  async function syncMasterMetaToFirebase() {
    if (IS_CLIENT_NODE || !state.db.shopId) return;
    const api = resolveFirebaseSyncApi();
    if (!api) return;
    try {
      await api.writeSyncMeta(state.db.shopId, {
        shopId: state.db.shopId,
        shopName: state.db.shopName || 'FAKDU',
        masterDeviceId: state.db.sync.masterDeviceId || state.hwid || '',
        currentSyncPin: state.db.sync.currentSyncPin || '',
        syncVersion: Number(state.db.sync.syncVersion || 1),
        approvedClients: state.db.sync.approvedClients || []
      });
    } catch (_) {}
  }

  async function bindSyncChannel() {
    try {
      if (state.syncChannel) state.syncChannel.close();
      state.syncChannel = new BroadcastChannel(`FAKDU_SYNC_${state.db.shopId || 'DEFAULT'}`);
      state.syncChannel.onmessage = (event) => {
        dispatchIncomingSyncMessage(event.data || {});
      };
    } catch (error) {
      console.warn('BroadcastChannel unavailable', error);
    }

    if (state.stopFirebaseListener) {
      try { state.stopFirebaseListener(); } catch (_) {}
      state.stopFirebaseListener = null;
    }
    const api = resolveFirebaseSyncApi();
    if (api && state.db.shopId) {
      const minTs = Date.now() - 4000;
      try {
        state.stopFirebaseListener = api.listen(state.db.shopId, minTs, (msg) => dispatchIncomingSyncMessage(msg));
      } catch (_) {
        state.stopFirebaseListener = null;
      }
    }
    if (!IS_CLIENT_NODE) await syncMasterMetaToFirebase();
  }

  function broadcastSnapshot() {
    try {
      const payload = {
        shopId: state.db.shopId,
        masterDeviceId: state.db.sync.masterDeviceId || state.hwid || '',
        shopName: state.db.shopName,
        theme: state.db.theme,
        bgColor: state.db.bgColor,
        logo: state.db.logo,
        unitType: state.db.unitType,
        unitCount: state.db.unitCount,
        items: state.db.items,
        units: state.db.units,
        salesCount: state.db.sales.length,
        syncPin: state.db.sync.currentSyncPin,
        syncVersion: Number(state.db.sync.syncVersion || 1),
        approvedClients: state.db.sync.approvedClients || [],
        clientSession: null,
        at: Date.now()
      };
      emitSyncMessage({
        type: 'MASTER_SNAPSHOT',
        payload
      });
      const api = resolveFirebaseSyncApi();
      if (api && state.db.shopId) api.writeSnapshot(state.db.shopId, payload).catch(() => {});
      localStorage.setItem(`${LS_SNAPSHOT_PREFIX}${state.db.shopId || 'DEFAULT'}`, JSON.stringify(payload));
    } catch (_) {}
  }

  function applyMasterSnapshot(payload) {
    if (!payload || !IS_CLIENT_NODE) return;
    if (!isClientSessionValid()) return;
 
    const session = getStoredClientSession();
    if (session && Number(payload.syncVersion || 0) > Number(session.syncVersion || 0)) {
      invalidateClientSession('เครื่องแม่เปลี่ยน PIN แล้ว กรุณาขออนุมัติใหม่');
      return;
    }
 

    if (payload.shopId && state.db.shopId && payload.shopId !== state.db.shopId) return;
    if (payload.shopId) state.db.shopId = payload.shopId;
    if (payload.masterDeviceId) state.db.sync.masterDeviceId = payload.masterDeviceId;
    state.db.shopName = payload.shopName || state.db.shopName;
    state.db.theme = payload.theme || state.db.theme;
    state.db.bgColor = payload.bgColor || state.db.bgColor;
    state.db.logo = payload.logo || state.db.logo;
    state.db.unitType = payload.unitType || state.db.unitType;
    if (payload.syncVersion) state.db.sync.syncVersion = Number(payload.syncVersion || state.db.sync.syncVersion || 1);
    if (payload.syncPin) {
      state.db.sync.currentSyncPin = payload.syncPin;
      state.db.sync.key = payload.syncPin;
    }
    if (Array.isArray(payload.approvedClients)) state.db.sync.approvedClients = payload.approvedClients;
    if (Array.isArray(payload.items)) state.db.items = payload.items;
    if (Array.isArray(payload.units)) {
      state.db.units = payload.units.map((unit, index) => normalizeUnit(unit, index + 1));
      state.db.unitCount = state.db.units.length;
    }
    saveDb({ render: true, sync: false });
  }

  function handleMasterSnapshot(payload) {
    applyMasterSnapshot(payload);
  }

  async function handleMasterApproval(payload) {
    if (!IS_CLIENT_NODE || !payload?.clientId) return;
    const clientId = localStorage.getItem('FAKDU_CLIENT_ID') || '';
    if (!clientId || payload.clientId !== clientId) return;
    if (payload.approved) {
      localStorage.setItem(LS_FORCE_CLIENT_MODE, 'true');
      localStorage.setItem('FAKDU_CLIENT_APPROVED', 'true');
      if (payload.syncKey) localStorage.setItem('FAKDU_PENDING_CLIENT_PIN', payload.syncKey);
      if (payload.shopId) localStorage.setItem('FAKDU_PENDING_MASTER_SHOP_ID', payload.shopId);
      const sessionPayload = {
        shopId: payload.shopId || state.db.shopId || '',
        clientId,
        profileName: payload.profileName || getClientProfile().profileName,
        clientSessionToken: payload.clientSessionToken || '',
        syncVersion: Number(payload.syncVersion || 1)
      };
      await persistClientSession(sessionPayload);
      state.db.sync.clientSession = {
        shopId: sessionPayload.shopId || state.db.shopId || '',
        clientId,
        clientSessionToken: sessionPayload.clientSessionToken || '',
        syncVersion: Number(sessionPayload.syncVersion || 1)
      };
      localStorage.setItem(LS_PENDING_SYNC_VERSION, String(Number(payload.syncVersion || 1)));
      await clearClientOpQueue();
      flushClientOpQueue();
      showToast('เครื่องแม่อนุมัติแล้ว', 'success');
      return;
    }
    await invalidateClientSession('เครื่องแม่ปฏิเสธคำขอ');
  }

  function startSyncPollingFallback() {
    clearInterval(state.syncPollTimer);
    state.syncPollTimer = setInterval(() => {
      if (!IS_CLIENT_NODE) return;
      const key = `${LS_SNAPSHOT_PREFIX}${state.db.shopId || localStorage.getItem('FAKDU_PENDING_MASTER_SHOP_ID') || 'DEFAULT'}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        applyMasterSnapshot(JSON.parse(raw));
      } catch (_) {}
    }, 1200);
  }

  function getStoredClientSession() {
    try {
      const raw = localStorage.getItem('FAKDU_CLIENT_SESSION');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function persistClientSession(session = null) {
    if (session && typeof session === 'object') {
      localStorage.setItem('FAKDU_CLIENT_SESSION', JSON.stringify(session));
    } else {
      localStorage.removeItem('FAKDU_CLIENT_SESSION');
    }
    const dbApi = resolveDbApi();
    if (dbApi && typeof dbApi.saveClientSession === 'function') {
      try {
        await dbApi.saveClientSession(session && typeof session === 'object' ? session : null);
      } catch (_) {}
    }
  }

  async function hydrateClientSessionFromDb() {
    if (!IS_CLIENT_NODE) return;
    if (getStoredClientSession()?.clientSessionToken) return;
    const dbApi = resolveDbApi();
    if (!dbApi || typeof dbApi.loadClientSession !== 'function') return;
    try {
      const dbSession = await dbApi.loadClientSession();
      if (dbSession && dbSession.clientSessionToken) {
        localStorage.setItem('FAKDU_CLIENT_SESSION', JSON.stringify(dbSession));
      }
    } catch (_) {}
  }

  function isClientSessionValid() {
    const session = getStoredClientSession();
    if (!session) return false;
    if (!session.clientSessionToken || !session.clientId || !session.shopId) return false;
    return Number(session.syncVersion || 0) === Number(state.db.sync.syncVersion || session.syncVersion || 1);
  }

  function getClientQueueStorageApi() {
    if (window.FakduDB && typeof window.FakduDB.loadClientQueue === 'function' && typeof window.FakduDB.saveClientQueue === 'function') {
      return window.FakduDB;
    }
    return null;
  }

  async function loadClientOpQueue() {
    const dbApi = getClientQueueStorageApi();
    if (dbApi) {
      try { return await dbApi.loadClientQueue(); } catch (_) {}
    }
    try {
      const raw = localStorage.getItem(LS_CLIENT_OP_QUEUE);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  async function saveClientOpQueue(queue) {
    const safeQueue = Array.isArray(queue) ? queue : [];
    const dbApi = getClientQueueStorageApi();
    if (dbApi) {
      try {
        await dbApi.saveClientQueue(safeQueue);
        return;
      } catch (_) {}
    }
    localStorage.setItem(LS_CLIENT_OP_QUEUE, JSON.stringify(safeQueue));
  }

  async function enqueueClientOp(action) {
    const queue = await loadClientOpQueue();
    queue.push(action);
    await saveClientOpQueue(queue);
    return queue.length;
  }

  async function removeQueuedClientOp(opId = '') {
    if (!opId) return;
    const queue = await loadClientOpQueue();
    const next = queue.filter((row) => String(row?.opId || '') !== String(opId));
    await saveClientOpQueue(next);
  }

  async function clearClientOpQueue() {
    await saveClientOpQueue([]);
  }

  async function getClientQueueLength() {
    const queue = await loadClientOpQueue();
    return queue.length;
  }

  async function flushClientOpQueue() {
    if (!IS_CLIENT_NODE || !isClientSessionValid() || !navigator.onLine) return;
    const queue = await loadClientOpQueue();
    if (!queue.length) return;
    for (const action of queue) {
      try {
        emitSyncMessage({ type: 'CLIENT_ACTION', action });
      } catch (_) {
        break;
      }
    }
  }

  async function invalidateClientSession(reason = '') {
    localStorage.setItem('FAKDU_CLIENT_APPROVED', 'false');
    await persistClientSession(null);
    localStorage.removeItem('FAKDU_PENDING_CLIENT_PIN');
    localStorage.removeItem(LS_FORCE_CLIENT_MODE);
    await clearClientOpQueue();
    state.db.sync.clientSession = null;
    saveDb({ render: true, sync: false });
    if (reason) showToast(reason, 'error');
  }

  function broadcastClientAccessRequest() {
    if (!IS_CLIENT_NODE) return;
    const pendingPin = localStorage.getItem('FAKDU_PENDING_CLIENT_PIN') || '';
    const pendingShopId = localStorage.getItem('FAKDU_PENDING_MASTER_SHOP_ID') || '';
    if (!pendingPin || !pendingShopId) return;
    const profile = getClientProfile();
    try {
      emitSyncMessage({
        type: 'CLIENT_ACCESS_REQUEST',
        client: {
          clientId: profile.clientId,
          profileName: profile.profileName,
          avatar: profile.avatar,
          pin: pendingPin,
          shopId: pendingShopId,
          syncVersion: getPendingSyncVersion()
        }
      });
      const api = resolveFirebaseSyncApi();
      if (api) {
        api.writeJoinRequest(pendingShopId, {
          clientId: profile.clientId,
          profileName: profile.profileName,
          avatar: profile.avatar,
          pin: pendingPin,
          shopId: pendingShopId,
          syncVersion: getPendingSyncVersion()
        }).catch(() => {});
      }
    } catch (_) {}
  }

  async function broadcastClientHeartbeat() {
    if (!IS_CLIENT_NODE) return;
    const session = getStoredClientSession();
    if (!session?.clientSessionToken) return;
    const profile = getClientProfile();
    const pendingOps = await getClientQueueLength();
    try {
      emitSyncMessage({
        type: 'CLIENT_HEARTBEAT',
        client: {
          clientId: profile.clientId,
          profileName: profile.profileName,
          avatar: profile.avatar,
          clientSessionToken: session.clientSessionToken,
          pendingOps,
          syncVersion: Number(session.syncVersion || 1),
          lastSyncAt: Date.now()
        }
      });
    } catch (_) {}
  }

  function handleClientHeartbeat(client) {
    if (!client?.clientId || !client?.clientSessionToken) return;
    let target = state.db.sync.clients.find((row) => row.clientId === client.clientId);
    if (!target || !target.approved) return;
    if (target.clientSessionToken !== client.clientSessionToken) return;
    if (Number(target.sessionSyncVersion || 0) !== Number(state.db.sync.syncVersion || 1)) return;
    target.name = client.profileName || client.name || target.name;
    target.profileName = target.name;
    target.avatar = client.avatar || target.avatar;
    target.lastSeen = Date.now();
    target.lastSyncAt = client.lastSyncAt || target.lastSyncAt;
    target.pendingOps = Number(client.pendingOps || 0);
    renderOnlineClientsUi();
    renderClientApprovalList();
  }

  function handleClientAccessRequest(client) {
    if (!client?.clientId) return;
    if (String(client.pin || '') !== String(state.db.sync.currentSyncPin || '')) return;
    if (String(client.shopId || '') !== String(state.db.shopId || '')) return;
    if (Number(client.syncVersion || 0) !== Number(state.db.sync.syncVersion || 1)) return;
    if (!state.isPro && state.db.sync.clients.filter((row) => row.approved).length >= TRIAL_LIMITS.onlineClientMax) {
      return;
    }
    const exists = state.db.sync.approvals.find((row) => row.clientId === client.clientId);
    if (exists) {
      exists.requestedAt = Date.now();
      exists.profileName = client.profileName || exists.profileName || exists.name;
      exists.name = exists.profileName;
      exists.syncVersion = Number(client.syncVersion || exists.syncVersion || 1);
    } else {
      state.db.sync.approvals.unshift({
        clientId: client.clientId,
        profileName: client.profileName || client.name || `Client ${state.db.sync.approvals.length + 1}`,
        name: client.profileName || client.name || `Client ${state.db.sync.approvals.length + 1}`,
        avatar: client.avatar || '',
        pin: client.pin || '',
        syncVersion: Number(client.syncVersion || 1),
        requestedAt: Date.now()
      });
    }
    renderClientApprovalList();
    showToast('มีคำขอเครื่องลูกใหม่', 'click');
  }

  function handleClientAction(action) {
    if (!action?.type) return;
    if (String(action.shopId || '') !== String(state.db.shopId || '')) return;
    const client = state.db.sync.clients.find((row) => row.clientId === action.clientId);
    if (!client || !client.approved) return;
    if (String(client.clientSessionToken || '') !== String(action.clientSessionToken || '')) return;
    if (Number(client.sessionSyncVersion || 0) !== Number(state.db.sync.syncVersion || 1)) return;
    if (action.type === 'REQUEST_CHECKOUT') {
      const unit = state.db.units.find((row) => row.id === Number(action.unitId));
      if (!unit) return;
      unit.checkoutRequested = true;
      unit.checkoutRequestedAt = Date.now();
      unit.lastActivityAt = Date.now();
      logOperation('CLIENT_REQUEST_CHECKOUT', action);
      saveDb({ render: true, sync: false });
      try {
        emitSyncMessage({
          type: 'MASTER_ACTION_ACK',
          payload: {
            clientId: action.clientId,
            clientSessionToken: action.clientSessionToken,
            opId: action.opId || '',
            syncVersion: Number(state.db.sync.syncVersion || 1)
          }
        });
      } catch (_) {}
      return;
    }
    if (action.type === 'APPEND_ORDER') {
      const unit = state.db.units.find((row) => row.id === Number(action.unitId));
      if (!unit || !Array.isArray(action.items) || !action.items.length) return;
      if (!unit.startTime) unit.startTime = Date.now();
      unit.status = 'active';
      unit.lastActivityAt = Date.now();
      action.items.forEach((row) => {
        unit.orders.push({
          id: row.id || `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          itemId: row.itemId || null,
          baseName: row.baseName || row.name,
          name: row.name,
          qty: Number(row.qty || 1),
          price: Number(row.price || 0),
          total: Number(row.total || 0),
          addons: Array.isArray(row.addons) ? row.addons : [],
          source: 'client',
          orderBy: action.profileName || action.clientName || action.clientId || 'Client',
          createdAt: row.createdAt || Date.now()
        });
        unit.newItemsQty += Number(row.qty || 0);
      });
      logOperation('CLIENT_APPEND_ORDER', action);
      saveDb({ render: true, sync: false });
      try {
        emitSyncMessage({
          type: 'MASTER_ACTION_ACK',
          payload: {
            clientId: action.clientId,
            clientSessionToken: action.clientSessionToken,
            opId: action.opId || '',
            syncVersion: Number(state.db.sync.syncVersion || 1)
          }
        });
      } catch (_) {}
    }
  }

  function handleClientSyncAck(payload) {
    if (!payload?.clientId) return;
    const client = state.db.sync.clients.find((row) => row.clientId === payload.clientId);
    if (!client) return;
    client.lastSyncAt = Date.now();
    client.pendingOps = Number(payload.pendingOps || 0);
    renderOnlineClientsUi();
  }

  function handleMasterActionAck(payload) {
    if (!IS_CLIENT_NODE || !payload?.clientId || !payload?.opId) return;
    const session = getStoredClientSession();
    if (!session?.clientId || payload.clientId !== session.clientId) return;
    if (String(payload.clientSessionToken || '') !== String(session.clientSessionToken || '')) return;
    removeQueuedClientOp(payload.opId);
  }

  function handleMasterSyncRotated(payload) {
    if (!IS_CLIENT_NODE || !payload?.shopId) return;
    const session = getStoredClientSession();
    if (!session?.shopId || session.shopId !== payload.shopId) return;
    if (Number(session.syncVersion || 0) < Number(payload.syncVersion || 0)) {
      invalidateClientSession('รหัสเชื่อมต่อถูกเปลี่ยน กรุณาเชื่อมต่อใหม่');
    }
  }

  function renderClientApprovalList() {
    const box = qs('client-approval-list');
    const count = qs('client-approval-count');
    if (count) count.textContent = `${state.db.sync.approvals.length} รายการ`;
    if (!box) return;
    if (!state.db.sync.approvals.length) {
      box.innerHTML = '<div class="bg-gray-50 rounded-2xl border p-4 text-[11px] text-gray-400 font-bold">ยังไม่มีคำขอเข้าเครื่องลูก</div>';
      return;
    }
    box.innerHTML = state.db.sync.approvals.map((item) => `
      <div class="bg-white rounded-2xl border p-4 shadow-sm flex items-center gap-3">
        <div class="w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
          ${item.avatar ? `<img src="${item.avatar}" class="w-full h-full object-cover">` : `<span class="font-black text-gray-600">${escapeHtml((item.name || 'C').slice(0, 1).toUpperCase())}</span>`}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-black text-gray-800 truncate">${escapeHtml(item.profileName || item.name || item.clientId)}</div>
          <div class="text-[10px] text-gray-400 font-bold">PIN ${escapeHtml(item.pin || '-')} • ${thaiDate(item.requestedAt)}</div>
        </div>
        <div class="flex gap-2 shrink-0">
          <button onclick="approveClient('${item.clientId}')" class="px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-black">อนุมัติ</button>
          <button onclick="rejectClient('${item.clientId}')" class="px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 text-xs font-black">ปฏิเสธ</button>
        </div>
      </div>
    `).join('');
  }

  function approveClient(clientId) {
    if (!state.isPro && state.db.sync.clients.filter((row) => row.approved).length >= TRIAL_LIMITS.onlineClientMax) {
      showToast(`รุ่นทดลองจำกัดเครื่องลูก ${TRIAL_LIMITS.onlineClientMax} เครื่อง`, 'error');
      return;
    }
    const approval = state.db.sync.approvals.find((row) => row.clientId === clientId);
    if (!approval) return;
    if (Number(approval.syncVersion || 0) !== Number(state.db.sync.syncVersion || 1)) {
      state.db.sync.approvals = state.db.sync.approvals.filter((row) => row.clientId !== clientId);
      renderClientApprovalList();
      showToast('คำขอนี้หมดอายุแล้ว (syncVersion ไม่ตรง)', 'error');
      saveDb({ render: false, sync: false });
      return;
    }
    let client = state.db.sync.clients.find((row) => row.clientId === clientId);
    if (!client) {
      const clientSessionToken = issueClientSessionToken({ shopId: state.db.shopId, clientId, syncVersion: state.db.sync.syncVersion });
      client = {
        clientId,
        profileName: approval.profileName || approval.name,
        name: approval.profileName || approval.name,
        avatar: approval.avatar,
        approved: true,
        clientSessionToken,
        sessionSyncVersion: Number(state.db.sync.syncVersion || 1),
        lastSeen: Date.now(),
        lastSyncAt: null,
        pendingOps: 0
      };
      state.db.sync.clients.push(client);
    } else {
      client.approved = true;
      client.profileName = approval.profileName || approval.name || client.profileName || client.name;
      client.name = client.profileName;
      client.avatar = approval.avatar || client.avatar;
      client.clientSessionToken = issueClientSessionToken({ shopId: state.db.shopId, clientId, syncVersion: state.db.sync.syncVersion });
      client.sessionSyncVersion = Number(state.db.sync.syncVersion || 1);
      client.lastSeen = Date.now();
    }
    state.db.sync.approvedClients = state.db.sync.clients.filter((row) => row.approved).map((row) => ({
      clientId: row.clientId,
      profileName: row.profileName || row.name || row.clientId,
      sessionSyncVersion: row.sessionSyncVersion
    }));
    const api = resolveFirebaseSyncApi();
    if (api && state.db.shopId) {
      api.upsertClient(state.db.shopId, {
        clientId: client.clientId,
        profileName: client.profileName || client.name || client.clientId,
        avatar: client.avatar || '',
        approved: true,
        clientSessionToken: client.clientSessionToken,
        sessionSyncVersion: Number(client.sessionSyncVersion || state.db.sync.syncVersion || 1),
        approvedAt: Date.now(),
        approvedBy: state.hwid || state.db.sync.masterDeviceId || 'MASTER'
      }).catch(() => {});
    }
    state.db.sync.approvals = state.db.sync.approvals.filter((row) => row.clientId !== clientId);
    logOperation('APPROVE_CLIENT', { clientId });
    try {
      emitSyncMessage({
        type: 'MASTER_APPROVAL',
        payload: {
          clientId,
          approved: true,
          syncKey: state.db.sync.currentSyncPin,
          shopId: state.db.shopId,
          syncVersion: state.db.sync.syncVersion,
          clientSessionToken: client.clientSessionToken,
          profileName: client.profileName || client.name || clientId
        }
      });
    } catch (_) {}
    renderClientApprovalList();
    renderOnlineClientsUi();
    saveDb({ render: false, sync: true });
    showToast('อนุมัติเครื่องลูกแล้ว', 'success');
  }

  function rejectClient(clientId) {
    state.db.sync.approvals = state.db.sync.approvals.filter((row) => row.clientId !== clientId);
    logOperation('REJECT_CLIENT', { clientId });
    const api = resolveFirebaseSyncApi();
    if (api && state.db.shopId) {
      api.upsertClient(state.db.shopId, {
        clientId,
        approved: false,
        rejectedAt: Date.now(),
        rejectedBy: state.hwid || state.db.sync.masterDeviceId || 'MASTER'
      }).catch(() => {});
    }
    try {
      emitSyncMessage({ type: 'MASTER_APPROVAL', payload: { clientId, approved: false, shopId: state.db.shopId } });
    } catch (_) {}
    renderClientApprovalList();
    saveDb({ render: false, sync: false });
    showToast('ปฏิเสธคำขอแล้ว', 'click');
  }

  function updateSyncUi() {
    if (qs('display-sync-key')) qs('display-sync-key').textContent = state.db.sync.currentSyncPin || '------';
    const qrArea = qs('sync-qr-area');
    if (qrArea) {
      qrArea.innerHTML = '';
      if (typeof QRCode === 'function') {
        new QRCode(qrArea, {
          text: JSON.stringify({
            shopId: state.db.shopId,
            pin: state.db.sync.currentSyncPin,
            shopName: state.db.shopName,
            syncVersion: Number(state.db.sync.syncVersion || 1),
            version: APP_VERSION
          }),
          width: 72,
          height: 72
        });
      } else {
        qrArea.textContent = state.db.sync.currentSyncPin || 'PIN';
      }
    }
    renderOnlineClientsUi();
  }

  function setSyncButtonState(mode) {
    const btn = qs('btn-manual-sync');
    if (!btn) return;
    btn.classList.remove('animate-pulse', 'bg-white', 'text-blue-600', 'bg-green-500', 'bg-red-500', 'text-white', 'bg-amber-400', 'text-amber-900');
    if (mode === 'loading') {
      btn.classList.add('animate-pulse', 'bg-amber-400', 'text-amber-900');
      return;
    }
    if (mode === 'success') {
      btn.classList.add('bg-green-500', 'text-white');
      return;
    }
    if (mode === 'error') {
      btn.classList.add('bg-red-500', 'text-white');
      return;
    }
    btn.classList.add('bg-white', 'text-blue-600');
  }

  function updateSyncCheckStatusUi() {
    const text = qs('sync-check-status-text');
    const hint = qs('sync-check-status-hint');
    if (text) text.textContent = state.db.sync.lastCheck.text || 'ยังไม่ได้ตรวจ';
    if (hint) hint.textContent = state.db.sync.lastCheck.hint || '';
  }

  function triggerSyncCheck() {
    const onlineClients = state.db.sync.clients.filter((client) => client.approved && getClientStatus(client) === 'online');
    setSyncButtonState('loading');
    state.db.sync.lastCheck = {
      status: 'loading',
      text: 'กำลังตรวจความตรงกัน...',
      hint: 'กำลังเช็คสถานะเครื่องลูกและรายการค้างส่ง',
      at: Date.now()
    };
    updateSyncCheckStatusUi();

    clearTimeout(state.syncButtonResetTimer);
    setTimeout(() => {
      if (!onlineClients.length) {
        state.db.sync.lastCheck = {
          status: 'error',
          text: 'ยังยืนยัน Sync จริงไม่ได้',
          hint: 'ยังไม่มีเครื่องลูกออนไลน์ ให้เชื่อมต่อเครื่องลูกก่อนแล้วค่อยเช็คอีกครั้ง',
          at: Date.now()
        };
        setSyncButtonState('error');
        updateSyncCheckStatusUi();
        state.syncButtonResetTimer = setTimeout(() => setSyncButtonState('idle'), 10000);
        saveDb({ render: false, sync: false });
        return;
      }
      const hasPendingCart = Object.values(state.db.carts).some((cart) => Array.isArray(cart) && cart.length > 0);
      const hasRed = onlineClients.some((client) => Number(client.pendingOps || 0) > 0);
      const ok = !hasRed && !hasPendingCart;
      if (ok) {
        state.db.sync.lastCheck = {
          status: 'success',
          text: 'ข้อมูลตรงกันแล้ว',
          hint: `ตรวจแล้ว ${onlineClients.length} เครื่อง`,
          at: Date.now()
        };
        setSyncButtonState('success');
      } else {
        state.db.sync.lastCheck = {
          status: 'error',
          text: 'พบข้อมูลยังไม่ตรงกัน',
          hint: 'ให้ร้านตรวจสอบเครื่องลูกหรือรายการที่ยังค้างด้วยตนเอง',
          at: Date.now()
        };
        setSyncButtonState('error');
      }
      updateSyncCheckStatusUi();
      state.syncButtonResetTimer = setTimeout(() => setSyncButtonState('idle'), 10000);
      saveDb({ render: false, sync: false });
    }, 1300);
  }

  function requestNewSyncKey() {

    openModal('modal-sync-key-confirm');
  }

  function confirmNewSyncKey() {
    closeModal('modal-sync-key-confirm');

    const today = getLocalYYYYMMDD();
    const sameDay = String(state.db.sync.keyResetDate || '') === String(today);
    const usedToday = sameDay ? Number(state.db.sync.keyResetCount || 0) : 0;
    if (usedToday >= 3) {
      showToast('ขอ PIN ได้สูงสุด 3 ครั้ง/วัน', 'error');
      return;
    }
    openModal('modal-sync-key-confirm');
  }

  function confirmNewSyncKey() {
    const today = getLocalYYYYMMDD();
    const sameDay = String(state.db.sync.keyResetDate || '') === String(today);
    const usedToday = sameDay ? Number(state.db.sync.keyResetCount || 0) : 0;
    if (usedToday >= 3) {
      closeModal('modal-sync-key-confirm');
      showToast('ครบ 3 ครั้งแล้ว', 'error');
      return;
    }
    closeModal('modal-sync-key-confirm');
    state.db.sync.keyResetDate = today;
    state.db.sync.keyResetCount = usedToday + 1;
    state.db.sync.syncVersion = Number(state.db.sync.syncVersion || 1) + 1;
    state.db.sync.currentSyncPin = generateSyncPin(state.db.shopId, state.db.sync.syncVersion);
    state.db.sync.key = state.db.sync.currentSyncPin;
    state.db.sync.approvals = [];
    state.db.sync.clients = state.db.sync.clients.map((client) => ({
      ...client,
      approved: false,
      clientSessionToken: '',
      sessionSyncVersion: Number(state.db.sync.syncVersion || 1)
    }));
    state.db.sync.approvedClients = [];
    localStorage.removeItem('FAKDU_CLIENT_SESSION');
    logOperation('RESET_SYNC_KEY', { syncVersion: state.db.sync.syncVersion });
    const api = resolveFirebaseSyncApi();
    if (api && state.db.shopId) api.clearClientSessions(state.db.shopId).catch(() => {});
    try {
      emitSyncMessage({
        type: 'MASTER_SYNC_ROTATED',
        payload: {
          shopId: state.db.shopId,
          syncVersion: Number(state.db.sync.syncVersion || 1)
        }
      });
    } catch (_) {}
    updateSyncUi();
    saveDb({ render: false, sync: true });
    syncMasterMetaToFirebase();
    showToast('สร้างรหัสใหม่แล้ว', 'success');
  }
  //* sync close

  //* scanner open
  async function openClientScanner() {
    openModal('modal-client-scanner');
    if (!window.Html5Qrcode) {
      showToast('อุปกรณ์นี้ยังใช้สแกน QR ไม่ได้', 'error');
      return;
    }
    try {
      if (state.qrScanner) await closeClientScanner(true);
      state.qrScanner = new Html5Qrcode('qr-reader-index');
      const cameras = await Html5Qrcode.getCameras().catch(() => []);
      const preferredCamera = cameras.find((cam) => /back|rear|environment/i.test(cam.label || ''))?.id || cameras[0]?.id || { facingMode: 'environment' };
      await state.qrScanner.start(
        preferredCamera,
        { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
        (decodedText) => {
          try {
            const data = JSON.parse(decodedText);
            const pin = data.pin || '';
            const shopId = data.shopId || '';
            const syncVersion = Number(data.syncVersion || 1);
            if (pin && qs('manual-pin')) qs('manual-pin').value = pin;
            if (shopId) localStorage.setItem('FAKDU_PENDING_MASTER_SHOP_ID', shopId);
            if (syncVersion > 0) localStorage.setItem(LS_PENDING_SYNC_VERSION, String(syncVersion));
          } catch (_) {
            if (qs('manual-pin')) qs('manual-pin').value = decodedText;
          }
          closeClientScanner();
          showToast('สแกนสำเร็จ', 'success');
        }
      );
    } catch (error) {
      console.error(error);
      showToast('เปิดกล้องไม่ได้', 'error');
    }
  }

  async function closeClientScanner(keepModal = false) {
    try {
      if (state.qrScanner) {
        if (state.qrScanner.isScanning) await state.qrScanner.stop().catch(() => {});
        await state.qrScanner.clear().catch(() => {});
      }
    } finally {
      state.qrScanner = null;
      if (!keepModal) closeModal('modal-client-scanner');
    }
  }

  async function submitClientAccessRequest() {
    const pin = qs('manual-pin')?.value?.trim() || '';
    if (!pin) return showToast('กรุณากรอก PIN', 'error');
    const pendingShopId = getPendingMasterShopId();
    if (!pendingShopId) {
      return showToast('กรุณาสแกน QR จากเครื่องแม่ก่อน (ต้องมีรหัสร้าน)', 'error');
    }
    const api = resolveFirebaseSyncApi();
    if (api) {
      try {
        const meta = await api.readSyncMeta(pendingShopId);
        const serverPin = String(meta?.currentSyncPin || '');
        const serverVersion = Number(meta?.syncVersion || 0);
        if (!serverPin || pin !== serverPin) {
          showToast('PIN ไม่ถูกต้อง', 'error');
          return;
        }
        if (serverVersion > 0) localStorage.setItem(LS_PENDING_SYNC_VERSION, String(serverVersion));
      } catch (error) {
        console.warn('PIN verification fallback to local channel', error);
      }
    }
    localStorage.setItem('FAKDU_PENDING_CLIENT_PIN', pin);
    localStorage.setItem('FAKDU_PENDING_MASTER_SHOP_ID', pendingShopId);
    localStorage.setItem(LS_FORCE_CLIENT_MODE, 'true');
    window.location.href = 'client.html';
  }
  //* scanner close

  //* client profile open
  function handleClientImage(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (file.size > CLIENT_AVATAR_MAX_BYTES) {
      showToast('รูปใหญ่เกินไป (ไม่เกิน 1.5MB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      localStorage.setItem('FAKDU_CLIENT_AVATAR', data);
      if (qs('client-avatar')) qs('client-avatar').src = data;
      if (isClientSessionValid()) broadcastClientHeartbeat();
      else broadcastClientAccessRequest();
      showToast('อัปเดตรูปเครื่องลูกแล้ว', 'success');
    };
    reader.readAsDataURL(file);
  }

  function saveClientSettings() {
    const name = (qs('sys-client-name')?.value || '').trim();
    if (!name) return showToast('กรอกชื่อโปรไฟล์ก่อน', 'error');
    localStorage.setItem('FAKDU_CLIENT_PROFILE_NAME', name);
    if (qs('client-device-name')) qs('client-device-name').textContent = name;
    if (isClientSessionValid()) broadcastClientHeartbeat();
    else broadcastClientAccessRequest();
    showToast('บันทึกโปรไฟล์แล้ว', 'success');
  }

  async function clientLogout() {
    await persistClientSession(null);
    localStorage.removeItem('FAKDU_CLIENT_APPROVED');
    localStorage.removeItem('FAKDU_PENDING_CLIENT_PIN');
    localStorage.removeItem('FAKDU_PENDING_MASTER_SHOP_ID');
    localStorage.removeItem(LS_PENDING_SYNC_VERSION);
    localStorage.removeItem(LS_FORCE_CLIENT_MODE);
    await clearClientOpQueue();
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('fakdu-')).map((key) => caches.delete(key)));
      }
    } catch (_) {}
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
    } catch (_) {}
    window.location.href = 'index.html';
  }
  //* client profile close

  //* install open
  function installPWA() {
    if (!state.deferredInstallPrompt) {
      showToast('ยังติดตั้งไม่ได้ในตอนนี้', 'error');
      return;
    }
    state.deferredInstallPrompt.prompt();
    state.deferredInstallPrompt.userChoice.finally(() => {
      state.deferredInstallPrompt = null;
      qs('pwa-install-banner')?.classList.add('hidden');
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    qs('pwa-install-banner')?.classList.remove('hidden');
  });
  //* install close

  //* timers open
  function startLiveTimers() {
    clearInterval(state.liveTick);
    state.liveTick = setInterval(() => {
      document.querySelectorAll('.admin-timer').forEach((el) => {
        const start = Number(el.getAttribute('data-start') || 0);
        if (start) el.textContent = formatDurationFrom(start);
      });
      const active = state.db.units.find((unit) => unit.id === Number(state.activeUnitId));
      if (state.activeTab === 'order' && active && qs('active-unit-time')) {
        qs('active-unit-time').textContent = active.startTime ? `ใช้งานมาแล้ว ${formatDurationFrom(active.startTime)}` : 'ยังไม่เริ่มจับเวลา';
      }
      if (!qs('modal-checkout')?.classList.contains('hidden') && active && qs('checkout-live-time')) {
        qs('checkout-live-time').textContent = `เวลาใช้งาน: ${formatDurationFrom(active.startTime)}`;
      }
      renderOnlineClientsUi();
      if (IS_CLIENT_NODE) {
        const tick = Date.now();
        if ((tick - state.lastClientHeartbeatAt) >= HEARTBEAT_INTERVAL_MS) {
          if (isClientSessionValid()) {
            broadcastClientHeartbeat();
            flushClientOpQueue();
          }
          else broadcastClientAccessRequest();
          state.lastClientHeartbeatAt = tick;
        }
      }
    }, 1000);
  }
  //* timers close

  //* render open
  function renderAll() {
    applyTheme();
    applyTrialUiGuards();
    updateMasterConnectionUi();
    renderOnlineClientsUi();
    renderCustomerGrid();
    renderShopQueue();
    renderAnalytics();
    renderAdminLists();
    renderSystemPanels();
    updateCartTotal();
    if (qs('display-hwid')) qs('display-hwid').textContent = state.db.shopName || 'FAKDU';
  }
  //* render close

  //* init open
  async function init() {
    try {
      if (!IS_CLIENT_NODE && localStorage.getItem(LS_FORCE_CLIENT_MODE) === 'true') {
        const lastSession = getStoredClientSession();
        if (lastSession?.clientSessionToken) {
          window.location.replace('client.html');
          return;
        }
      }
      state.hwid = await resolveDbApi().getDeviceId();
      await hydrateClientSessionFromDb();
      const raw = await resolveDbApi().load();
      state.db = normalizeDb(raw);
      if (!state.db.shopId) state.db.shopId = makeShopId();
      if (!state.db.sync.masterDeviceId) state.db.sync.masterDeviceId = state.hwid;
      if (!state.db.sync.currentSyncPin) state.db.sync.currentSyncPin = generateSyncPin(state.db.shopId, state.db.sync.syncVersion || 1);
      state.db.sync.key = state.db.sync.currentSyncPin;
      await syncProStatus();
      applyTrialUiGuards();
      await bindSyncChannel();
      startSyncPollingFallback();
      loadSettingsToForm();
      applyTheme();
      updateSyncUi();
      updateMasterConnectionUi();
      syncCustomSearchUiMode();
      renderAll();
      if (IS_CLIENT_NODE) {
        const profile = getClientProfile();
        if (qs('sys-client-name')) qs('sys-client-name').value = profile.profileName;
        if (qs('client-device-name')) qs('client-device-name').textContent = profile.profileName;
        if (qs('client-avatar') && profile.avatar) qs('client-avatar').src = profile.avatar;

        const session = getStoredClientSession();
        state.db.sync.clientSession = session ? {
          shopId: session.shopId || '',
          clientId: session.clientId || profile.clientId,
          clientSessionToken: session.clientSessionToken || '',
          syncVersion: Number(session.syncVersion || state.db.sync.syncVersion || 1)
        } : null;
        if (isClientSessionValid()) {
          const api = resolveFirebaseSyncApi();
          if (api && state.db.shopId) {
            try {
              const meta = await api.readSyncMeta(state.db.shopId);
              const sessionNow = getStoredClientSession();
              const expected = sessionNow?.clientId ? meta?.clientSessions?.[sessionNow.clientId] : null;
              const versionMismatch = Number(sessionNow?.syncVersion || 0) !== Number(meta?.syncVersion || 0);
              const tokenMismatch = !expected || String(expected.clientSessionToken || '') !== String(sessionNow?.clientSessionToken || '');
              if (!sessionNow || versionMismatch || tokenMismatch) {
                await invalidateClientSession('session หมดอายุ กรุณาเชื่อมใหม่');
              }
            } catch (_) {}
          }
        }
        if (!isClientSessionValid()) {
          state.db.items = [];
          state.db.units = [];
          state.db.unitCount = 0;
        }
      }
      const today = getLocalYYYYMMDD();
      if (qs('search-start')) qs('search-start').value = today;
      if (qs('search-end')) qs('search-end').value = today;
      renderAnalytics();
      startLiveTimers();
      switchTab('customer', qs('tab-customer'));
      if (!IS_CLIENT_NODE || isClientSessionValid()) {
        showToast('FAKDU พร้อมใช้งาน', 'success');
      }
    } catch (error) {
      console.error(error);
      showToast('โหลดระบบไม่สำเร็จ', 'error');
    }
  }
  //* init close

  //* events open
  window.addEventListener('online', () => {
    updateMasterConnectionUi();
    if (IS_CLIENT_NODE) flushClientOpQueue();
  });
  window.addEventListener('offline', updateMasterConnectionUi);
  window.addEventListener('storage', (event) => {
    if (!IS_CLIENT_NODE || !event.key || !event.newValue) return;
    if (!event.key.startsWith(LS_SNAPSHOT_PREFIX)) return;
    try {
      applyMasterSnapshot(JSON.parse(event.newValue));
    } catch (_) {}
  });
  document.addEventListener('DOMContentLoaded', init);
  //* events close

  //* expose open
  Object.assign(window, {
    closeModal,
    openModal,
    installPWA,
    switchTab,
    attemptAdmin,
    verifyAdminPin,
    adminLogout,
    changeGridZoom,
    toggleCustomerGridCollapse,
    toggleShopQueueCollapse,
    openTable,
    handleItemClickByIndex,
    reviewCart,
    openReviewCartModal,
    editCartItem,
    confirmOrderSend,
    openCheckout,
    deleteOrderItem,
    confirmPayment,
    switchManageSub,
    switchDashTab,
    calculateCustomSalesRealtime,
    clearSales,
    openMenuModal,
    editItem,
    addAddonField,
    removeAddonField,
    updateAddonField,
    saveMenuItem,
    deleteItem,
    updateUnits,
    saveSystemSettings,
    handleImage,
    exportBackup,
    importBackup,
    openRecoveryModal: () => {
      if (!state.isPro) {
        showToast('รุ่นทดลองยังไม่รองรับลืมรหัส Admin', 'error');
        return;
      }
      closeModal('modal-admin-pin');
      openModal('modal-recovery');
    },
    saveRecoveryData,
    executeRecovery,
    validateProKey,
    handleLockedFeatureClick,
    triggerSyncCheck,
    requestNewSyncKey,
    confirmNewSyncKey,
    openClientScanner,
    closeClientScanner,
    submitClientAccessRequest,
    submitClientAccess: submitClientAccessRequest,
    handleClientImage,
    saveClientSettings,
    clientLogout,
    adjustAddonQty,
    confirmAddonSelection,
    approveClient,
    rejectClient,
    markCheckoutRequest
  });
  //* expose close
})();
