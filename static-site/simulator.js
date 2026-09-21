/**
 * Puff Studio — Offline Hardware Simulator & Demo Engine
 * Emulates physical chamber thermal dynamics, PID heating loops,
 * and Puffco operating state machines with zero physical hardware.
 */

class PuffcoSimulator {
  constructor() {
    this.isConnected = false;
    this.isDemo = true;
    this._listeners = new Set();
    this._stateListeners = new Set();
    this._loopTimer = null;
    this._wakeLock = null;

    this.telemetry = {
      connected: false,
      device_name: 'SAMS PEAK (Demo)',
      mac_address: 'DEMO-F711-95C5-149B',
      serial_number: 'PK2026-DEMO',
      firmware_version: 'V1.3.8',
      operating_state: 'DISCONNECTED',
      state_name: 'Disconnected',
      live_temp_f: 78.5,
      target_temp_f: 485.0,
      time_remaining: 0,
      total_time: 50,
      battery_pct: 84,
      is_charging: false,
      is_heating: false,
      chamber_type: 'CHAMBER_3DXL',
      chamber_name: '3DXL',
      lifetime_dabs: 443,
      stealth_mode: false,
      lantern_active: false,
      active_profile: 1,
      profiles: [
        { slot: 0, name: 'Low', target_temp_f: 480, duration_s: 50 },
        { slot: 1, name: 'Medium', target_temp_f: 485, duration_s: 60 },
        { slot: 2, name: 'High', target_temp_f: 530, duration_s: 40 },
        { slot: 3, name: 'ROSIN', target_temp_f: 465, duration_s: 90 },
      ],
      is_demo: true,
      active_curve_running: false,
    };
  }

  isWebBluetoothSupported() {
    return true; // Always supported for demo
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
      try { cb(data); } catch (e) {}
    });
  }

  async connect() {
    this.isConnected = true;
    this.telemetry.connected = true;
    this.telemetry.operating_state = 'IDLE';
    this.telemetry.state_name = 'Standby / Idle';
    this.telemetry.is_heating = false;
    this._startLoop();
    this._notifyListeners();
    return true;
  }

  async disconnect() {
    this.isConnected = false;
    this._stopLoop();
    this.telemetry.connected = false;
    this.telemetry.operating_state = 'DISCONNECTED';
    this.telemetry.state_name = 'Disconnected';
    this.telemetry.is_heating = false;
    this._notifyListeners();
  }

  _startLoop() {
    if (this._loopTimer) clearInterval(this._loopTimer);
    this._loopTimer = setInterval(() => this._tick(), 200);
  }

  _stopLoop() {
    if (this._loopTimer) {
      clearInterval(this._loopTimer);
      this._loopTimer = null;
    }
  }

  _tick() {
    if (!this.isConnected) return;

    const t = this.telemetry;
    const target = t.target_temp_f;
    const prevState = t.operating_state;

    if (t.operating_state === 'HEAT_PREHEAT') {
      t.is_heating = true;
      const diff = target - t.live_temp_f;
      const step = Math.max(5.5, diff * 0.22);
      t.live_temp_f = Math.round(Math.min(target, t.live_temp_f + step) * 10) / 10;

      if (t.live_temp_f >= target - 2.0) {
        t.operating_state = 'READY';
        t.state_name = 'Ready to Inhale';
        t.time_remaining = t.total_time;
      }
    } else if (t.operating_state === 'READY' || t.operating_state === 'HEAT_ACTIVE') {
      t.is_heating = true;
      // PID tracking with subtle ambient noise
      const diff = target - t.live_temp_f;
      const noise = (Math.random() - 0.5) * 0.8;
      t.live_temp_f = Math.round((t.live_temp_f + diff * 0.25 + noise) * 10) / 10;

      // Timer countdown (every 1 second approx)
      if (Math.random() < 0.2) {
        t.time_remaining = Math.max(0, t.time_remaining - 1);
        if (t.time_remaining <= 0) {
          t.operating_state = 'COOLDOWN';
          t.state_name = 'Cooling Down';
          t.lifetime_dabs += 1;
          t.is_heating = false;
        }
      }
    } else if (t.operating_state === 'COOLDOWN') {
      t.is_heating = false;
      if (t.live_temp_f > 78.5) {
        t.live_temp_f = Math.round(Math.max(78.5, t.live_temp_f - 4.5) * 10) / 10;
      } else {
        t.operating_state = 'IDLE';
        t.state_name = 'Standby / Idle';
      }
    } else if (t.operating_state === 'IDLE') {
      t.is_heating = false;
      if (t.live_temp_f > 78.5) {
        t.live_temp_f = Math.round(Math.max(78.5, t.live_temp_f - 1.5) * 10) / 10;
      }
    }

    if (t.operating_state !== prevState) {
      this._stateListeners.forEach((cb) => {
        try { cb(t.operating_state); } catch (e) {}
      });
    }

    this._notifyListeners();
  }

  async startSession() {
    this.telemetry.operating_state = 'HEAT_PREHEAT';
    this.telemetry.state_name = 'Preheating';
    this.telemetry.is_heating = true;
    this._notifyListeners();
    return true;
  }

  async stopSession() {
    this.telemetry.operating_state = 'IDLE';
    this.telemetry.state_name = 'Standby / Idle';
    this.telemetry.time_remaining = 0;
    this.telemetry.is_heating = false;
    this._notifyListeners();
    return true;
  }

  async boostSession() {
    if (this.telemetry.is_heating) {
      this.telemetry.time_remaining = Math.min(120, this.telemetry.time_remaining + 15);
      this.telemetry.target_temp_f = Math.min(600, this.telemetry.target_temp_f + 10);
      this._notifyListeners();
      return true;
    }
    return false;
  }

  async setProfile(slot) {
    if (slot >= 0 && slot < this.telemetry.profiles.length) {
      this.telemetry.active_profile = slot;
      const p = this.telemetry.profiles[slot];
      this.telemetry.target_temp_f = p.target_temp_f;
      this.telemetry.total_time = p.duration_s;
      this._notifyListeners();
      return true;
    }
    return false;
  }

  async writeTemperature(tempF, slot = null) {
    if (slot === null) slot = this.telemetry.active_profile;
    this.telemetry.target_temp_f = tempF;
    if (this.telemetry.profiles[slot]) {
      this.telemetry.profiles[slot].target_temp_f = tempF;
    }
    this._notifyListeners();
    return true;
  }

  async writeDuration(durS, slot = null) {
    if (slot === null) slot = this.telemetry.active_profile;
    this.telemetry.total_time = durS;
    if (this.telemetry.profiles[slot]) {
      this.telemetry.profiles[slot].duration_s = durS;
    }
    this._notifyListeners();
    return true;
  }

  async setStealthMode(enabled) {
    this.telemetry.stealth_mode = !!enabled;
    this._notifyListeners();
    return true;
  }

  async setLanternMode(enabled) {
    this.telemetry.lantern_active = !!enabled;
    this._notifyListeners();
    return true;
  }

  async enterSleepMode() {
    this.telemetry.operating_state = 'SLEEP';
    this.telemetry.state_name = 'Sleep Mode';
    this.telemetry.is_heating = false;
    this._notifyListeners();
    return true;
  }

  async powerOff() {
    this.telemetry.operating_state = 'OFF';
    this.telemetry.state_name = 'Powered Off';
    this.telemetry.is_heating = false;
    this._notifyListeners();
    return true;
  }
}

// Global export
window.PuffcoSimulator = PuffcoSimulator;
