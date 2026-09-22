/**
 * puffsn0w — Standalone Web Bluetooth BLE Driver for Puffco Devices
 * Directly communicates with Puffco Peak Pro and Proxy over Web Bluetooth (GATT).
 * Re-implements Lorax protocol, SHA-256 challenge-response handshake,
 * and VFS binary serialization in pure client-side JavaScript.
 */

// GATT Service & Characteristic UUIDs
const PUFFCO_LORAX_SVC_UUID = 'e276967f-ea8a-478a-a92e-d78f5dd15dd5';
const PUFFCO_PIKACHU_SVC_UUID = '06caf9c0-74d3-454f-9be9-e30cd999c17a';
const PUFFCO_PUP_SVC_UUID = '420b9b40-457d-4abe-a3bf-71609d79581b';
const PUFFCO_SILABS_OTA_SVC_UUID = '1d14d6ee-fd63-4fa1-bfa4-8f47b42119f0';
const PUFFCO_MANUFACTURER_ID = 3075; // 0x0C03 Puffco company identifier

const PUFFCO_LORAX_CHAR_CMD = '60133d5c-5727-4f2c-9697-d842c5292a3c';
const PUFFCO_LORAX_CHAR_REPLY = '8dc5ec05-8f7d-45ad-99db-3fbde65dbd9c';
const PUFFCO_LORAX_CHAR_VERSION = '05434bca-cc7f-4ef6-bbb3-b1c520b9800c';

const DEVINFO_SVC_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const DEVINFO_FIRMWARE_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
const DEVINFO_SERIAL_UUID = '00002a25-0000-1000-8000-00805f9b34fb';
const DEVINFO_MODEL_NUMBER_UUID = '00002a24-0000-1000-8000-00805f9b34fb';

// Lorax Master Handshake Key (Secret Constant)
const LORAX_MASTER_HANDSHAKE_KEY = new Uint8Array([
  0x64, 0xc6, 0x45, 0x62, 0x56, 0xf2, 0x6f, 0x5b,
  0x1c, 0xa1, 0x27, 0x37, 0xa5, 0xdd, 0x71, 0xfb,
]);

// Lorax Opcodes
const LORAX_OP_GET_ACCESS_SEED = 0;
const LORAX_OP_UNLOCK_ACCESS = 1;
const LORAX_OP_GET_LIMITS = 2;
const LORAX_OP_READ_SHORT = 16;
const LORAX_OP_WRITE_SHORT = 17;
const LORAX_OP_READ = 32;
const LORAX_OP_WRITE = 33;
const LORAX_OP_WATCH = 48;
const LORAX_OP_UNWATCH = 49;

// VFS Paths
const PATH_MODE_CONTROL = '/p/app/mc';
const PATH_STATE_ID = '/p/app/stat/id';
const PATH_CHAMBER_TEMP = '/p/app/htr/temp';
const PATH_TARGET_TEMP = '/p/app/htr/ttag';
const PATH_TIME_ELAPSED = '/p/app/stat/elap';
const PATH_TIME_TOTAL = '/p/app/stat/tott';
const PATH_BATTERY_SOC = '/p/bat/soc';
const PATH_BATTERY_CHARGE_STAT = '/p/bat/chg/stat';
const PATH_CHAMBER_TYPE = '/p/htr/chmt';
const PATH_ODOMETER_DABS = '/p/app/odom/0/nc';
const PATH_DEVICE_NAME = '/u/sys/name';
const PATH_STEALTH_MODE = '/u/app/ui/stlm';
const PATH_LANTERN_CMD = '/p/app/ltrn/cmd';
const PATH_LANTERN_COLOR = '/p/app/ltrn/colr';
const PATH_LANTERN_TIME = '/p/app/ltrn/time';
const PATH_LANTERN_BRIGHTNESS = '/u/app/ui/lbrt';
const PATH_ACTIVE_PROFILE = '/p/app/hcs';
const PATH_PROFILE_TEMP_PREFIX = '/u/app/hc/{slot}/temp';
const PATH_PROFILE_TIME_PREFIX = '/u/app/hc/{slot}/time';

// Hardware Lantern Animation Modes (Lorax VFS)
const LanternMode = {
  PRESERVE: 0x00,
  STATIC: 0x01,
  BREATHING: 0x05,
  RISING: 0x06,
  CIRCLING: 0x07,
  CIRCLING_SLOW: 0x15,
};
const PATH_PROFILE_NAME_PREFIX = '/u/app/hc/{slot}/name';

// Hardware Operating States (aligned 1:1 with puffco_py / Lorax firmware)
const OperatingState = {
  DISCONNECTED: 0,
  OFF: 1,
  BOOTING: 2,
  SLEEP: 3,
  IDLE: 5,
  TEMP_SELECT: 6,
  HEAT_PREHEAT: 7,
  HEAT_ACTIVE: 8,
  HEAT_FADE: 9,
  READY: 10,
  COOLDOWN: 11,
  ERROR: 12,
  SHUTDOWN: 13,
};

const OperatingStateNames = {
  0: 'DISCONNECTED',
  1: 'OFF',
  2: 'BOOTING',
  3: 'SLEEP',
  5: 'IDLE',
  6: 'TEMP_SELECT',
  7: 'HEAT_PREHEAT',
  8: 'HEAT_ACTIVE',
  9: 'HEAT_FADE',
  10: 'READY',
  11: 'COOLDOWN',
  12: 'ERROR',
  13: 'SHUTDOWN',
};

const OperatingStateDisplayNames = {
  DISCONNECTED: 'Disconnected',
  OFF: 'Device Off',
  BOOTING: 'Booting',
  SLEEP: 'Sleep Mode',
  IDLE: 'Standby / Idle',
  TEMP_SELECT: 'Selecting Profile',
  HEAT_PREHEAT: 'Preheating',
  HEAT_ACTIVE: 'Heating / Active',
  HEAT_FADE: 'Heat Fading',
  READY: 'Ready to Inhale',
  COOLDOWN: 'Cooling Down',
  ERROR: 'Device Error',
  SHUTDOWN: 'Shutting Down',
};

const ChamberNames = {
  0: 'None',
  1: 'Standard',
  2: '3D Chamber',
  3: '3DXL',
  4: 'Proxy',
};

// ==========================================================================
// Helper Utility Functions
// ==========================================================================

function cToF(c) {
  return (c * 9.0) / 5.0 + 32.0;
}

function fToC(f) {
  return ((f - 32.0) * 5.0) / 9.0;
}

function encodeUtf8(str) {
  return new TextEncoder().encode(str);
}

