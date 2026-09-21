/**
 * Puff Studio — Standalone Web Bluetooth BLE Driver for Puffco Devices
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
const PATH_ACTIVE_PROFILE = '/p/app/hcs';
const PATH_PROFILE_TEMP_PREFIX = '/u/app/hc/{slot}/temp';
const PATH_PROFILE_TIME_PREFIX = '/u/app/hc/{slot}/time';
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
  if (bytes.length >= 4) {
    const iVal = view.getUint32(0, true);
    if (iVal <= 100) return iVal;
    if (iVal > 100 && iVal <= 10000) return Math.round(iVal / 100.0);
    try {
      const fVal = view.getFloat32(0, true);
      if (fVal >= 1.0 && fVal <= 100.0) return Math.round(fVal);
    } catch (e) {}
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

    this._streaming = false;
    this._stopGuardUntil = 0;
    this._wakeLock = null;
    this._cmdQueue = Promise.resolve();

    this.telemetry = this._defaultTelemetry();
  }

  _defaultTelemetry() {
    return {
      connected: false,
      device_name: 'Puffco Device',
      mac_address: '',
      serial_number: '',
      firmware_version: '',
      operating_state: 'DISCONNECTED',
      state_name: 'Disconnected',
      live_temp_f: 0.0,
      target_temp_f: 485.0,
      time_remaining: 0,
      total_time: 45,
      battery_pct: 0,
      is_charging: false,
      is_heating: false,
      chamber_type: 'STANDARD',
      chamber_name: 'Standard',
      lifetime_dabs: 0,
      stealth_mode: false,
      lantern_active: false,
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
    ];

    console.log('[PuffcoBLE] Requesting Bluetooth Device (acceptAllDevices: true)...');

    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices,
      });
    } catch (err) {
      if (err.name === 'NotFoundError' || err.message?.includes('User cancelled') || err.message?.includes('cancelled')) {
        throw new Error('No device selected. Pairing was cancelled.');
      }
      throw err;
    }

    if (!this.device) {
      throw new Error('No device selected.');
    }

    this.device.addEventListener('gattserverdisconnected', () => {
      this._onDisconnected();
    });

    const devName = this.device.name || 'Puffco Device';
    console.log(`[PuffcoBLE] Connecting to GATT server (${devName})...`);
    this.server = await this.device.gatt.connect();

    // Discover Lorax Service
    console.log('[PuffcoBLE] Discovering Lorax Service...');
    try {
      this.loraxService = await this.server.getPrimaryService(PUFFCO_LORAX_SVC_UUID);
    } catch (e) {
      console.warn('[PuffcoBLE] Direct Lorax lookup failed, scanning all primary services...', e);
      try {
        const services = await this.server.getPrimaryServices();
        for (const s of services) {
          if (s.uuid.toLowerCase() === PUFFCO_LORAX_SVC_UUID.toLowerCase()) {
            this.loraxService = s;
            break;
          }
        }
      } catch (scanErr) {
        console.warn('[PuffcoBLE] Error scanning primary services:', scanErr);
      }
    }

    if (!this.loraxService) {
      throw new Error(
        `Selected device "${devName}" is not a Puffco device (Lorax service not found). Please ensure you select your Puffco Peak Pro or Proxy.`
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

    // Get Command & Reply Characteristics
    this.cmdChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_CMD);
    this.replyChar = await this.loraxService.getCharacteristic(PUFFCO_LORAX_CHAR_REPLY);

    // Setup Lorax reply notifications
    console.log('[PuffcoBLE] Subscribing to Lorax replies...');
    await this.replyChar.startNotifications();

    const replyHandler = (evt) => this._onLoraxNotification(evt);
    this.replyChar.addEventListener('characteristicvaluechanged', replyHandler);
    this.replyChar.oncharacteristicvaluechanged = replyHandler;

    // Small delay to allow CCCD descriptor write to settle on peripheral
    await new Promise((r) => setTimeout(r, 120));

    // CRITICAL: Immediately mark connected and notify listeners so the web UI updates instantly!
    this.isConnected = true;
    this.telemetry.connected = true;
    this.telemetry.device_name = devName;
    this.telemetry.mac_address = this.device.id ? this.device.id.slice(0, 17).toUpperCase() : 'BLE-CONNECTED';
    this.telemetry.operating_state = 'IDLE';
    this.telemetry.state_name = 'Standby / Idle';
    this._notifyListeners();

    console.log(`[PuffcoBLE] Successfully connected to ${devName}! Initializing session in background...`);

    // Kick off authentication and initial diagnostics asynchronously (non-blocking)
    this._initSession().catch((err) => {
      console.warn('[PuffcoBLE] Session initialization note:', err);
    });

    return true;
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
    this._notifyListeners();

    // 5. Start background telemetry polling stream
    this._startTelemetryStream();
    console.log(`[PuffcoBLE] Session initialization complete for ${this.telemetry.device_name}!`);
  }

  async disconnect() {
    this._streaming = false;
    await this._releaseWakeLock();

    if (this.device && this.device.gatt && this.device.gatt.connected) {
      try {
        this.device.gatt.disconnect();
      } catch (e) {}
    }
    this._onDisconnected();
  }

  _onDisconnected() {
    console.warn('[PuffcoBLE] GATT disconnected.');
    this.isConnected = false;
    this._streaming = false;
    this._releaseWakeLock();

    // Reject any pending replies
    this._pendingReplies.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Device disconnected'));
    });
    this._pendingReplies.clear();

    this.telemetry = this._defaultTelemetry();
    this._notifyListeners();
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

    // 2. Chamber Temperature
    const tempBytes = await this.readPath(PATH_CHAMBER_TEMP);
    if (tempBytes.length > 0) {
      const tF = parseTempBytes(tempBytes);
      if (tF > 0.0) {
        this.telemetry.live_temp_f = tF;
        // CRITICAL SAFETY CUTOFF: Auto shut off any session if chamber exceeds 600°F
        if (tF >= 600.0 && this.telemetry.is_heating) {
          console.error(`[EMERGENCY SAFETY CUTOFF] Chamber temperature (${tF.toFixed(1)}°F) exceeded 600°F! Aborting session immediately!`);
          this.telemetry.active_curve_running = false;
          this.stopSession().catch((err) => console.error('Emergency abort error:', err));
          this._stateListeners.forEach((cb) => {
            try { cb('EMERGENCY_OVERHEAT'); } catch (e) {}
          });
        }
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

  // ---------------- Hardware Commands ----------------

  async startSession() {
    if (this.telemetry.live_temp_f >= 600.0) {
      throw new Error('Cannot start session: Chamber temperature is above 600°F safety limit');
    }
    const success = await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x07]));
    if (success) {
      this.telemetry.operating_state = 'HEAT_PREHEAT';
      this.telemetry.state_name = 'Preheating';
      this.telemetry.is_heating = true;
      this._notifyListeners();
    }
    return success;
  }

  async stopSession() {
    this._stopGuardUntil = Date.now() + 2500;
    const success = await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x08]));
    this.telemetry.operating_state = 'IDLE';
    this.telemetry.state_name = 'Standby / Idle';
    this.telemetry.is_heating = false;
    this.telemetry.time_remaining = 0;
    this.telemetry.active_curve_running = false;
    this._notifyListeners();
    return success;
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
    // Hard safety clamp: Never permit target setpoint to exceed 590°F
    tempF = Math.min(590.0, Math.max(350.0, Number(tempF)));
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

  async setStealthMode(enabled) {
    const ok = await this.writePath(PATH_STEALTH_MODE, new Uint8Array([enabled ? 1 : 0]));
    if (ok) {
      this.telemetry.stealth_mode = !!enabled;
      this._notifyListeners();
    }
    return ok;
  }

  async setLanternMode(enabled) {
    const ok = await this.writePath(PATH_LANTERN_CMD, new Uint8Array([enabled ? 1 : 0]));
    if (ok) {
      this.telemetry.lantern_active = !!enabled;
      this._notifyListeners();
    }
    return ok;
  }

  async enterSleepMode() {
    return await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x01]));
  }

  async powerOff() {
    return await this.writePath(PATH_MODE_CONTROL, new Uint8Array([0x02]));
  }
}

// Global export
window.PuffcoBleClient = PuffcoBleClient;
