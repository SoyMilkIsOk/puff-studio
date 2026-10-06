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
const PATH_ALT_CHAMBER_TEMP = '/p/htr/temp';
const PATH_LIVE_TARGET_TEMP = '/p/app/thc/temp';
const PATH_TARGET_TEMP = '/p/app/htr/ttag';
const PATH_TIME_ELAPSED = '/p/app/stat/elap';
const PATH_TIME_TOTAL = '/p/app/stat/tott';
const PATH_BATTERY_SOC = '/p/bat/soc';
const PATH_BATTERY_CHARGE_STAT = '/p/bat/chg/stat';
const PATH_CHAMBER_TYPE = '/p/htr/chmt';
const PATH_ODOMETER_DABS = '/p/app/odom/0/nc';
const PATH_INFO_DTOT = '/p/app/info/dtot';
const PATH_SYS_FW_VER = '/p/sys/fw/ver';
const PATH_SYS_HW_SER = '/p/sys/hw/ser';
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
  2: '3DXL',
  3: '3D',
  4: 'Proxy',
  5: 'Proxy',
};

/**
 * Firmware version string decoder (matches Puffco firmware encoding: A..Z letters, e.g. AB, AC, AD, etc.)
 */
function fwString(v) {
  const L = 'ABCDEFGHJKMNPRTUVWXYZ';
  if (v === 0) return 'X*';
  let s = v - 1, o = '';
  while (s >= 0) {
    o = L[s % L.length] + o;
    s = Math.floor(s / L.length) - 1;
  }
  return o;
}

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
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const f = dv.getFloat32(0, true);
  if (isFinite(f) && f > -80 && f < 520 && !(f !== 0 && Math.abs(f) < 1e-3)) {
    return Math.round(cToF(f) * 10) / 10;
  }
  const i = dv.getInt32(0, true);
  if (Math.abs(i) <= 6000) {
    return Math.round(cToF(i / 10.0) * 10) / 10;
  }
  return 0.0;
}

/**
 * Battery SOC parser.
 * Handles float fraction 0..1, float percentage 0..100, 2-byte integer, and 1-byte integer,
 * correctly avoiding denormalized float zero truncation on Proxy bases.
 */
function parseBatteryBytes(r) {
  if (!r || r.length === 0) return 0;
  let pct = null;
  try {
    let v;
    if (r.length >= 4) {
      const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
      v = dv.getFloat32(0, true);
      if (!isFinite(v) || (v !== 0 && Math.abs(v) < 1e-6)) {
        v = r[0];
      } else if (v > 0 && v <= 1.0) {
        v *= 100.0;
      }
    } else if (r.length >= 2) {
      v = r[0] | (r[1] << 8);
    } else {
      v = r[0];
    }
    if (isFinite(v) && v >= 0 && v <= 100.5) {
      pct = Math.round(Math.min(100, v));
    }
  } catch (e) {}
  return pct !== null ? pct : (r[0] <= 100 ? r[0] : 0);
}

/**
 * Lifetime dabs odometer parser.
 * Reads 12-byte float file (Peak Pro) or 4-byte uint32 counter (Proxy / legacy).
 */
function parseDabsBytes(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4) {
    const fVal = view.getFloat32(0, true);
    if (isFinite(fVal) && fVal >= 1.0 && fVal < 5000000.0 && !(fVal !== 0 && Math.abs(fVal) < 1e-3)) {
      return Math.round(fVal);
    }
    const uVal = view.getUint32(0, true);
    if (uVal < 5000000) return uVal;
  }
  if (bytes.length >= 2) return view.getUint16(0, true);
  if (bytes.length === 1) return bytes[0];
  return 0;
}

