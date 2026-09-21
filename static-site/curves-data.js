/**
 * Puff Studio — Curve Presets, Interpolation & LocalStorage Manager
 * Companion heat curve library for Puffco devices.
 */

const DEFAULT_CURVE_PRESETS = [
  {
    id: "preset-step-3",
    name: "Step 430 → 485 → 520",
    description: "3-stage progression: initial low-temp terpene boil, steady extraction, high-temp cloud finish.",
    duration_s: 50,
    keyframes: [
      { time_s: 0, temp_f: 430 },
      { time_s: 15, temp_f: 430 },
      { time_s: 18, temp_f: 485 },
      { time_s: 35, temp_f: 485 },
      { time_s: 38, temp_f: 520 },
      { time_s: 50, temp_f: 520 },
    ],
  },
  {
    id: "preset-thermal-decay",
    name: "Decay 535 → 465",
    description: "Traditional quartz banger emulation: hot start for thick vapor, descending as concentrate thins.",
    duration_s: 50,
    keyframes: [
      { time_s: 0, temp_f: 535 },
      { time_s: 12, temp_f: 535 },
      { time_s: 30, temp_f: 495 },
      { time_s: 50, temp_f: 465 },
    ],
  },
  {
    id: "preset-linear-ramp",
    name: "Linear 420 → 510",
    description: "Continuous smooth thermal ramp (+1.5°F/s) across a 60s session.",
    duration_s: 60,
    keyframes: [
      { time_s: 0, temp_f: 420 },
      { time_s: 60, temp_f: 510 },
    ],
  },
  {
    id: "preset-low-dwell",
    name: "Dwell 450",
    description: "Extended low-temp plateau for solventless / live rosin with minimal thermal stress.",
    duration_s: 60,
    keyframes: [
      { time_s: 0, temp_f: 445 },
      { time_s: 20, temp_f: 445 },
      { time_s: 25, temp_f: 460 },
      { time_s: 60, temp_f: 460 },
    ],
  },
  {
    id: "preset-boost-finish",
    name: "Peak Boost 480 → 535",
    description: "Steady 480°F extraction with an aggressive 535°F boost for the final 15 seconds.",
    duration_s: 55,
    keyframes: [
      { time_s: 0, temp_f: 480 },
      { time_s: 38, temp_f: 480 },
      { time_s: 42, temp_f: 535 },
      { time_s: 55, temp_f: 535 },
    ],
  },
];

const STORAGE_KEY = "puff_studio_curves_v1";

class CurveStorage {
  constructor() {
    this._curves = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._curves = parsed;
          return;
        }
      }
    } catch (e) {
      console.warn("Could not load curves from localStorage:", e);
    }
    // Fallback to default presets
    this._curves = JSON.parse(JSON.stringify(DEFAULT_CURVE_PRESETS));
    this.save();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._curves));
    } catch (e) {
      console.error("Failed to persist curves to localStorage:", e);
    }
  }

  listAll() {
    return this._curves;
  }

  get(id) {
    return this._curves.find((c) => c.id === id) || null;
  }

  upsert(curve) {
    if (!curve.id) {
      curve.id = `custom-${Date.now().toString(36)}`;
    }
    const idx = this._curves.findIndex((c) => c.id === curve.id);
    if (idx >= 0) {
      this._curves[idx] = JSON.parse(JSON.stringify(curve));
    } else {
      this._curves.push(JSON.parse(JSON.stringify(curve)));
    }
    this.save();
    return curve;
  }

  delete(id) {
    this._curves = this._curves.filter((c) => c.id !== id);
    if (this._curves.length === 0) {
      this._curves = JSON.parse(JSON.stringify(DEFAULT_CURVE_PRESETS));
    }
    this.save();
  }

  resetToDefaults() {
    this._curves = JSON.parse(JSON.stringify(DEFAULT_CURVE_PRESETS));
    this.save();
    return this._curves;
  }

  exportJson() {
    return JSON.stringify(this._curves, null, 2);
  }

  importJson(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!Array.isArray(parsed)) throw new Error("Expected an array of curves");
      for (const item of parsed) {
        if (!item.id || !item.name || !Array.isArray(item.keyframes)) {
          throw new Error("Invalid curve structure");
        }
      }
      this._curves = parsed;
      this.save();
      return true;
    } catch (e) {
      console.error("Import curves failed:", e);
      return false;
    }
  }
}

/**
 * Computes piecewise linear interpolation between curve keyframes at elapsed_s.
 */
function interpolateCurveTarget(keyframes, elapsed_s) {
  if (!keyframes || keyframes.length === 0) return 485.0;
  if (elapsed_s <= keyframes[0].time_s) return Number(keyframes[0].temp_f);
  if (elapsed_s >= keyframes[keyframes.length - 1].time_s) {
    return Number(keyframes[keyframes.length - 1].temp_f);
  }

  for (let i = 0; i < keyframes.length - 1; i++) {
    const k1 = keyframes[i];
    const k2 = keyframes[i + 1];
    const t1 = Number(k1.time_s);
    const temp1 = Number(k1.temp_f);
    const t2 = Number(k2.time_s);
    const temp2 = Number(k2.temp_f);

    if (t1 <= elapsed_s && elapsed_s <= t2) {
      if (t2 === t1) return temp2;
      const ratio = (elapsed_s - t1) / (t2 - t1);
      return temp1 + ratio * (temp2 - temp1);
    }
  }

  return Number(keyframes[keyframes.length - 1].temp_f);
}

// Global export for browser scripts
window.CurveStorage = CurveStorage;
window.interpolateCurveTarget = interpolateCurveTarget;
window.DEFAULT_CURVE_PRESETS = DEFAULT_CURVE_PRESETS;
