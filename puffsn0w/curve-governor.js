/**
 * puffsn0w — Real-Time Host-Side Thermal Curve Governor
 * Executes piecewise linear heat curves against hardware or simulator at 2 Hz.
 * Handles preheat synchronization, live setpoint modulation, and profile flash safety.
 */

class CurveGovernor {
  constructor(deviceClient) {
    this.client = deviceClient;
    this.isActive = false;
    this.activeCurve = null;
    this._timer = null;
    this._listeners = new Set();
    this._backupProfile = null;

    // Loss-of-Link Deadman Safeguard: Immediately abort if BLE connection drops
    this._disconnectHandler = () => {
      if (this.isActive) {
        console.warn('[Governor] BLE connection lost during active curve execution! Halting governor immediately.');
        this.isActive = false;
        if (this.client?.telemetry) {
          this.client.telemetry.active_curve_running = false;
        }
        this._broadcast({
          is_active: false,
          status: 'connection_lost',
          error: 'Bluetooth disconnected during heat cycle',
        });
      }
    };
  }

  addCurveListener(cb) {
    this._listeners.add(cb);
  }

  removeCurveListener(cb) {
    this._listeners.delete(cb);
  }

  _broadcast(data) {
    this._listeners.forEach((cb) => {
      try { cb(data); } catch (e) { console.error(e); }
    });
  }