function decodeUtf8(bytes) {
  // Strip trailing null characters if present
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function packLanternColor(r, g, b, mode = LanternMode.STATIC) {
  const m = typeof mode === 'number' ? mode : 1;
  return new Uint8Array([
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
    0,
    m & 0xff,
    0,
    0,
    0,
  ]);
}

function hsvToRgb(h, s, v) {
  let r = 0, g = 0, b = 0;
  const i = Math.floor((h / 60) % 6);
  const f = (h / 60) - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Pure JavaScript SHA-256 implementation.
 * Used as an offline / non-secure context fallback when crypto.subtle is not exposed.
 */
function pureSha256(bytes) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;

  const words = [];
  const asciiBitLength = bytes[lengthProperty] * 8;

  let hash = [];
  let k = [];
  let primeCounter = 0;

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  for (i = 0; i < bytes[lengthProperty]; i++) {
    words[i >> 2] |= bytes[i] << ((3 - (i % 4)) * 8);
  }

  const w = new Array(64);
  for (let i = 0; i < words[lengthProperty]; i += 16) {
    const oldHash = hash.slice(0);

    for (j = 0; j < 64; j++) {
      if (j < 16) {
        w[j] = words[i + j] | 0;
      } else {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }

      const s1 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = (hash[7] + s1 + ch + k[j] + w[j]) | 0;
      const s0 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (s0 + maj) | 0;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (j = 0; j < 8; j++) {
      hash[j] = (hash[j] + oldHash[j]) | 0;
    }
  }

  const out = new Uint8Array(32);
  for (i = 0; i < 8; i++) {
    out[i * 4] = (hash[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hash[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hash[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hash[i] & 0xff;
  }
  return out;
}

/**
 * Calculates SHA-256 Lorax authentication token.
 * Formula: SHA256(MasterKey + Seed[0:16])[0:16]
 */
async function calculateLoraxAuthToken(seed, masterKey = LORAX_MASTER_HANDSHAKE_KEY) {
  if (!seed || seed.length < 16) {
    throw new Error('Auth seed must be at least 16 bytes');
  }
  const combined = new Uint8Array(16 + 16);
  combined.set(masterKey, 0);
  combined.set(seed.subarray(0, 16), 16);

  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', combined);
      return new Uint8Array(hashBuffer).subarray(0, 16);
    }
  } catch (e) {
    console.warn('[PuffcoBLE] SubtleCrypto unavailable or restricted, using pure-JS SHA-256 fallback', e);
  }

  const hashBuffer = pureSha256(combined);
  return hashBuffer.subarray(0, 16);
}

/**
 * Packs a Lorax command frame.
 * Layout: [0..1] uint16 LE seq, [2] uint8 opcode, [3..] payload
 */
function packLoraxCmd(seq, opcode, payload = new Uint8Array(0)) {
  const buf = new Uint8Array(3 + payload.length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, seq & 0xffff, true);
  view.setUint8(2, opcode & 0xff);
  buf.set(payload, 3);
  return buf;
}

/**
 * Packs LORAX_OP_READ_SHORT (0x10) payload.
 * Layout: uint16 offset (0), uint16 max_len (240), utf-8 path
 */
function packLoraxReadShort(path, maxLen = 240) {
  const pathBytes = encodeUtf8(path);
  const buf = new Uint8Array(4 + pathBytes.length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, maxLen, true);
  buf.set(pathBytes, 4);
  return buf;
}

/**
 * Packs LORAX_OP_WRITE_SHORT (0x11) payload.
 * Layout: uint16 offset (0), uint8 flags (0), utf-8 path, 0x00 null delimiter, value bytes
 */
function packLoraxWriteShort(path, valBytes) {
  const pathBytes = encodeUtf8(path);
  const buf = new Uint8Array(3 + pathBytes.length + 1 + valBytes.length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 0, true);
  view.setUint8(2, 0);
  buf.set(pathBytes, 3);
  buf[3 + pathBytes.length] = 0x00;
  buf.set(valBytes, 3 + pathBytes.length + 1);
  return buf;
}

/**
 * Strict numeric sanitizers & hardware bounds enforcers
 */
function validateTemperature(tempF) {
  const num = Number(tempF);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    throw new Error(`[PuffcoBLE] Invalid temperature setpoint: ${tempF}`);
  }
  return Math.min(590.0, Math.max(350.0, Math.round(num * 10) / 10));
}

function validateDuration(durationS) {
  const num = Number(durationS);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    throw new Error(`[PuffcoBLE] Invalid duration: ${durationS}`);
  }
  return Math.min(120, Math.max(15, Math.round(num)));
}

/**
 * Temperature byte parser.
 * Handles IEEE 754 32-bit floats (Peak Pro) and integer tenths of °C (Proxy).
 */
function parseTempBytes(bytes) {
  if (!bytes || bytes.length < 4) return 0.0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 1. Check IEEE 754 float32
  try {
    const fVal = view.getFloat32(0, true);
    if (fVal >= 5.0 && fVal <= 450.0 && !isNaN(fVal) && isFinite(fVal)) {
      return Math.round(cToF(fVal) * 10) / 10;
    }
  } catch (e) {}

  // 2. Check 32-bit integer (tenths of °C e.g. 2650 = 265.0°C)
  try {
    const iVal = view.getInt32(0, true);
    if (iVal >= 50 && iVal <= 4500) {
      return Math.round(cToF(iVal / 10.0) * 10) / 10;
    }
    if (iVal >= 5 && iVal <= 450) {
      return Math.round(cToF(iVal) * 10) / 10;
    }
  } catch (e) {}

  return 0.0;
}

function parseBatteryBytes(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  if (bytes.length === 1) {
    return Math.max(0, Math.min(100, bytes[0]));
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length === 2) {
    const iVal = view.getUint16(0, true);
    if (iVal <= 100) return iVal;
    if (iVal > 100 && iVal <= 10000) return Math.round(iVal / 100.0);
  }
  if (bytes.length >= 4) {
    const iVal = view.getUint32(0, true);
    if (iVal <= 100) return iVal;
    if (iVal > 100 && iVal <= 10000) return Math.round(iVal / 100.0);
    try {
      const fVal = view.getFloat32(0, true);
      if (fVal >= 1.0 && fVal <= 100.0 && !isNaN(fVal) && isFinite(fVal)) return Math.round(fVal);
    } catch (e) {}
  }
  if (bytes[0] >= 0 && bytes[0] <= 100) {
    return bytes[0];
  }
  return 0;
}

function parseDabsBytes(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4) {
    try {
      const fVal = view.getFloat32(0, true);
      if (fVal >= 1.0 && fVal < 1000000.0 && Number.isInteger(fVal)) {
        return Math.round(fVal);
      }
    } catch (e) {}
    return view.getUint32(0, true);
  }
  if (bytes.length === 2) return view.getUint16(0, true);
  if (bytes.length === 1) return bytes[0];
  return 0;
}

function parseDurationSeconds(rawVal) {
  if (rawVal > 10000) {
    try {
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setUint32(0, rawVal, true);
      const fVal = view.getFloat32(0, true);
      if (fVal >= 5.0 && fVal <= 300.0) {
        return Math.round(fVal);
      }
    } catch (e) {}
  }
  if (rawVal >= 5 && rawVal <= 300) return rawVal;
  if (rawVal >= 500 && rawVal <= 30000) return Math.round(rawVal / 100);
  return 45;
}

// ==========================================================================
// Puffco Web Bluetooth Client
// ==========================================================================

class PuffcoBleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.loraxService = null;
    this.cmdChar = null;
    this.replyChar = null;

    this.isConnected = false;
    this._seq = 0;
    this._pendingReplies = new Map(); // seq -> { resolve, reject, timer }
    this._listeners = new Set();
    this._stateListeners = new Set();
    this._disconnectListeners = new Set();
    this._isIntentionalDisconnect = false;
    this._effectTimer = null;

    this._streaming = false;
    this._stopGuardUntil = 0;
    this._lastTempTimestamp = null;
    this._wakeLock = null;
    this._cmdQueue = Promise.resolve();

    this.telemetry = this._defaultTelemetry();
  }

  _defaultTelemetry() {
    return {
      connected: false,
      is_syncing: false,
      device_name: 'No Device',
      mac_address: '',
      serial_number: '',
      firmware_version: '',
      operating_state: 'DISCONNECTED',
      state_name: 'Disconnected',
      live_temp_f: null,
      target_temp_f: 485.0,
      time_remaining: 0,
      total_time: 45,
      battery_pct: null,
      is_charging: false,
      is_heating: false,
      chamber_type: null,
      chamber_name: null,
      lifetime_dabs: null,
      stealth_mode: false,
      lantern_active: false,
      lantern_effect: 'off',
      lantern_brightness: 255,
      lantern_color: [255, 122, 0],
      active_profile: 0,
      profiles: [
        { slot: 0, name: 'Low', target_temp_f: 480, duration_s: 50 },
        { slot: 1, name: 'Medium', target_temp_f: 485, duration_s: 60 },
        { slot: 2, name: 'High', target_temp_f: 530, duration_s: 40 },
        { slot: 3, name: 'ROSIN', target_temp_f: 465, duration_s: 90 },
      ],
      is_demo: false,
      active_curve_running: false,
    };
  }

  isWebBluetoothSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  addTelemetryListener(cb) {
    this._listeners.add(cb);
  }

  removeTelemetryListener(cb) {
    this._listeners.delete(cb);
  }

  addStateListener(cb) {
    this._stateListeners.add(cb);
  }

  removeStateListener(cb) {
    this._stateListeners.delete(cb);
  }

  addDisconnectListener(cb) {
    this._disconnectListeners.add(cb);
  }

  removeDisconnectListener(cb) {
    this._disconnectListeners.delete(cb);
  }

  _notifyDisconnectListeners(info) {
    this._disconnectListeners.forEach((cb) => {
      try { cb(info); } catch (e) { console.error(e); }
    });
  }

  _notifyListeners() {
    const data = JSON.parse(JSON.stringify(this.telemetry));
    this._listeners.forEach((cb) => {
      try { cb(data); } catch (e) { console.error(e); }
    });
  }

  // ---------------- Wake Lock & Haptics ----------------

  async _requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !this._wakeLock) {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => {
          this._wakeLock = null;
        });
      }
    } catch (e) {
      console.warn('Wake Lock request skipped or failed:', e);
    }
  }

  async _releaseWakeLock() {
    if (this._wakeLock) {
      try {
        await this._wakeLock.release();
      } catch (e) {}
      this._wakeLock = null;
    }
  }

  _vibrate(pattern = [50]) {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch (e) {}
  }

  // ---------------- Connection & Handshake ----------------

  async connect(options = {}) {
    // 1. Secure context validation
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error(
        'Web Bluetooth requires a Secure Context (HTTPS or http://localhost). Connecting over plain file:// or http://192.168.x.x is blocked by browser security. Please open via http://localhost:8080 or deploy to HTTPS (Netlify).'
      );
    }

    if (!this.isWebBluetoothSupported()) {
      throw new Error(
        'Web Bluetooth is not supported in this browser. On iOS, open this site in Path Browser or Bluefy over HTTPS. On Android/Desktop, use Google Chrome or Edge.'
      );
    }

    const optionalServices = [
      PUFFCO_LORAX_SVC_UUID,
      PUFFCO_PIKACHU_SVC_UUID,
      DEVINFO_SVC_UUID,
      PUFFCO_PUP_SVC_UUID,
      PUFFCO_SILABS_OTA_SVC_UUID,
      '0000180f-0000-1000-8000-00805f9b34fb', // Standard Battery Service
      '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
      '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
      'f9a98c15-c651-4f34-b656-d100bf580000', // Puffco base service
    ];

    console.log('[PuffcoBLE] Requesting Bluetooth Device (acceptAllDevices: true)...');

    let selectedDevice = null;
    try {
      selectedDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices,
      });
    } catch (err) {
      if (err.name === 'NotFoundError' || err.message?.includes('User cancelled') || err.message?.includes('cancelled')) {
        throw new Error('No device selected. Pairing was cancelled.');
      }
      throw err;
    }

    if (!selectedDevice) {
      throw new Error('No device selected.');
    }

    return await this.connectDevice(selectedDevice);
  }

  async connectDevice(device) {
    if (!device) throw new Error('No BluetoothDevice specified.');
    this.device = device;

    // Persist last connected device ID for auto-reconnection
    try {
      if (this.device.id) {
        localStorage.setItem('puff_last_device_id', this.device.id);
        if (this.device.name) {
          localStorage.setItem('puff_last_device_name', this.device.name);
        }
        document.cookie = `puff_last_device_id=${encodeURIComponent(this.device.id)}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } catch (e) {
      console.warn('[PuffcoBLE] Could not persist last device ID:', e);
    }

    this.device.addEventListener('gattserverdisconnected', () => {
      this._onDisconnected(false);
    });

    const devName = this.device.name || 'Puff Device';
    console.log(`[PuffcoBLE] Connecting to GATT server (${devName})...`);
    this.server = await this.device.gatt.connect();

    // Resilient Lorax Service Discovery with Exponential Backoff
    console.log(`[PuffcoBLE] Discovering Lorax Service (${PUFFCO_LORAX_SVC_UUID})...`);
    let loraxService = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        if (!this.device.gatt.connected) {
          console.log(`[PuffcoBLE] Re-establishing GATT connection (attempt ${attempt}/4)...`);
          this.server = await this.device.gatt.connect();
        }

        // Settling delay allowing the OS BLE stack (CoreBluetooth / BlueZ) to finish service discovery on initial pair
        await new Promise((r) => setTimeout(r, attempt === 1 ? 250 : 450 * attempt));

        try {
          loraxService = await this.server.getPrimaryService(PUFFCO_LORAX_SVC_UUID);
        } catch (dirErr) {
          console.log(`[PuffcoBLE] Direct getPrimaryService attempt ${attempt} note:`, dirErr.message || dirErr);
          const services = await this.server.getPrimaryServices();
          for (const s of services) {
            if (s.uuid.toLowerCase() === PUFFCO_LORAX_SVC_UUID.toLowerCase()) {
              loraxService = s;
              break;
            }
          }
        }

        if (loraxService) {
          this.loraxService = loraxService;
          console.log(`[PuffcoBLE] Lorax Service discovered on attempt ${attempt}!`);
          break;
        }
      } catch (err) {
        console.warn(`[PuffcoBLE] Discovery cycle ${attempt} caught:`, err.message || err);
      }
    }

    if (!this.loraxService) {
      throw new Error(
        `Selected device "${devName}" is not a Puff device (Lorax service not found). Please ensure you select your Puff Peak Pro or Proxy.`
      );
    }

    // Keep connection alive by reading Lorax version char if present (with 600ms timeout)
    try {
      const verChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_VERSION);
      if (verChar) {
        await Promise.race([
          verChar.readValue(),
          new Promise((r) => setTimeout(r, 600)),
        ]);
      }
    } catch (e) {}

    // Get Command & Reply Characteristics with retry
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.cmdChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_CMD);
        this.replyChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_REPLY);
        if (this.cmdChar && this.replyChar) break;
      } catch (cErr) {
        if (attempt === 3) throw cErr;
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }

    // Setup Lorax reply notifications
    console.log('[PuffcoBLE] Subscribing to Lorax replies...');
    await this.replyChar.startNotifications();

    const replyHandler = (evt) => this._onLoraxNotification(evt);
    this.replyChar.addEventListener('characteristicvaluechanged', replyHandler);
    this.replyChar.oncharacteristicvaluechanged = replyHandler;

    // Small delay to allow CCCD descriptor write to settle on peripheral
    await new Promise((r) => setTimeout(r, 120));

    // CRITICAL: Immediately mark connected and notify listeners with clean syncing state
    this.isConnected = true;
    this.telemetry.connected = true;
    this.telemetry.is_syncing = true;
    this.telemetry.device_name = devName;
    this.telemetry.mac_address = this.device.id ? this.device.id.slice(0, 17).toUpperCase() : 'BLE-CONNECTED';
    this.telemetry.operating_state = 'IDLE';
    this.telemetry.state_name = 'Syncing...';
    this.telemetry.battery_pct = null;
    this.telemetry.lifetime_dabs = null;
    this.telemetry.live_temp_f = null;
    this.telemetry.chamber_name = null;
    this._notifyListeners();

    console.log(`[PuffcoBLE] Successfully connected to ${devName}! Initializing session in background...`);

    // Kick off authentication and initial diagnostics asynchronously (non-blocking)
    this._initSession().catch((err) => {
      console.warn('[PuffcoBLE] Session initialization note:', err);
    });

    return true;
  }

  /**
   * Attempts automatic reconnection to the last paired device if permitted by browser.
   */
  async autoConnect() {
    if (this.isConnected) return true;
    if (typeof window !== 'undefined' && !window.isSecureContext) return false;
    if (!this.isWebBluetoothSupported() || typeof navigator.bluetooth.getDevices !== 'function') return false;

    try {
      const devices = await navigator.bluetooth.getDevices();
      if (!devices || devices.length === 0) return false;

      let lastId = null;
      try {
        lastId = localStorage.getItem('puff_last_device_id');
        if (!lastId) {
          const match = document.cookie.match(/(?:^|; )puff_last_device_id=([^;]*)/);
          if (match) lastId = decodeURIComponent(match[1]);
        }
      } catch (e) {}

      let targetDevice = null;
      if (lastId) {
        targetDevice = devices.find((d) => d.id === lastId);
      }
      if (!targetDevice) {
        targetDevice = devices.find((d) => d.name && /puffco|peak|proxy|puff/i.test(d.name)) || devices[0];
      }

      if (!targetDevice) return false;

      console.log(`[PuffcoBLE] Found previously permitted device "${targetDevice.name || 'Puff'}" (${targetDevice.id}). Auto-connecting...`);
      return await this.connectDevice(targetDevice);
    } catch (err) {
      console.log('[PuffcoBLE] Auto-connect attempt bypassed:', err.message || err);
      return false;
    }
  }

  async _initSession() {
    // 1. Lorax SHA-256 Authentication Handshake
    console.log('[PuffcoBLE] Performing Lorax SHA-256 handshake...');
    const authed = await this._authenticate();
    if (authed) {
      console.log('[PuffcoBLE] Lorax unlocked successfully!');
    } else {
      console.warn('[PuffcoBLE] Lorax handshake did not confirm unlock, proceeding with telemetry...');
    }

    // 2. Query device info (serial, firmware)
    await this._pollDeviceInfo();

    // 3. Poll fast telemetry (operating state, live chamber temp)
    await this._pollFastTelemetry();
    this._notifyListeners();

    // 4. Poll slow diagnostics (VFS name, battery SOC, charging, chamber type, profiles, dabs)
    await this._pollSlowDiagnostics(true);
    
    // Telemetry initial sync is now complete!
    this.telemetry.is_syncing = false;
    this.telemetry.state_name = OperatingStateDisplayNames[this.telemetry.operating_state] || 'Standby / Idle';
    this._notifyListeners();

    // 5. Start background telemetry polling stream
    this._startTelemetryStream();
    console.log(`[PuffcoBLE] Session initialization complete for ${this.telemetry.device_name}!`);
  }

  async disconnect() {
    this._isIntentionalDisconnect = true;
    this.stopLanternEffect();
    this._streaming = false;
    await this._releaseWakeLock();

    if (this.device && this.device.gatt && this.device.gatt.connected) {
      try {
        this.device.gatt.disconnect();
      } catch (e) {}
    }
    this._onDisconnected(true);
  }

  _onDisconnected(isIntentional = false) {
    console.warn('[PuffcoBLE] GATT disconnected. Intentional:', isIntentional);
    const wasConnected = this.isConnected;
    this.isConnected = false;
    this._streaming = false;
    this.stopLanternEffect();
    this._releaseWakeLock();

    // Reject any pending replies
    this._pendingReplies.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Device disconnected'));
    });
    this._pendingReplies.clear();

    this.telemetry = this._defaultTelemetry();
    this._notifyListeners();
    this._notifyStateListeners('DISCONNECTED');
    this._notifyDisconnectListeners({ wasConnected, isIntentional });
    this._isIntentionalDisconnect = false;
  }

  async _authenticate() {
    try {
      const [status, seed] = await this._sendLoraxCmd(LORAX_OP_GET_ACCESS_SEED);
      if (status === 0 && seed && seed.length >= 16) {
        const token = await calculateLoraxAuthToken(seed, LORAX_MASTER_HANDSHAKE_KEY);
        const [unlockStatus] = await this._sendLoraxCmd(LORAX_OP_UNLOCK_ACCESS, token);
        if (unlockStatus === 0) {
          console.log('[PuffcoBLE] Lorax handshake unlocked successfully!');
          return true;
        } else {
          console.warn(`[PuffcoBLE] Lorax unlock returned status code ${unlockStatus}`);
        }
      } else {
        console.warn(`[PuffcoBLE] Lorax get seed returned status ${status}`);
      }
    } catch (e) {
      console.warn('[PuffcoBLE] Lorax handshake error:', e);
    }
    return false;
  }

  // ---------------- Lorax Command Protocol Engine ----------------

  _onLoraxNotification(evt) {
    try {
      const raw = evt.target ? evt.target.value : evt;
      if (!raw) return;

      let view;
      let buf;
      let offset = 0;
      let length = 0;

      if (raw instanceof DataView) {
        view = raw;
        buf = raw.buffer;
        offset = raw.byteOffset;
        length = raw.byteLength;
      } else if (raw instanceof Uint8Array || (raw.buffer && raw.byteLength !== undefined)) {
        view = new DataView(raw.buffer, raw.byteOffset || 0, raw.byteLength);
        buf = raw.buffer;
        offset = raw.byteOffset || 0;
        length = raw.byteLength;
      } else if (raw instanceof ArrayBuffer) {
        view = new DataView(raw);
        buf = raw;
        offset = 0;
        length = raw.byteLength;
      } else {
        console.warn('[PuffcoBLE] Unknown notification value type:', raw);
        return;
      }

      if (length < 3) return;

      const seq = view.getUint16(0, true);
      const status = view.getUint8(2);
      const payload = length > 3 ? new Uint8Array(buf, offset + 3, length - 3) : new Uint8Array(0);

      const pending = this._pendingReplies.get(seq);
      if (pending) {
        clearTimeout(pending.timer);
        this._pendingReplies.delete(seq);
        pending.resolve([status, payload]);
      }
    } catch (err) {
      console.error('[PuffcoBLE] Error processing Lorax notification:', err);
    }
  }

  async _writeCmd(frame) {
    if (!this.cmdChar) {
      throw new Error('Command characteristic is not available');
    }

    // 1. Try writeValueWithoutResponse (standard modern Web Bluetooth)
    if (typeof this.cmdChar.writeValueWithoutResponse === 'function') {
      try {
        await this.cmdChar.writeValueWithoutResponse(frame);
        return;
      } catch (e) {
        console.warn('[PuffcoBLE] writeValueWithoutResponse failed, falling back to writeValue...', e);
      }
    }

    // 2. Try writeValueWithResponse
    if (typeof this.cmdChar.writeValueWithResponse === 'function') {
      try {
        await this.cmdChar.writeValueWithResponse(frame);
        return;
      } catch (e) {
        console.warn('[PuffcoBLE] writeValueWithResponse failed, falling back to writeValue...', e);
      }
    }

    // 3. Try writeValue (standard older W3C / Bluefy / Path Browser / iOS WebBLE)
    if (typeof this.cmdChar.writeValue === 'function') {
      await this.cmdChar.writeValue(frame);
      return;
    }

    throw new Error('No supported write method available on BLE command characteristic');
  }

  async _sendLoraxCmd(opcode, payload = new Uint8Array(0), timeoutMs = 1500) {
    if (!this.server || !this.server.connected) {
      throw new Error('Device is not connected');
    }

    // Sequence all BLE GATT writes through the promise queue to prevent DOMException: GATT operation in progress
    const executeCmd = async () => {
      if (!this.server || !this.server.connected) {
        throw new Error('Device is not connected');
      }

      this._seq = (this._seq + 1) & 0xffff;
      if (this._seq === 0) this._seq = 1;
      const seq = this._seq;

      const frame = packLoraxCmd(seq, opcode, payload);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._pendingReplies.delete(seq);
          reject(new Error(`Lorax command opcode 0x${opcode.toString(16)} (seq ${seq}) timed out`));
        }, timeoutMs);

        this._pendingReplies.set(seq, { resolve, reject, timer });

        this._writeCmd(frame).catch((err) => {
          clearTimeout(timer);
          this._pendingReplies.delete(seq);
          reject(err);
        });
      });
    };

    const task = this._cmdQueue.catch(() => {}).then(executeCmd);
    this._cmdQueue = task.catch(() => {});
    return task;
  }

  async readPath(path, maxLen = 240) {
    try {
      const payload = packLoraxReadShort(path, maxLen);
      const [status, data] = await this._sendLoraxCmd(LORAX_OP_READ_SHORT, payload);
      if (status === 0) return data;
      return new Uint8Array(0);
    } catch (e) {
      return new Uint8Array(0);
    }
  }

  async writePath(path, valBytes) {
    try {
      const payload = packLoraxWriteShort(path, valBytes);
      const [status] = await this._sendLoraxCmd(LORAX_OP_WRITE_SHORT, payload);
      return status === 0;
    } catch (e) {
      console.warn(`[PuffcoBLE] Write path '${path}' error:`, e);
      return false;
    }
  }

  // ---------------- Telemetry & Diagnostics ----------------

  async _pollDeviceInfo() {
    try {
      // DEVINFO_SVC_UUID is optional (absent on Proxy). 500ms timeout prevents stalling.
      const devService = await Promise.race([
        this.server.getPrimaryService(DEVINFO_SVC_UUID),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 500)),
      ]).catch(() => null);

      if (devService) {
        try {
          const fwChar = await devService.getCharacteristic(DEVINFO_FIRMWARE_UUID);
          const fwVal = await fwChar.readValue();
          this.telemetry.firmware_version = decodeUtf8(new Uint8Array(fwVal.buffer));
        } catch (e) {}

        try {
          const snChar = await devService.getCharacteristic(DEVINFO_SERIAL_UUID);
          const snVal = await snChar.readValue();
          this.telemetry.serial_number = decodeUtf8(new Uint8Array(snVal.buffer));
        } catch (e) {}
      }
    } catch (e) {}
  }

  async _pollSlowDiagnostics(forceProfiles = false) {
    try {
      // 0. VFS Device Name
      const nameBytes = await this.readPath(PATH_DEVICE_NAME);
      if (nameBytes.length > 0) {
        const cleanName = decodeUtf8(nameBytes).trim();
        if (cleanName) {
          this.telemetry.device_name = cleanName;
        }
      }

      // 1. Battery SOC
      const socBytes = await this.readPath(PATH_BATTERY_SOC);
      if (socBytes.length > 0) {
        this.telemetry.battery_pct = parseBatteryBytes(socBytes);
      }

      // 2. Battery Charging Status
      const chgBytes = await this.readPath(PATH_BATTERY_CHARGE_STAT);
      if (chgBytes.length > 0) {
        this.telemetry.is_charging = chgBytes[0] === 1 || chgBytes[0] === 2;
      }

      // 3. Chamber Type
      const chmtBytes = await this.readPath(PATH_CHAMBER_TYPE);
      if (chmtBytes.length > 0) {
        const cType = chmtBytes[0];
        this.telemetry.chamber_name = ChamberNames[cType] || (this.telemetry.device_name.toLowerCase().includes('proxy') ? 'Standard' : '3DXL');
        this.telemetry.chamber_type = cType === 3 ? 'CHAMBER_3DXL' : (cType === 2 ? 'CHAMBER_3D' : 'STANDARD');
      } else if (this.telemetry.device_name.toLowerCase().includes('proxy')) {
        this.telemetry.chamber_name = 'Standard';
        this.telemetry.chamber_type = 'STANDARD';
      }

      // 4. Lifetime Dabs Odometer
      const odomBytes = await this.readPath(PATH_ODOMETER_DABS);
      if (odomBytes.length > 0) {
        this.telemetry.lifetime_dabs = parseDabsBytes(odomBytes);
      }

      // 5. Read Stored Flash Profiles (slots 0..3) - only poll once on initial connect or when empty
      if (!this.telemetry.profiles || this.telemetry.profiles.length === 0 || forceProfiles) {
        await this._pollProfiles();
      }
    } catch (e) {
      console.warn('[PuffcoBLE] Slow poll note:', e);
    }
  }

  async _pollProfiles() {
    const activeSlotBytes = await this.readPath(PATH_ACTIVE_PROFILE);
    if (activeSlotBytes.length > 0) {
      this.telemetry.active_profile = activeSlotBytes[0];
    }

    const profiles = [];
    for (let slot = 0; slot < 4; slot++) {
      let name = `Profile ${slot + 1}`;
      let tempF = 485;
      let durS = 50;

      // Name
      const nameBytes = await this.readPath(PATH_PROFILE_NAME_PREFIX.replace('{slot}', slot));
      if (nameBytes.length > 0) {
        const decoded = decodeUtf8(nameBytes).trim();
        if (decoded) name = decoded;
      }

      // Temp
      const tempBytes = await this.readPath(PATH_PROFILE_TEMP_PREFIX.replace('{slot}', slot));
      if (tempBytes.length > 0) {
        const parsed = parseTempBytes(tempBytes);
        if (parsed > 0) tempF = Math.round(parsed);
      }

      // Duration
      const durBytes = await this.readPath(PATH_PROFILE_TIME_PREFIX.replace('{slot}', slot));
      if (durBytes.length > 0) {
        const raw = parseDabsBytes(durBytes);
        durS = parseDurationSeconds(raw);
      }

      profiles.push({ slot, name, target_temp_f: tempF, duration_s: durS });
    }

    this.telemetry.profiles = profiles;

    // Snapshot profiles into local storage vault for safe emergency recovery
    try {
      localStorage.setItem('puff_profile_vault', JSON.stringify({
        timestamp: Date.now(),
        device_name: this.telemetry.device_name || 'Puffco Device',
        profiles: profiles,
      }));
    } catch (e) {}

    // Only update target temp if not currently in a heat session or running a custom curve
    if (!this.telemetry.is_heating && !this.telemetry.active_curve_running && profiles[this.telemetry.active_profile]) {
      this.telemetry.target_temp_f = profiles[this.telemetry.active_profile].target_temp_f;
      this.telemetry.total_time = profiles[this.telemetry.active_profile].duration_s;
    }
  }

  async _pollFastTelemetry() {
    const prevState = this.telemetry.operating_state;

    // 1. Operating State
    const stBytes = await this.readPath(PATH_STATE_ID);
    if (stBytes.length > 0) {
      const rawSt = stBytes[0];
      const isGuarded = Date.now() < this._stopGuardUntil;

      if (rawSt === 5 || rawSt === 13 || rawSt === 0) {
        this.telemetry.operating_state = 'IDLE';
        this.telemetry.state_name = 'Standby / Idle';
        this._stopGuardUntil = 0;
      } else if (!isGuarded) {
        const name = OperatingStateNames[rawSt] || 'IDLE';
        this.telemetry.operating_state = name;
        this.telemetry.state_name = OperatingStateDisplayNames[name] || name;
      }
    }

    const isHeating = ['HEAT_PREHEAT', 'HEAT_ACTIVE', 'READY', 'HEAT_FADE'].includes(this.telemetry.operating_state);
    this.telemetry.is_heating = isHeating;

    // Manage Screen Wake Lock during active sessions
    if (isHeating) {
      this._requestWakeLock();
    } else {
      this._releaseWakeLock();
    }

    // 2. Chamber Temperature & Watchdog
    const tempBytes = await this.readPath(PATH_CHAMBER_TEMP);
    if (tempBytes.length > 0) {
      const tF = parseTempBytes(tempBytes);
      if (tF > 0.0) {
        this.telemetry.live_temp_f = tF;
        this._lastTempTimestamp = Date.now();

        // CRITICAL SAFETY CUTOFF: Auto shut off any session if chamber exceeds 600°F
        if (tF >= 600.0 && this.telemetry.is_heating) {
          console.error(`[EMERGENCY SAFETY CUTOFF] Chamber temperature (${tF.toFixed(1)}°F) reached/exceeded 600°F! Aborting session immediately!`);
          this.telemetry.active_curve_running = false;
          this.stopSession(true).catch((err) => console.error('Emergency abort error:', err));
          this._stateListeners.forEach((cb) => {
            try { cb('EMERGENCY_OVERHEAT'); } catch (e) {}
          });
        }
      }
    } else if (this.telemetry.is_heating) {
      // Stale Telemetry Watchdog (Deadman Switch)
      if (this._lastTempTimestamp && (Date.now() - this._lastTempTimestamp > 3500)) {
        console.error('[PuffcoBLE] STALE TELEMETRY WATCHDOG: Chamber temperature telemetry lost for > 3.5s during active heat! Triggering safety abort.');
        this.telemetry.active_curve_running = false;
        this.stopSession(true).catch((err) => console.error('Stale telemetry abort error:', err));
        this._stateListeners.forEach((cb) => {
          try { cb('TELEMETRY_LOSS'); } catch (e) {}
        });
      }
    }

    // 3. Session Countdown Timer (skip during custom curve to minimize BLE bus latency)
    if (isHeating && !this.telemetry.active_curve_running) {
      const elapBytes = await this.readPath(PATH_TIME_ELAPSED);
      const tottBytes = await this.readPath(PATH_TIME_TOTAL);
      if (elapBytes.length >= 4 && tottBytes.length >= 4) {
        const viewElap = new DataView(elapBytes.buffer, elapBytes.byteOffset, elapBytes.byteLength);
        const viewTott = new DataView(tottBytes.buffer, tottBytes.byteOffset, tottBytes.byteLength);

        let elap = viewElap.getFloat32(0, true);
        let tott = viewTott.getFloat32(0, true);
        if (isNaN(elap) || !isFinite(elap)) elap = viewElap.getUint32(0, true);
        if (isNaN(tott) || !isFinite(tott)) tott = viewTott.getUint32(0, true);

        if (tott > 300) {
          tott /= 1000.0;
          elap /= 1000.0;
        }
        this.telemetry.total_time = Math.round(tott);
        this.telemetry.time_remaining = Math.max(0, Math.round(tott - elap));
      }
    } else if (!isHeating) {
      this.telemetry.time_remaining = 0;
    }

    // State change event notification
    if (this.telemetry.operating_state !== prevState) {
      this._stateListeners.forEach((cb) => {
        try { cb(this.telemetry.operating_state); } catch (e) {}
      });
      if (this.telemetry.operating_state === 'READY') {
        this._vibrate([100, 50, 100]);
      }
    }
  }

  _startTelemetryStream() {
    if (this._streaming) return;
    this._streaming = true;

    let lastSlow = Date.now();

    const loop = async () => {
      while (this._streaming && this.isConnected) {
        try {
          await this._pollFastTelemetry();

          const now = Date.now();
          const isBusy = this.telemetry.is_heating || this.telemetry.active_curve_running;

          // Never execute slow diagnostics while heating or running a curve (prevents queue starvation)
          // When idle, poll battery/odometer diagnostics every 30 seconds
          if (!isBusy && (now - lastSlow > 30000)) {
            lastSlow = now;
            await this._pollSlowDiagnostics();
          }

          this._notifyListeners();

          const delay = this.telemetry.active_curve_running ? 450 : (this.telemetry.is_heating ? 280 : 600);
          await new Promise((r) => setTimeout(r, delay));
        } catch (e) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };

    loop();
  }

  // ---------------- Hardware Commands & Safety Interlocks ----------------

  async startSession() {
    if (!this.isConnected) {
      throw new Error('Device is not connected');
    }

    // 1. Live Chamber Overtemp Gate
    if (this.telemetry.live_temp_f >= 600.0) {
      throw new Error('Cannot start session: Chamber temperature is at or above 600°F safety limit');
    }

    // 2. Hardware Operating State Interlocks
    const blockedStates = ['COOLDOWN', 'ERROR', 'OFF', 'BOOTING', 'SHUTDOWN'];
    if (blockedStates.includes(this.telemetry.operating_state)) {
      throw new Error(`Cannot start session: Device is in ${this.telemetry.state_name || this.telemetry.operating_state} state`);
    }

    // 3. Low Battery Interlock (Prevents high current draw brownouts / cell stress)
    if (this.telemetry.battery_pct !== null && this.telemetry.battery_pct < 12) {
      throw new Error(`Cannot start session: Battery critically low (${this.telemetry.battery_pct}%). Charge device before heating.`);
    }

    // 4. Chamber Seating Check
    if (this.telemetry.chamber_type === null && !this.telemetry.chamber_name) {
      console.warn('[PuffcoBLE] Caution: Chamber may be unseated or unrecognized.');
    }

    const success = await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x07]));
    if (success) {
      this.telemetry.operating_state = 'HEAT_PREHEAT';
      this.telemetry.state_name = 'Preheating';
      this.telemetry.is_heating = true;
      this._lastTempTimestamp = Date.now();
      this._notifyListeners();
    }
    return success;
  }

  async stopSession(isEmergency = false) {
    this._stopGuardUntil = Date.now() + 2500;
    this.telemetry.active_curve_running = false;

    // Redundant Burst Stop: Send up to 3 abort packets spaced 45ms apart
    let anyOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ok = await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x08]));
        if (ok) anyOk = true;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 45));
      } catch (err) {
        console.warn(`[PuffcoBLE] Stop attempt ${attempt + 1} note:`, err);
      }
    }

    this.telemetry.operating_state = 'IDLE';
    this.telemetry.state_name = 'Standby / Idle';
    this.telemetry.is_heating = false;
    this.telemetry.time_remaining = 0;
    this._releaseWakeLock();
    this._notifyListeners();
    return anyOk;
  }

  async boostSession() {
    return await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x09]));
  }

  async setProfile(slot) {
    const success = await this.writePath(PATH_ACTIVE_PROFILE, new Uint8Array([slot]));
    if (success) {
      this.telemetry.active_profile = slot;
      if (this.telemetry.profiles && this.telemetry.profiles[slot]) {
        this.telemetry.target_temp_f = this.telemetry.profiles[slot].target_temp_f;
        this.telemetry.total_time = this.telemetry.profiles[slot].duration_s;
      }
      this._notifyListeners();
    }
    return success;
  }

  async writeTemperature(tempF, slot = null) {
    if (slot === null) slot = this.telemetry.active_profile;
    // Strict numeric sanitization & hard safety clamp [350°F, 590°F]
    tempF = validateTemperature(tempF);

    const isProxy = (this.telemetry.device_name || '').toLowerCase().includes('proxy') || this.telemetry.chamber_type === 'STANDARD';
    const cVal = fToC(tempF);

    // Proxy hardware strictly requires int32 LE tenths of °C (e.g. 251.7°C -> 2517)
    // Peak Pro hardware strictly requires float32 LE Celsius
    const bufInt = new ArrayBuffer(4);
    new DataView(bufInt).setInt32(0, Math.round(cVal * 10.0), true);
    const payloadInt = new Uint8Array(bufInt);

    const bufFloat = new ArrayBuffer(4);
    new DataView(bufFloat).setFloat32(0, cVal, true);
    const payloadFloat = new Uint8Array(bufFloat);

    const primaryPayload = isProxy ? payloadInt : payloadFloat;
    const secondaryPayload = isProxy ? payloadFloat : payloadInt;

    const path = PATH_PROFILE_TEMP_PREFIX.replace('{slot}', slot);
    let ok = await this.writePath(path, primaryPayload);
    if (!ok) {
      console.warn('[PuffcoBLE] Primary temp write format rejected, trying fallback format...');
      ok = await this.writePath(path, secondaryPayload);
    }

    if (ok) {
      this.telemetry.target_temp_f = tempF;
      if (this.telemetry.profiles && this.telemetry.profiles[slot]) {
        this.telemetry.profiles[slot].target_temp_f = tempF;
      }
      // Re-assert active profile to update live PID register
      await this.writePath(PATH_ACTIVE_PROFILE, new Uint8Array([slot]));
      this._notifyListeners();
    } else {
      console.error(`[PuffcoBLE] Failed to write temperature ${tempF}°F to slot ${slot}`);
    }
    return ok;
  }

  async writeDuration(durationS, slot = null) {
    if (slot === null) slot = this.telemetry.active_profile;
    // Strict numeric sanitization & hard safety clamp [15s, 120s]
    durationS = validateDuration(durationS);

    const isProxy = (this.telemetry.device_name || '').toLowerCase().includes('proxy') || this.telemetry.chamber_type === 'STANDARD';

    // Proxy hardware strictly requires uint32 LE hundredths of a second (e.g. 80s -> 8000)
    // Peak Pro hardware strictly requires float32 LE seconds
    const bufHundredths = new ArrayBuffer(4);
    new DataView(bufHundredths).setUint32(0, Math.round(durationS * 100), true);
    const payloadHundredths = new Uint8Array(bufHundredths);

    const bufFloat = new ArrayBuffer(4);
    new DataView(bufFloat).setFloat32(0, Number(durationS), true);
    const payloadFloat = new Uint8Array(bufFloat);

    const primaryPayload = isProxy ? payloadHundredths : payloadFloat;
    const secondaryPayload = isProxy ? payloadFloat : payloadHundredths;

    const path = PATH_PROFILE_TIME_PREFIX.replace('{slot}', slot);
    let ok = await this.writePath(path, primaryPayload);
    if (!ok) {
      console.warn('[PuffcoBLE] Primary duration write format rejected, trying fallback format...');
      ok = await this.writePath(path, secondaryPayload);
    }

    if (ok) {
      this.telemetry.total_time = durationS;
      if (this.telemetry.profiles && this.telemetry.profiles[slot]) {
        this.telemetry.profiles[slot].duration_s = durationS;
      }
      await this.writePath(PATH_ACTIVE_PROFILE, new Uint8Array([slot]));
      this._notifyListeners();
    } else {
      console.error(`[PuffcoBLE] Failed to write duration ${durationS}s to slot ${slot}`);
    }
    return ok;
  }

  async restoreProfileVault() {
    const raw = localStorage.getItem('puff_profile_vault');
    if (!raw) throw new Error('No profile backup found in local storage vault');
    const vault = JSON.parse(raw);
    if (!vault.profiles || !Array.isArray(vault.profiles)) throw new Error('Corrupt profile vault data');

    for (const p of vault.profiles) {
      if (typeof p.slot === 'number') {
        if (p.target_temp_f) await this.writeTemperature(p.target_temp_f, p.slot);
        if (p.duration_s) await this.writeDuration(p.duration_s, p.slot);
      }
    }
    await this.setProfile(this.telemetry.active_profile ?? 0);
    return true;
  }

  async setStealthMode(enabled) {
    const ok = await this.writePath(PATH_STEALTH_MODE, new Uint8Array([enabled ? 1 : 0]));
    if (ok) {
      this.telemetry.stealth_mode = !!enabled;
      this._notifyListeners();
    }
    return ok;
  }

  async setLanternMode(enabled) {
    if (enabled) {
      const ok = await this.writePath(PATH_LANTERN_CMD, new Uint8Array([1]));
      if (ok) {
        this.telemetry.lantern_active = true;
        // Also set lantern time to 7200 seconds (2 hours) so it doesn't immediately time out
        const timePayload = new Uint8Array(4);
        new DataView(timePayload.buffer).setFloat32(0, 7200.0, true);
        await this.writePath(PATH_LANTERN_TIME, timePayload).catch(() => {});

        // If no active effect, start default campfire
        if (!this.telemetry.lantern_effect || this.telemetry.lantern_effect === 'off') {
          await this.startLanternEffect('campfire');
        }
        this._notifyListeners();
      }
      return ok;
    } else {
      this.stopLanternEffect();
      const ok = await this.writePath(PATH_LANTERN_CMD, new Uint8Array([0]));
      this.telemetry.lantern_active = false;
      this.telemetry.lantern_effect = 'off';
      this._notifyListeners();
      return ok;
    }
  }

  async setLanternColor(r, g, b, mode = LanternMode.STATIC) {
    this.telemetry.lantern_color = [r, g, b];
    const payload = packLanternColor(r, g, b, mode);
    const ok = await this.writePath(PATH_LANTERN_COLOR, payload);
    this._notifyListeners();
    return ok;
  }

  async setLanternBrightness(pctOrByte) {
    let val = Math.round(Number(pctOrByte));
    if (val <= 100 && val > 0 && pctOrByte <= 100) {
      val = Math.round((val / 100) * 255);
    }
    val = Math.max(5, Math.min(255, val));
    this.telemetry.lantern_brightness = val;
    const ok = await this.writePath(PATH_LANTERN_BRIGHTNESS, new Uint8Array([val]));
    this._notifyListeners();
    return ok;
  }

  _stopEffectTimer() {
    if (this._effectTimer) {
      clearTimeout(this._effectTimer);
      clearInterval(this._effectTimer);
      this._effectTimer = null;
    }
  }

  async startLanternEffect(effectName, options = {}) {
    this._stopEffectTimer();
    this.telemetry.lantern_active = true;
    this.telemetry.lantern_effect = effectName;

    // Ensure lantern mode enabled
    await this.writePath(PATH_LANTERN_CMD, new Uint8Array([1])).catch(() => {});

    const baseColor = options.color || this.telemetry.lantern_color || [255, 122, 0];
    let [r, g, b] = baseColor;

    switch (effectName) {
      case 'flicker': {
        // Candle flicker: subtle micro-variations around a warm candle glow
        let step = 0;
        const tick = async () => {
          if (!this.isConnected || !this.telemetry.lantern_active) return;
          step++;
          const jitter = (Math.random() - 0.5) * 40;
          const curR = Math.max(180, Math.min(255, Math.round(255 + jitter)));
          const curG = Math.max(60, Math.min(160, Math.round(130 + jitter * 0.8)));
          const curB = Math.max(5, Math.min(40, Math.round(20 + jitter * 0.2)));
          await this.writePath(PATH_LANTERN_COLOR, packLanternColor(curR, curG, curB, LanternMode.STATIC)).catch(() => {});
          const nextInterval = 120 + Math.random() * 280;
          this._effectTimer = setTimeout(tick, nextInterval);
        };
        await tick();
        break;
      }

      case 'campfire': {
        // Dynamic dancing flames: shifts between deep ember reds and bright golden orange
        let phase = 0;
        const tick = async () => {
          if (!this.isConnected || !this.telemetry.lantern_active) return;
          phase += 0.35 + Math.random() * 0.3;
          const s = (Math.sin(phase) + 1) / 2; // 0 to 1
          const curR = 255;
          const curG = Math.round(40 + s * 95); // 40 (crimson red) to 135 (amber flame)
          const curB = Math.round(s * 15);
          await this.writePath(PATH_LANTERN_COLOR, packLanternColor(curR, curG, curB, LanternMode.RISING)).catch(() => {});
          const nextInterval = 250 + Math.random() * 350;
          this._effectTimer = setTimeout(tick, nextInterval);
        };
        await tick();
        break;
      }

      case 'night_light': {
        // Calm, soothing ultra-low glow with slow breathing
        await this.setLanternBrightness(40);
        await this.setLanternColor(255, 110, 30, LanternMode.BREATHING);
        break;
      }

      case 'rainbow': {
        // Full spectrum RGB hue rotation
        let hue = 0;
        const tick = async () => {
          if (!this.isConnected || !this.telemetry.lantern_active) return;
          hue = (hue + 18) % 360;
          const [cr, cg, cb] = hsvToRgb(hue, 1, 1);
          await this.writePath(PATH_LANTERN_COLOR, packLanternColor(cr, cg, cb, LanternMode.CIRCLING)).catch(() => {});
          this._effectTimer = setTimeout(tick, 350);
        };
        await tick();
        break;
      }

      case 'waterfall': {
        // Cascading ocean waves: shifts through cyans, teals, and deep aquas
        let wave = 0;
        const tick = async () => {
          if (!this.isConnected || !this.telemetry.lantern_active) return;
          wave += 0.4;
          const s = (Math.sin(wave) + 1) / 2;
          const curR = 0;
          const curG = Math.round(140 + s * 100);
          const curB = Math.round(200 + s * 55);
          await this.writePath(PATH_LANTERN_COLOR, packLanternColor(curR, curG, curB, LanternMode.RISING)).catch(() => {});
          this._effectTimer = setTimeout(tick, 380);
        };
        await tick();
        break;
      }

      case 'disco': {
        // Lorax disco hardware mode
        const discoPayload = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
        await this.writePath(PATH_LANTERN_COLOR, discoPayload);
        break;
      }

      case 'breathing': {
        // Slow meditative breath with chosen or current tint
        await this.setLanternColor(r, g, b, LanternMode.BREATHING);
        break;
      }

      case 'aurora': {
        // Northern lights: shimmering emerald, aqua, and deep violet
        let aPhase = 0;
        const auroraPalette = [
          [0, 255, 136],
          [0, 230, 255],
          [130, 60, 255],
          [20, 240, 180],
        ];
        const tick = async () => {
          if (!this.isConnected || !this.telemetry.lantern_active) return;
          aPhase = (aPhase + 1) % auroraPalette.length;
          const [ar, ag, ab] = auroraPalette[aPhase];
          await this.writePath(PATH_LANTERN_COLOR, packLanternColor(ar, ag, ab, LanternMode.CIRCLING_SLOW)).catch(() => {});
          this._effectTimer = setTimeout(tick, 600);
        };
        await tick();
        break;
      }

      case 'static':
      default: {
        await this.setLanternColor(r, g, b, LanternMode.STATIC);
        break;
      }
    }

    this._notifyListeners();
  }

  stopLanternEffect() {
    this._stopEffectTimer();
    this.telemetry.lantern_effect = 'off';
    this._notifyListeners();
  }

  async enterSleepMode() {
    return await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x01]));
  }

  async powerOff() {
    return await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x02]));
  }
}

// Global exports
window.PuffcoBleClient = PuffcoBleClient;
window.validateTemperature = validateTemperature;
window.validateDuration = validateDuration;