/**
 * Duration seconds parser.
 * Handles float32 seconds, uint32 centiseconds (x100), and uint32 milliseconds (x1000).
 */
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
  if (rawVal > 30000 && rawVal <= 300000) return Math.round(rawVal / 1000);
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

    this.isProxy = false;
    this._htrPath = PATH_CHAMBER_TEMP;
    this._needResp = false;
    this._tfmt = null;     // 'f32' | 'i10'
    this.hctfmt = null;    // profile temp format: 'f32' | 'i10'
    this.timefmt = null;   // profile duration format: 'f32' | 'cs' | 'ms' | 't5' | 'u32'

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
      is_proxy: false,
      device_model: 'Peak Pro',
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

  _notifyStateListeners(state) {
    if (!this._stateListeners) return;
    this._stateListeners.forEach((cb) => {
      try { cb(state); } catch (e) { console.error(e); }
    });
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

    // iPhone Bluetooth browsers (Bluefy and friends) don't reliably match the Peak against name filters, so acceptAllDevices there
    const ios = /iPhone|iPad|iPod|Bluefy/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const requestOpts = (options.showAll || ios)
      ? { acceptAllDevices: true, optionalServices: [PUFFCO_LORAX_SVC_UUID, PUFFCO_PIKACHU_SVC_UUID] }
      : {
          filters: [
            { namePrefix: 'Peak' },
            { namePrefix: 'PEAK' },
            { namePrefix: 'peak' },
            { namePrefix: 'Puff' },
            { namePrefix: 'PUFF' },
            { namePrefix: 'puff' },
            { namePrefix: 'Proxy' },
            { namePrefix: 'PROXY' },
            { namePrefix: 'proxy' },
            { namePrefix: 'Pivot' },
            { namePrefix: 'PIVOT' },
            { namePrefix: 'pivot' },
            { services: [PUFFCO_LORAX_SVC_UUID] },
          ],
          optionalServices: [PUFFCO_LORAX_SVC_UUID, PUFFCO_PIKACHU_SVC_UUID],
        };

    console.log('[PuffcoBLE] Requesting Bluetooth Device...', requestOpts);

    let selectedDevice = null;
    try {
      selectedDevice = await navigator.bluetooth.requestDevice(requestOpts);
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

    // Reset session-specific state
    this._needResp = false;
    this._tfmt = null;
    this.hctfmt = null;
    this.timefmt = null;
    this._htrPath = PATH_CHAMBER_TEMP;

    const devName = this.device.name || 'Puff Device';
    const looksProxy = /prox|pivot/i.test(devName);

    // Enforce device choice chosen on lockscreen (locked in for session safety)
    let chosen = this.chosenKind;
    if (!chosen) {
      try {
        chosen = localStorage.getItem('puff_device_choice') || localStorage.getItem('puff_devkind_pref');
      } catch (_) {}
    }
    if (chosen === 'proxy') {
      this.isProxy = true;
    } else if (chosen === 'peak') {
      this.isProxy = false;
    } else {
      this.isProxy = looksProxy;
    }
    this.chosenKind = this.isProxy ? 'proxy' : 'peak';

    // Persist last connected device ID for auto-reconnection
    try {
      if (this.device.id) {
        localStorage.setItem('puff_last_device_id', this.device.id);
        if (this.device.name) {
          localStorage.setItem('puff_last_device_name', this.device.name);
        }
        document.cookie = `puff_last_device_id=${encodeURIComponent(this.device.id)}; path=/; max-age=31536000; SameSite=Lax`;
        localStorage.setItem('puff_devkind_' + this.device.id, this.isProxy ? 'proxy' : 'peak');
      }
    } catch (e) {
      console.warn('[PuffcoBLE] Could not persist last device ID:', e);
    }

    this.device.addEventListener('gattserverdisconnected', () => {
      this._onDisconnected(false);
    });

    console.log(`[PuffcoBLE] Connecting to GATT server (${devName}, isProxy=${this.isProxy})...`);

    // 1. Resilient GATT connection with 3 retries & backoff (Proxy frequently drops attempt 1)
    let gatt = null;
    let gattErr = null;
    for (let attempt = 1; attempt <= 3 && !gatt; attempt++) {
      try {
        gatt = await this.device.gatt.connect();
      } catch (err) {
        gattErr = err;
        console.warn(`[PuffcoBLE] GATT connect attempt ${attempt}/3 failed:`, err.message || err);
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
    if (!gatt) {
      throw gattErr || new Error('Failed to connect to device GATT server');
    }
    this.server = gatt;

    // 2. Discover Lorax Primary Service (up to 2 attempts, then check Pikachu legacy)
    console.log(`[PuffcoBLE] Discovering Lorax Service (${PUFFCO_LORAX_SVC_UUID})...`);
    let svc = null;
    let svcErr = null;
    for (let attempt = 1; attempt <= 2 && !svc; attempt++) {
      try {
        svc = await this.server.getPrimaryService(PUFFCO_LORAX_SVC_UUID);
      } catch (err) {
        svcErr = err;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    if (!svc) {
      try {
        svc = await this.server.getPrimaryService(PUFFCO_PIKACHU_SVC_UUID);
      } catch (_) {}
    }
    if (!svc) {
      throw new Error(
        `Selected device "${devName}" is not a recognized Puffco device (Lorax service not found: ${svcErr?.message || 'unknown'}). Please ensure your Peak Pro or Proxy is awake and in pairing mode.`
      );
    }
    this.loraxService = svc;

    // 3. Get Command and Reply characteristics
    try {
      this.cmdChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_CMD);
      this.replyChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_REPLY);
    } catch (cErr) {
      throw new Error('Puffco communication characteristics (CMD/REPLY) not found');
    }

    // 4. Trigger OS BLE bonding by reading Lorax version characteristic (without race timeout)
    try {
      const verChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_VERSION);
      if (verChar) await verChar.readValue();
    } catch (e) {}

    // 5. Subscribe to notifications
    console.log('[PuffcoBLE] Subscribing to Lorax notifications...');
    const replyHandler = (evt) => this._onLoraxNotification(evt);
    this.replyChar.addEventListener('characteristicvaluechanged', replyHandler);
    this.replyChar.oncharacteristicvaluechanged = replyHandler;
    await this.replyChar.startNotifications();
    await new Promise((r) => setTimeout(r, 80));

    // 6. Step 4: Authentication Handshake
    console.log('[PuffcoBLE] Authenticating with device...');
    let authOk = false;
    try {
      authOk = await this._authenticate();
    } catch (e) {
      console.warn('[PuffcoBLE] Auth warning:', e);
    }

    // 7. Step 5: Read check & reply flow warmup (CRITICAL FOR PROXY!)
    // Proxies and certain OS stacks have the GATT link up, but replies are not flowing yet.
    // Ask, and if no answer on first try, restart notifications and ask once more.
    let initialTele = null;
    let readErr = null;
    for (let i = 0; i < 2 && !initialTele; i++) {
      if (i > 0) {
        console.log('[PuffcoBLE] No reply on first read (common on Proxy). Restarting notifications and asking again...');
        await new Promise((r) => setTimeout(r, 700));
        try { await this.replyChar.startNotifications(); } catch (_) {}
        if (!authOk) {
          try { authOk = await this._authenticate(); } catch (_) {}
        }
      }
      try {
        initialTele = await this._readInitialTelemetry();
        if (initialTele) break;
      } catch (e) {
        readErr = e;
        if (e && e.status != null) break; // Status returned from device means communication is alive
      }
    }

    if (!initialTele && readErr) {
      console.warn('[PuffcoBLE] Initial telemetry probe notice:', readErr);
    }

    // Mark connected state
    this.isConnected = true;
    this.telemetry.connected = true;
    this.telemetry.is_syncing = true;
    this.telemetry.is_proxy = this.isProxy;
    this.telemetry.device_model = this.isProxy ? 'Proxy' : 'Peak Pro';
    this.telemetry.device_name = devName;
    this.telemetry.mac_address = this.device.id ? this.device.id.slice(0, 17).toUpperCase() : 'BLE-CONNECTED';
    this.telemetry.operating_state = initialTele?.operating_state || 'IDLE';
    this.telemetry.state_name = OperatingStateDisplayNames[this.telemetry.operating_state] || 'Standby / Idle';
    this.telemetry.live_temp_f = initialTele?.live_temp_f ?? null;
    this.telemetry.chamber_name = this.isProxy ? 'Proxy' : null;
    this._notifyListeners();

    console.log(`[PuffcoBLE] Connected to ${devName} (${this.isProxy ? 'Proxy' : 'Peak Pro'})! Initializing full session...`);

    // Complete session initialization
    this._initSession().catch((err) => {
      console.warn('[PuffcoBLE] Session initialization note:', err);
    });

    return true;
  }

  async _readInitialTelemetry() {
    let hasData = false;

    // 1. Probe state ID: /p/app/stat/id
    const stBytes = await this.readPath(PATH_STATE_ID, 1);
    let opState = 'IDLE';
    if (stBytes && stBytes.length > 0) {
      hasData = true;
      opState = OperatingStateNames[stBytes[0]] || 'IDLE';
    }

    // 2. Probe chamber temperature via dual-path detection
    const tempF = await this._readChamberTemp();
    if (tempF !== null) {
      hasData = true;
    }

    if (!hasData) {
      return null;
    }

    return {
      operating_state: opState,
      live_temp_f: tempF,
    };
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
        targetDevice = devices.find((d) => d.name && /puffco|peak|proxy|pivot|puff/i.test(d.name)) || devices[0];
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
    // 1. Query device info (serial, firmware) over Lorax VFS
    await this._pollDeviceInfo();

    // 2. Poll fast telemetry (operating state, live chamber temp)
    await this._pollFastTelemetry();
    this._notifyListeners();

    // 3. Poll slow diagnostics (VFS name, battery SOC, charging, chamber type, profiles, dabs)
    await this._pollSlowDiagnostics(true);

    if (this.isProxy) {
      this.telemetry.is_proxy = true;
      this.telemetry.device_model = 'Proxy';
      if (!this.telemetry.chamber_name || this.telemetry.chamber_name === 'None') {
        this.telemetry.chamber_name = 'Proxy';
      }
    }

    // Telemetry initial sync is now complete!
    this.telemetry.is_syncing = false;
    this.telemetry.state_name = OperatingStateDisplayNames[this.telemetry.operating_state] || 'Standby / Idle';
    this._notifyListeners();

    // 4. Start background telemetry polling stream
    this._startTelemetryStream();
    console.log(`[PuffcoBLE] Session initialization complete for ${this.telemetry.device_name} (${this.isProxy ? 'Proxy' : 'Peak Pro'})!`);
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
    const wasHeating = !!(this.telemetry && (this.telemetry.is_heating || ['HEAT_PREHEAT', 'HEAT_ACTIVE', 'READY'].includes(this.telemetry.operating_state)));
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
    this._notifyDisconnectListeners({ wasConnected, isIntentional, wasHeating });
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

    if (this._needResp) {
      if (typeof this.cmdChar.writeValueWithResponse === 'function') {
        return await this.cmdChar.writeValueWithResponse(frame);
      }
      return await this.cmdChar.writeValue(frame);
    }

    // 1. Try writeValueWithoutResponse (standard modern Web Bluetooth)
    if (typeof this.cmdChar.writeValueWithoutResponse === 'function') {
      try {
        await this.cmdChar.writeValueWithoutResponse(frame);
        return;
      } catch (e) {
        if (e && e.name === 'NotSupportedError') {
          this._needResp = true;
          if (typeof this.cmdChar.writeValueWithResponse === 'function') {
            return await this.cmdChar.writeValueWithResponse(frame);
          }
          return await this.cmdChar.writeValue(frame);
        }
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

  async _sendLoraxCmd(opcode, payload = new Uint8Array(0), timeoutMs = 3000) {
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

  /**
   * Dual-path chamber temperature reader.
   * Peak Pro keeps bowl temp at /p/app/htr/temp; some Proxy firmware keeps it at /p/htr/temp.
   */
  async _readChamberTemp() {
    let raw = null;
    if (this._htrPath !== PATH_ALT_CHAMBER_TEMP) {
      try {
        raw = await this.readPath(PATH_CHAMBER_TEMP, 4);
        if (raw && raw.length >= 4) {
          const t = this._decTemp(raw);
          if (t !== null && t > 0) {
            this._htrPath = PATH_CHAMBER_TEMP;
            return t;
          }
        }
      } catch (e) {
        this._htrPath = PATH_ALT_CHAMBER_TEMP;
      }
    }

    try {
      raw = await this.readPath(PATH_ALT_CHAMBER_TEMP, 4);
      if (raw && raw.length >= 4) {
        const t = this._decTemp(raw);
        if (t !== null && t > 0) {
          this._htrPath = PATH_ALT_CHAMBER_TEMP;
          return t;
        }
      }
    } catch (e) {}

    return null;
  }

  _decTemp(bytes) {
    if (!bytes || bytes.length < 4) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const f = dv.getFloat32(0, true);
    if (this._tfmt !== 'i10' && isFinite(f) && f > -80 && f < 520 && !(f !== 0 && Math.abs(f) < 1e-3)) {
      if (!this._tfmt && f !== 0) this._tfmt = 'f32';
      return Math.round(cToF(f) * 10) / 10;
    }
    const i = dv.getInt32(0, true);
    if (Math.abs(i) <= 6000) {
      if (!this._tfmt && i !== 0) this._tfmt = 'i10';
      return Math.round(cToF(i / 10.0) * 10) / 10;
    }
    return null;
  }

  // ---------------- Telemetry & Diagnostics ----------------

  async _pollDeviceInfo() {
    // 1. Read firmware version via Lorax VFS: /p/sys/fw/ver (1 byte, decoded with fwString)
    try {
      const fwBytes = await this.readPath(PATH_SYS_FW_VER, 1);
      if (fwBytes && fwBytes.length > 0) {
        this.telemetry.firmware_version = fwString(fwBytes[0]);
      }
    } catch (e) {}

    // 2. Read hardware serial number via Lorax VFS: /p/sys/hw/ser (string)
    try {
      const serBytes = await this.readPath(PATH_SYS_HW_SER, 32);
      if (serBytes && serBytes.length > 0) {
        const serStr = decodeUtf8(serBytes).trim();
        if (serStr) this.telemetry.serial_number = serStr;
      }
    } catch (e) {}
  }

  async _pollSlowDiagnostics(forceProfiles = false) {
    try {
      // 0. VFS Device Name
      const nameBytes = await this.readPath(PATH_DEVICE_NAME, 32);
      if (nameBytes.length > 0) {
        const cleanName = decodeUtf8(nameBytes).trim();
        if (cleanName) {
          this.telemetry.device_name = cleanName;
        }
      }

      // Check name for Proxy/Pivot
      if (/prox|pivot/i.test(this.telemetry.device_name || '') || /prox|pivot/i.test(this.device?.name || '')) {
        this.isProxy = true;
        this.telemetry.is_proxy = true;
        this.telemetry.device_model = 'Proxy';
      }

      // 1. Battery SOC
      const socBytes = await this.readPath(PATH_BATTERY_SOC, 4);
      if (socBytes.length > 0) {
        this.telemetry.battery_pct = parseBatteryBytes(socBytes);
      }

      // 2. Battery Charging Status
      const chgBytes = await this.readPath(PATH_BATTERY_CHARGE_STAT, 1);
      if (chgBytes.length > 0) {
        // In Lorax VFS: <= 1 means charging (0 or 1), > 1 is discharging/disconnected
        this.telemetry.is_charging = chgBytes[0] <= 1;
      }

      // 3. Chamber Type
      const chmtBytes = await this.readPath(PATH_CHAMBER_TYPE, 1);
      if (chmtBytes.length > 0) {
        const cType = chmtBytes[0];
        if (cType === 4 || cType === 5) {
          this.isProxy = true;
          this.telemetry.is_proxy = true;
          this.telemetry.device_model = 'Proxy';
          this.telemetry.chamber_name = 'Proxy';
          this.telemetry.chamber_type = 'PROXY';
        } else if (cType === 2) {
          this.telemetry.chamber_name = '3DXL';
          this.telemetry.chamber_type = 'CHAMBER_3DXL';
        } else if (cType === 3) {
          this.telemetry.chamber_name = '3D';
          this.telemetry.chamber_type = 'CHAMBER_3D';
        } else if (cType === 1) {
          this.telemetry.chamber_name = 'Standard';
          this.telemetry.chamber_type = 'STANDARD';
        } else {
          this.telemetry.chamber_name = 'None';
          this.telemetry.chamber_type = 'NONE';
        }
      } else if (this.isProxy) {
        this.telemetry.chamber_name = 'Proxy';
        this.telemetry.chamber_type = 'PROXY';
      }

      // 4. Lifetime Dabs Odometer (with Proxy fallback to /p/app/info/dtot)
      let odomBytes = await this.readPath(PATH_ODOMETER_DABS, 12);
      if (!odomBytes || odomBytes.length < 4) {
        odomBytes = await this.readPath(PATH_INFO_DTOT, 4);
      }
      if (odomBytes && odomBytes.length >= 4) {
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
    const activeSlotBytes = await this.readPath(PATH_ACTIVE_PROFILE, 1);
    if (activeSlotBytes.length > 0) {
      this.telemetry.active_profile = activeSlotBytes[0];
    }

    const profiles = [];
    const detectedTfmts = [];
    const detectedTimeFmts = [];

    for (let slot = 0; slot < 4; slot++) {
      let name = `Profile ${slot + 1}`;
      let tempF = 485;
      let durS = 50;

      // Name
      const nameBytes = await this.readPath(PATH_PROFILE_NAME_PREFIX.replace('{slot}', slot), 32);
      if (nameBytes.length > 0) {
        const decoded = decodeUtf8(nameBytes).trim();
        if (decoded) name = decoded;
      }

      // Temp
      const tempBytes = await this.readPath(PATH_PROFILE_TEMP_PREFIX.replace('{slot}', slot), 4);
      if (tempBytes.length >= 4) {
        const dv = new DataView(tempBytes.buffer, tempBytes.byteOffset, 4);
        const f = dv.getFloat32(0, true);
        const n = dv.getInt32(0, true);
        if (isFinite(f) && f >= 150 && f <= 400) {
          detectedTfmts.push('f32');
          tempF = Math.round(cToF(f));
        } else if (n >= 1500 && n <= 4000) {
          detectedTfmts.push('i10');
          tempF = Math.round(cToF(n / 10.0));
        } else {
          const parsed = parseTempBytes(tempBytes);
          if (parsed > 0) tempF = Math.round(parsed);
        }
      }

      // Duration
      const durBytes = await this.readPath(PATH_PROFILE_TIME_PREFIX.replace('{slot}', slot), 4);
      if (durBytes.length >= 4) {
        const dv = new DataView(durBytes.buffer, durBytes.byteOffset, 4);
        const f = dv.getFloat32(0, true);
        const u = dv.getUint32(0, true);
        const fl = isFinite(f) && f >= 0 && f < 1e7 && !(f !== 0 && Math.abs(f) < 1e-3);

        // Check which unit fits a realistic dab duration (10s to 180s)
        if (fl && f >= 10 && f <= 180) {
          detectedTimeFmts.push('f32');
          durS = Math.round(f);
        } else if (!fl && u >= 1000 && u <= 18000) {
          // Centiseconds (e.g. 50s = 5000, 80s = 8000)
          detectedTimeFmts.push('cs');
          durS = Math.round(u / 100);
        } else if (!fl && u >= 10000 && u <= 180000) {
          // Milliseconds
          detectedTimeFmts.push('ms');
          durS = Math.round(u / 1000);
        } else if (!fl && u >= 10 && u <= 180) {
          // Seconds uint32
          detectedTimeFmts.push('u32');
          durS = Math.round(u);
        } else {
          const raw = parseDabsBytes(durBytes);
          durS = parseDurationSeconds(raw);
        }
      }

      profiles.push({ slot, name, target_temp_f: tempF, duration_s: durS });
    }

    // Set learned formats if clear consensus exists across profiles
    if (detectedTfmts.length > 0) {
      const f32Count = detectedTfmts.filter((x) => x === 'f32').length;
      const i10Count = detectedTfmts.filter((x) => x === 'i10').length;
      this.hctfmt = i10Count > f32Count ? 'i10' : 'f32';
    }
    if (detectedTimeFmts.length > 0) {
      const csCount = detectedTimeFmts.filter((x) => x === 'cs').length;
      const f32Count = detectedTimeFmts.filter((x) => x === 'f32').length;
      const msCount = detectedTimeFmts.filter((x) => x === 'ms').length;
      if (csCount >= f32Count && csCount >= msCount) this.timefmt = 'cs';
      else if (msCount >= f32Count && msCount >= csCount) this.timefmt = 'ms';
      else if (f32Count > 0) this.timefmt = 'f32';
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

  setDeviceKind(kind, force = false) {
    if (this.isConnected && !force) {
      console.warn('[PuffcoBLE] Device choice is locked in while connected for hardware safety. Disconnect first to change.');
      return false;
    }
    const isProxy = kind === 'proxy';
    this.isProxy = isProxy;
    this.chosenKind = isProxy ? 'proxy' : 'peak';
    this.telemetry.is_proxy = isProxy;
    this.telemetry.device_model = isProxy ? 'Proxy' : 'Peak Pro';
    if (isProxy) {
      if (!this.telemetry.chamber_name || this.telemetry.chamber_name === 'None' || this.telemetry.chamber_name === '3DXL') {
        this.telemetry.chamber_name = 'Proxy';
        this.telemetry.chamber_type = 'PROXY';
      }
    } else {
      if (this.telemetry.chamber_name === 'Proxy') {
        this.telemetry.chamber_name = '3DXL';
        this.telemetry.chamber_type = 'CHAMBER_3DXL';
      }
    }
    this._tfmt = null;
    this.hctfmt = null;
    this.timefmt = null;
    if (this.device?.id) {
      try {
        localStorage.setItem('puff_devkind_' + this.device.id, kind);
      } catch (e) {}
    }
    try {
      localStorage.setItem('puff_device_choice', kind);
      localStorage.setItem('puff_devkind_pref', kind);
    } catch (e) {}
    this._notifyListeners();
    return true;
  }

  async _pollFastTelemetry() {
    const prevState = this.telemetry.operating_state;

    // 1. Operating State
    const stBytes = await this.readPath(PATH_STATE_ID, 1);
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

    // 2. Chamber Temperature & Watchdog via dual-path detection
    const tF = await this._readChamberTemp();
    if (tF !== null && tF > 0.0) {
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
    } else if (this.telemetry.is_heating) {
      // Stale Telemetry Watchdog (Deadman Switch)
      if (this._lastTempTimestamp && (Date.now() - this._lastTempTimestamp > 4000)) {
        console.error('[PuffcoBLE] STALE TELEMETRY WATCHDOG: Chamber temperature telemetry lost for > 4.0s during active heat! Triggering safety abort.');
        this.telemetry.active_curve_running = false;
        this.stopSession(true).catch((err) => console.error('Stale telemetry abort error:', err));
        this._stateListeners.forEach((cb) => {
          try { cb('TELEMETRY_LOSS'); } catch (e) {}
        });
      }
    }

    // 3. Session Countdown Timer (skip during custom curve to minimize BLE bus latency)
    if (isHeating && !this.telemetry.active_curve_running) {
      const elapBytes = await this.readPath(PATH_TIME_ELAPSED, 4);
      const tottBytes = await this.readPath(PATH_TIME_TOTAL, 4);
      if (elapBytes.length >= 4 && tottBytes.length >= 4) {
        const viewElap = new DataView(elapBytes.buffer, elapBytes.byteOffset, elapBytes.byteLength);
        const viewTott = new DataView(tottBytes.buffer, tottBytes.byteOffset, tottBytes.byteLength);

        let elap = viewElap.getFloat32(0, true);
        let tott = viewTott.getFloat32(0, true);
        if (isNaN(elap) || !isFinite(elap) || (elap !== 0 && Math.abs(elap) < 1e-3)) elap = viewElap.getUint32(0, true);
        if (isNaN(tott) || !isFinite(tott) || (tott !== 0 && Math.abs(tott) < 1e-3)) tott = viewTott.getUint32(0, true);

        // Normalize time units (seconds vs centiseconds vs milliseconds)
        if (tott > 300) {
          if (this.timefmt === 'cs' || (tott >= 500 && tott <= 30000)) {
            tott /= 100.0;
            elap /= 100.0;
          } else if (this.timefmt === 'ms' || tott > 30000) {
            tott /= 1000.0;
            elap /= 1000.0;
          } else if (this.timefmt === 't5') {
            tott /= 200.0;
            elap /= 200.0;
          }
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

    const isProxy = this.isProxy || (this.telemetry.device_name || '').toLowerCase().includes('proxy') || this.telemetry.chamber_type === 'PROXY';
    const cVal = fToC(tempF);

    // Format encoding:
    // Proxy hardware often requires int32 LE tenths of °C (e.g. 251.7°C -> 2517)
    // Peak Pro hardware requires float32 LE Celsius
    const encodeTemp = (fmt, c) => {
      const b = new Uint8Array(4);
      const dv = new DataView(b.buffer);
      if (fmt === 'i10') {
        dv.setInt32(0, Math.round(c * 10.0), true);
      } else {
        dv.setFloat32(0, c, true);
      }
      return b;
    };

    const primaryFormat = this.hctfmt || (isProxy ? 'i10' : 'f32');
    const fallbackFormat = primaryFormat === 'i10' ? 'f32' : 'i10';

    const path = PATH_PROFILE_TEMP_PREFIX.replace('{slot}', slot);
    let ok = await this.writePath(path, encodeTemp(primaryFormat, cVal));
    if (!ok) {
      console.warn(`[PuffcoBLE] Primary temp write format (${primaryFormat}) rejected, trying fallback (${fallbackFormat})...`);
      ok = await this.writePath(path, encodeTemp(fallbackFormat, cVal));
      if (ok) this.hctfmt = fallbackFormat;
    } else {
      this.hctfmt = primaryFormat;
    }

    if (ok) {
      this.telemetry.target_temp_f = tempF;
      if (this.telemetry.profiles && this.telemetry.profiles[slot]) {
        this.telemetry.profiles[slot].target_temp_f = tempF;
      }
      // Re-assert active profile to update live PID register
      await this.writePath(PATH_ACTIVE_PROFILE, new Uint8Array([slot]));

      // If heating, also write to live session target /p/app/thc/temp
      if (this.telemetry.is_heating) {
        try {
          await this.writePath(PATH_LIVE_TARGET_TEMP, encodeTemp(this.hctfmt, cVal));
        } catch (_) {}
      }

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

    const isProxy = this.isProxy || (this.telemetry.device_name || '').toLowerCase().includes('proxy') || this.telemetry.chamber_type === 'PROXY';

    const encodeDur = (fmt, s) => {
      const b = new Uint8Array(4);
      const dv = new DataView(b.buffer);
      if (fmt === 'cs') {
        dv.setUint32(0, Math.round(s * 100), true);
      } else if (fmt === 'ms') {
        dv.setUint32(0, Math.round(s * 1000), true);
      } else if (fmt === 't5') {
        dv.setUint32(0, Math.round(s * 200), true);
      } else if (fmt === 'u32') {
        dv.setUint32(0, Math.round(s), true);
      } else {
        dv.setFloat32(0, Number(s), true);
      }
      return b;
    };

    const primaryFormat = this.timefmt || (isProxy ? 'cs' : 'f32');
    const fallbackFormat = primaryFormat === 'cs' ? 'f32' : 'cs';

    const path = PATH_PROFILE_TIME_PREFIX.replace('{slot}', slot);
    let ok = await this.writePath(path, encodeDur(primaryFormat, durationS));
    if (!ok) {
      console.warn(`[PuffcoBLE] Primary duration write format (${primaryFormat}) rejected, trying fallback (${fallbackFormat})...`);
      ok = await this.writePath(path, encodeDur(fallbackFormat, durationS));
      if (ok) this.timefmt = fallbackFormat;
    } else {
      this.timefmt = primaryFormat;
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
    if (enabled && this.telemetry.lantern_active) {
      await this.setLanternMode(false);
    }
    const ok = await this.writePath(PATH_STEALTH_MODE, new Uint8Array([enabled ? 1 : 0]));
    if (ok) {
      this.telemetry.stealth_mode = !!enabled;
      this._notifyListeners();
    }
    return ok;
  }

  async setLanternMode(enabled) {
    if (enabled && this.telemetry.stealth_mode) {
      await this.setStealthMode(false);
    }
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
window.fToC = fToC;
window.cToF = cToF;