  async run(curve) {
    if (this.isActive) return false;
    if (!this.client || !this.client.isConnected) {
      throw new Error('Device is not connected');
    }

    const keyframes = curve.keyframes || [];
    if (keyframes.length < 2) {
      throw new Error('Curve must contain at least 2 keyframes');
    }

    this.isActive = true;
    this.activeCurve = curve;
    if (this.client.telemetry) {
      this.client.telemetry.active_curve_running = true;
    }

    // Attach link loss listener to halt governor if connection drops
    if (typeof this.client.addDisconnectListener === 'function') {
      this.client.addDisconnectListener(this._disconnectHandler);
    }

    const cid = curve.id;
    const cname = curve.name;
    // Hard duration cap at 120 seconds for safety
    const durationS = Math.min(120, Math.max(15, Number(curve.duration_s || keyframes[keyframes.length - 1].time_s || 50)));
    const initialTemp = Math.min(590, Math.max(350, Number(keyframes[0].temp_f || 485)));

    // Dedicated Curve Slot: Use Slot 3 (4th slot / Easter Egg) by default to protect user Profiles 0, 1, and 2
    const useDedicatedSlot = window.puffSafetySettings ? window.puffSafetySettings.dedicatedCurveSlot !== false : true;
    const origActiveSlot = Number(this.client.telemetry.active_profile ?? 0);
    const slot = useDedicatedSlot ? 3 : origActiveSlot;

    console.log(`[Governor] Starting curve "${cname}" (${durationS}s) on profile slot ${slot} (dedicatedSlot=${useDedicatedSlot})...`);

    // 1. Backup existing profile settings
    const activeProf = (this.client.telemetry.profiles && this.client.telemetry.profiles[slot]) || {};
    this._backupProfile = {
      slot,
      target_temp_f: activeProf.target_temp_f || this.client.telemetry.target_temp_f || 485,
      duration_s: activeProf.duration_s || 50,
      origActiveSlot,
      raw: null,
    };

    const fail = async (msg) => {
      console.error(`[Governor] ${msg}`);
      if (this.client.telemetry) this.client.telemetry.active_curve_running = false;
      await this._restoreProfile();
      this.isActive = false;
      this._broadcast({ is_active: false, status: 'aborted', phase: 'preheating', error: msg });
      throw new Error(msg);
    };

    // 1a. Proxy whose heat-time unit isn't known yet: give the app a few seconds to time its clock first
    //     (once per device), so the curve's own length is written instead of a stand-in the Proxy may cut short.
    if (typeof this.client.waitForTimeUnit === 'function' && !this.client.timefmt &&
        (this.client.isProxy || this.client.tUnsure)) {
      console.log('[Governor] Timing the device clock to learn its heat-time unit...');
      this._broadcast({
        curve_id: cid, curve_name: cname, phase: 'preheating', elapsed_s: 0.0, duration_s: durationS,
        target_temp_f: initialTemp, live_temp_f: Number(this.client.telemetry.live_temp_f || 0),
        progress_pct: 0.0, is_active: true, status: 'calibrating',
      });
      this._note(`Timing your ${this.client.isProxy ? 'Proxy' : 'device'}'s clock first so the curve gets its full length. This happens once and takes a few seconds.`);
      await this.client.waitForTimeUnit(12000, () => this.isActive && !this.client.telemetry.is_heating);
      if (!this.isActive) return;
      if (this.client.telemetry.is_heating) {
        return fail('A session started on the device, so the curve didn\'t start.');
      }
      console.log(`[Governor] Heat-time unit: ${this.client.timefmt || 'still unknown (will use a profile stand-in)'}`);
    }

    // 1b. Byte-for-byte backup so restoring never depends on knowing the device's units
    if (typeof this.client.backupProfileRaw === 'function') {
      try { this._backupProfile.raw = await this.client.backupProfileRaw(slot); } catch (e) {}
    }

    // 2. Program initial curve duration and temp (no profile re-select between writes)
    console.log(`[Governor] Programming initial curve setpoint: ${initialTemp}°F, duration: ${durationS}s to slot ${slot}`);
    const wopts = { fit: true, skipSelect: true };
    let durOk = await this.client.writeDuration(durationS, slot, wopts);
    let tempOk = await this.client.writeTemperature(initialTemp, slot, wopts);
    if (!durOk || !tempOk) {
      console.warn('[Governor] Retrying initial setpoint write to ensure hardware synchronization...');
      await new Promise((r) => setTimeout(r, 150));
      if (!durOk) durOk = await this.client.writeDuration(durationS, slot, wopts);
      if (!tempOk) tempOk = await this.client.writeTemperature(initialTemp, slot, wopts);
    }
    console.log(`[Governor] Initial configuration results: durOk=${durOk}, tempOk=${tempOk}`);
    if (!this.isActive) return;

    // Never heat on a heat time / temperature the device turned down: the session would run on the slot's
    // old values (e.g. a 30 s time) and cut the curve short.
    if (!durOk) {
      return fail(`Could not start the curve: your ${this.client.isProxy ? 'Proxy' : 'device'} didn't take the ${durationS}s heat time. You can still heat with your own profiles.`);
    }
    if (!tempOk) {
      return fail(`Could not start the curve: your ${this.client.isProxy ? 'Proxy' : 'device'} didn't take ${initialTemp}°F to start.`);
    }
    const adj = this.client.lastDurationWrite && this.client.lastDurationWrite.adj;
    if (adj) {
      this._note(adj.unk || adj.got == null
        ? 'This run uses the longest heat time from your own profiles, and the app ends it when the curve ends.'
        : adj.got >= durationS
          ? `Your device didn't take a ${adj.want}s heat time, so this run uses ${adj.got}s from one of your own profiles and the app ends it when the curve ends.`
          : `Your device didn't take a ${adj.want}s heat time, so this run uses ${adj.got}s from one of your own profiles and may end early.`);
    }

    // 2b. Select the curve slot once, after it's written, so the session loads the new values
    await this.client.setProfile(slot);

    // 3. Trigger hardware heat session
    console.log('[Governor] Triggering session start...');
    await this.client.startSession();

    // ---------------- PHASE 1: PREHEAT SYNCHRONIZATION ----------------
    console.log('[Governor] Waiting for chamber preheat climb...');
    const preheatStart = performance.now();
    let isPreheatDone = false;
    let preheatIdleCount = 0;

    // Immediately broadcast preheat state so UI numbers update instantly
    this._broadcast({
      curve_id: cid,
      curve_name: cname,
      phase: 'preheating',
      elapsed_s: 0.0,
      duration_s: durationS,
      target_temp_f: initialTemp,
      live_temp_f: Number(this.client.telemetry.live_temp_f || 0),
      progress_pct: 0.0,
      is_active: true,
      status: 'preheating',
    });

    while (this.isActive && !isPreheatDone) {
      await new Promise((r) => setTimeout(r, 250));
      if (!this.isActive) break;

      const liveTemp = Number(this.client.telemetry.live_temp_f || 0);
      const opState = this.client.telemetry.operating_state || '';
      const elapsedPreheat = (performance.now() - preheatStart) / 1000;

      // Broadcast preheat telemetry continuously so live numbers on tab update
      this._broadcast({
        curve_id: cid,
        curve_name: cname,
        phase: 'preheating',
        elapsed_s: 0.0,
        duration_s: durationS,
        target_temp_f: initialTemp,
        live_temp_f: liveTemp,
        progress_pct: 0.0,
        is_active: true,
        status: 'preheating',
      });

      // CRITICAL EMERGENCY CUTOFF: Auto shut off if chamber reaches/exceeds 600°F
      if (liveTemp >= 600.0) {
        console.error(`[Governor] EMERGENCY OVERHEAT CUTOFF: Chamber temperature (${liveTemp.toFixed(1)}°F) exceeded 600°F during preheat!`);
        this._broadcast({
          is_active: false,
          status: 'emergency_cutoff',
          phase: 'preheating',
          live_temp_f: liveTemp,
        });
        if (this.client.telemetry) {
          this.client.telemetry.active_curve_running = false;
        }
        await this.client.stopSession();
        await this._restoreProfile();
        this.isActive = false;
        return;
      }

      // ONLY check for abort after at least 5.0 seconds and 2 consecutive idle checks
      // Hardware takes 1-3s to transition registers out of IDLE upon start command over BLE
      if (elapsedPreheat > 5.0 && ['IDLE', 'DISCONNECTED', 'COOLDOWN', 'OFF'].includes(opState)) {
        preheatIdleCount++;
        if (preheatIdleCount >= 2) {
          console.warn(`[Governor] Session ended or aborted during preheat (state=${opState}).`);
          this._broadcast({
            is_active: false,
            status: 'aborted',
            phase: 'preheating',
          });
          if (this.client.telemetry) {
            this.client.telemetry.active_curve_running = false;
          }
          await this.client.stopSession();
          await this._restoreProfile();
          this.isActive = false;
          return;
        }
      } else {
        preheatIdleCount = 0;
      }

      // Chamber reached initial target temperature:
      // 1. Hardware state transitions to READY or HEAT_ACTIVE (Proxy transitions directly 7 -> 8)
      // 2. OR chamber temp climbs to within 10°F of initial target
      const reachedTemp = liveTemp >= (initialTemp - 10.0);
      const stateReady = ['READY', 'HEAT_ACTIVE'].includes(opState);
      const isReady = (stateReady && elapsedPreheat > 2.0) || (reachedTemp && elapsedPreheat > 1.5);
      if (isReady) {
        console.log(`[Governor] Chamber preheated (${liveTemp.toFixed(1)}°F, state=${opState}, elapsed=${elapsedPreheat.toFixed(1)}s)! Commencing curve timeline.`);
        isPreheatDone = true;
        break;
      }

      // Safety timeout after 65s
      if (elapsedPreheat > 65.0) {
        console.warn('[Governor] Preheat timeout reached; beginning curve timeline.');
        isPreheatDone = true;
        break;
      }
    }

    if (!this.isActive) return;

    // ---------------- PHASE 2: ACTIVE REAL-TIME GOVERNOR ----------------
    const startTime = performance.now();
    let lastSentTemp = initialTemp;
    let lastWriteTime = performance.now();
    let activeIdleCount = 0;
    const drv = await this._newDriver(initialTemp);
    console.log(`[Governor] Active curve governor running at 2 Hz for ${durationS}s (drive mode: ${drv.mode})...`);

    while (this.isActive) {
      const now = performance.now();
      const elapsed = Math.max(0, (now - startTime) / 1000);

      // Curve Finished
      if (elapsed >= durationS) {
        console.log(`[Governor] Curve "${cname}" completed successfully after ${elapsed.toFixed(1)}s!`);
        this._broadcast({
          curve_id: cid,
          curve_name: cname,
          phase: 'completed',
          elapsed_s: durationS,
          duration_s: durationS,
          target_temp_f: lastSentTemp,
          live_temp_f: Number(this.client.telemetry.live_temp_f || 0),
          progress_pct: 100.0,
          is_active: false,
          status: 'completed',
        });
        if (this.client.telemetry) {
          this.client.telemetry.active_curve_running = false;
        }
        await this.client.stopSession();
        await this._restoreProfile();
        this.isActive = false;
        break;
      }

      // Check external abort (after 3.0s into curve timeline, require 2 consecutive non-heating reads)
      const opState = this.client.telemetry.operating_state || '';
      const isHeating = this.client.telemetry.is_heating || ['READY', 'HEAT_ACTIVE', 'HEAT_PREHEAT'].includes(opState);
      if (!isHeating && elapsed > 3.0) {
        activeIdleCount++;
        if (activeIdleCount >= 2) {
          console.log(`[Governor] Heat stopped externally (state=${opState}).`);
          this._broadcast({
            is_active: false,
            status: 'ended_early',
          });
          if (this.client.telemetry) {
            this.client.telemetry.active_curve_running = false;
          }
          await this.client.stopSession();
          await this._restoreProfile();
          this.isActive = false;
          break;
        }
      } else {
        activeIdleCount = 0;
      }

      const liveTemp = Number(this.client.telemetry.live_temp_f || 0);

      // CRITICAL EMERGENCY CUTOFF: Auto shut off if chamber reaches/exceeds 600°F
      if (liveTemp >= 600.0) {
        console.error(`[Governor] EMERGENCY OVERHEAT CUTOFF: Chamber temperature (${liveTemp.toFixed(1)}°F) exceeded 600°F! Aborting immediately!`);
        this._broadcast({
          is_active: false,
          status: 'emergency_cutoff',
          phase: 'running',
          live_temp_f: liveTemp,
        });
        if (this.client.telemetry) {
          this.client.telemetry.active_curve_running = false;
        }
        await this.client.stopSession();
        await this._restoreProfile();
        this.isActive = false;
        return;
      }

      // Compute piecewise interpolated target temperature for elapsed timestamp
      let currentTarget = Math.round(window.interpolateCurveTarget(keyframes, elapsed) * 10) / 10;
      // Hard safety clamp: Never command setpoint outside [350°F, 590°F]
      currentTarget = Math.min(590.0, Math.max(350.0, currentTarget));

      // Slew-rate check & flash wear reduction delta filter:
      // Only write to device flash if setpoint changed by >= 2.0°F (or if >= 2.5s since last write)
      const flashWearThrottling = window.puffSafetySettings ? window.puffSafetySettings.flashWearThrottling !== false : true;
      const threshold = flashWearThrottling ? 2.0 : 1.0;
      const timeSinceLastWrite = now - lastWriteTime;

      if (drv.mode !== 'legacy') {
        // Live session control (RAM only, no flash wear): session target, or the boost override fallback
        const sent = await this._drive(drv, currentTarget, now);
        if (sent) {
          lastSentTemp = currentTarget;
          lastWriteTime = now;
        }
      } else if (Math.abs(currentTarget - lastSentTemp) >= threshold || (timeSinceLastWrite >= 2500 && Math.abs(currentTarget - lastSentTemp) >= 0.5)) {
        console.log(`[Governor] Modulating setpoint at t=${elapsed.toFixed(1)}s: ${lastSentTemp}°F -> ${currentTarget}°F`);
        const ok = await this.client.writeTemperature(currentTarget, slot);
        if (ok) {
          lastSentTemp = currentTarget;
          lastWriteTime = now;
        }
      }

      const pct = Math.min(100.0, Math.round((elapsed / durationS) * 1000) / 10);

      this._broadcast({
        curve_id: cid,
        curve_name: cname,
        phase: 'running',
        elapsed_s: Math.round(elapsed * 10) / 10,
        duration_s: durationS,
        target_temp_f: currentTarget,
        live_temp_f: liveTemp,
        progress_pct: pct,
        is_active: true,
        status: 'running',
      });

      await new Promise((r) => setTimeout(r, 500)); // 2 Hz modulation rate
    }
  }

