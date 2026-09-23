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
    };

    if (useDedicatedSlot && origActiveSlot !== 3) {
      await this.client.setProfile(3);
    }

    // 2. Program initial curve duration and temp
    console.log(`[Governor] Programming initial curve setpoint: ${initialTemp}°F, duration: ${durationS}s to slot ${slot}`);
    let durOk = await this.client.writeDuration(durationS, slot);
    let tempOk = await this.client.writeTemperature(initialTemp, slot);
    if (!durOk || !tempOk) {
      console.warn('[Governor] Retrying initial setpoint write to ensure hardware synchronization...');
      await new Promise((r) => setTimeout(r, 150));
      if (!durOk) durOk = await this.client.writeDuration(durationS, slot);
      if (!tempOk) tempOk = await this.client.writeTemperature(initialTemp, slot);
    }
    console.log(`[Governor] Initial configuration results: durOk=${durOk}, tempOk=${tempOk}`);

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
    console.log(`[Governor] Active curve governor running at 2 Hz for ${durationS}s...`);

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

      if (Math.abs(currentTarget - lastSentTemp) >= threshold || (timeSinceLastWrite >= 2500 && Math.abs(currentTarget - lastSentTemp) >= 0.5)) {
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
        const { slot, target_temp_f, duration_s, origActiveSlot } = this._backupProfile;
        console.log(`[Governor] Restoring original profile ${slot} (temp=${target_temp_f}°F, dur=${duration_s}s)...`);
        await this.client.writeTemperature(target_temp_f, slot);
        await this.client.writeDuration(duration_s, slot);
        if (typeof origActiveSlot === 'number') {
          await this.client.setProfile(origActiveSlot);
        }
      } catch (e) {
        console.warn('[Governor] Failed to restore profile:', e);
      }
      this._backupProfile = null;
    }
  }
}

// Global export
window.CurveGovernor = CurveGovernor;