  async stop() {
    console.log('[Governor] Stopping heat curve governor...');
    this.isActive = false;
    if (this.client && typeof this.client.removeDisconnectListener === 'function') {
      this.client.removeDisconnectListener(this._disconnectHandler);
    }
    if (this.client && this.client.telemetry) {
      this.client.telemetry.active_curve_running = false;
    }
    this._broadcast({
      is_active: false,
      status: 'stopped',
    });
    if (this.client && this.client.isConnected) {
      try {
        await this.client.stopSession();
      } catch (e) {
        console.warn('[Governor] Error stopping session:', e);
      }
      await this._restoreProfile();
    }
  }

  async _restoreProfile() {
    if (this._backupProfile && this.client && this.client.isConnected) {
      try {
        const { slot, target_temp_f, duration_s, origActiveSlot, raw } = this._backupProfile;
        if (this._touchedOverride && typeof this.client.setOverride === 'function') {
          try { await this.client.setOverride(0); } catch (e) {}
        }
        let restored = false;
        if (raw && (raw.temp || raw.time) && typeof this.client.restoreProfileRaw === 'function') {
          console.log(`[Governor] Restoring original profile ${slot} byte-for-byte...`);
          restored = await this.client.restoreProfileRaw(slot, raw);
        }
        if (!restored) {
          console.log(`[Governor] Restoring original profile ${slot} (temp=${target_temp_f}°F, dur=${duration_s}s)...`);
          await this.client.writeTemperature(target_temp_f, slot);
          await this.client.writeDuration(duration_s, slot);
        }
        if (typeof origActiveSlot === 'number') {
          await this.client.setProfile(origActiveSlot);
        }
      } catch (e) {
        console.warn('[Governor] Failed to restore profile:', e);
      }
      this._backupProfile = null;
      this._touchedOverride = false;
    }
  }

  _note(msg) {
    console.warn(`[Governor] ${msg}`);
    try {
      if (typeof window.showToast === 'function') window.showToast(msg, 'info', 6000);
    } catch (e) {}
  }

  // ---------------- Live curve driver (ported from aquaphase.app) ----------------
  // First try moving the session's base temperature (/p/app/thc/temp, full range) and check the heater's real
  // target (/p/app/htr/tcmd). If the device ignores that, switch to the override Puffco's own boost uses
  // (/p/app/tmpo), which is proven on real hardware but capped by the firmware (about +15 °F). Remembered per device.

  _memKey() {
    const id = this.client && this.client.device && this.client.device.id;
    return id ? 'puff_curve_drv_' + id : null;
  }

  _mem() {
    const k = this._memKey();
    if (!k) return {};
    try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; }
  }

  _remember(o) {
    const k = this._memKey();
    if (!k) return;
    try {
      const fw = (this.client.telemetry && this.client.telemetry.firmware_version) || null;
      localStorage.setItem(k, JSON.stringify({ ...this._mem(), ...o, fw }));
    } catch (e) {}
  }

  async _newDriver(baseGuess) {
    const c = this.client;
    if (!c || typeof c.setLiveTarget !== 'function' || typeof c.readLiveBase !== 'function') {
      return { mode: 'legacy' }; // simulator / older clients: profile writes as before
    }
    const m = this._mem();
    const fw = (c.telemetry && c.telemetry.firmware_version) || null;
    const same = m.fw == null || m.fw === fw;
    const D = {
      mode: same && (m.mode === 'boost' || m.mode === 'live') ? m.mode : 'probe',
      tmax: same && m.tmax != null ? m.tmax : 15,
      tmin: same && m.tmin != null ? m.tmin : -60,
      fails: 0, refused: 0, hist: [], last: null, tcFail: 0, noTcmd: false,
      lastSent: null, lastAt: 0, base: baseGuess, ov: 0,
    };
    if (D.mode === 'probe' || D.mode === 'live') {
      let b = null;
      try { b = await c.readLiveBase(); } catch (e) {}
      if (b != null) D.base = b;
      else { D.mode = 'boost'; this._remember({ mode: 'boost' }); } // not shown plainly: never written live
    }
    try { const ov = await c.readOverride(); D.ov = ov != null ? ov : 0; } catch (e) { D.ov = 0; }
    return D;
  }

  /** Did the heater's real target move where we asked? Two misses in a row: live -> boost -> none. */
  async _verifyDrive(D) {
    const c = this.client;
    if (D.noTcmd || typeof c.readHeaterTarget !== 'function') return;
    let t = null;
    try { t = await c.readHeaterTarget(); } catch (e) {}
    if (t == null) { if (++D.tcFail >= 3) D.noTcmd = true; return; }
    D.tcFail = 0;
    const at = performance.now();
    if (D.last == null) D.last = D.base + (D.ov || 0);
    // only writes that asked for a real change (more than 6 °F from the last confirmed target) can prove anything
    const recent = D.hist.filter((h) => h.at < at - 150 && h.at > at - 4000 && Math.abs(h.want - D.last) > 6);
    if (!recent.length) return;
    const w = recent[recent.length - 1];
    const moved = Math.abs(t - D.last) > 3 && Math.sign(t - D.last) === Math.sign(w.want - D.last);
    const ok = moved || recent.some((h) => Math.abs(t - h.want) <= 5);
    if (ok) {
      D.fails = 0;
      D.last = t;
      if (D.mode === 'probe') { D.mode = 'live'; this._remember({ mode: 'live' }); }
    } else if (++D.fails >= 2) {
      D.fails = 0;
      if (D.mode !== 'boost') {
        console.warn('[Governor] Device ignored live target changes; switching to boost override.');
        D.mode = 'boost';
        this._remember({ mode: 'boost' });
        try { await c.setLiveTarget(D.base); } catch (e) {}
        D.lastSent = null;
      } else {
        console.warn('[Governor] Device ignored boost override too; the session keeps its current temperature.');
        D.mode = 'none';
        this._remember({ mode: 'none' });
      }
      D.hist = [];
      D.last = null;
    }
  }

  async _drive(D, sp, now) {
    const c = this.client;
    await this._verifyDrive(D);
    if (D.mode === 'none') return false;
    if (D.lastSent != null && (Math.abs(sp - D.lastSent) < 2 || now - D.lastAt < 600)) return false;
    D.lastAt = now;
    if (D.mode === 'boost') {
      const want = Math.min(D.tmax, Math.max(D.tmin, sp - D.base));
      this._touchedOverride = true;
      const ok = await c.setOverride(want);
      if (!ok) {
        if (want < 0) { D.tmin = 0; this._remember({ tmin: 0 }); D.lastSent = null; }
        return false;
      }
      let rb = want;
      try { const r = await c.readOverride(); if (r != null) rb = r; } catch (e) {}
      if (want > 0 && rb < want - 0.6) { D.tmax = Math.max(0, rb); this._remember({ tmax: D.tmax }); }
      if (want < 0 && rb > want + 0.6) { D.tmin = Math.min(0, rb); this._remember({ tmin: D.tmin }); }
      D.hist.push({ want: D.base + rb, at: performance.now() });
    } else {
      const ok = await c.setLiveTarget(sp);
      if (!ok) {
        // turned down twice in a row: switch to the boost offset Puffco's own app uses for live changes
        if (++D.refused >= 2) {
          D.mode = 'boost'; this._remember({ mode: 'boost' });
          D.hist = []; D.last = null; D.lastSent = null;
        }
        return false;
      }
      D.refused = 0;
      D.hist.push({ want: sp + (D.ov || 0), at: performance.now() });
    }
    if (D.hist.length > 12) D.hist.shift();
    D.lastSent = sp;
    return true;
  }
}

// Global export
window.CurveGovernor = CurveGovernor;
