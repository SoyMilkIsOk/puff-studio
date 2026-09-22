/**
 * puffsn0w — Curve Presets, Interpolation & LocalStorage Manager
 * Companion heat curve library for Puffco devices.
 */

const DEFAULT_CURVE_PRESETS = [
  {
    id: "preset-step-3",
    name: "Step Down",
    description: "3-stage step down",
    duration_s: 60,
    keyframes: [
      { time_s: 0, temp_f: 535 },
      { time_s: 15, temp_f: 535 },
      { time_s: 18, temp_f: 485 },
      { time_s: 35, temp_f: 485 },
      { time_s: 45, temp_f: 430 },
      { time_s: 60, temp_f: 430 },
    ],
  },
  {
    id: "preset-thermal-decay",
    name: "Decay",
    description: "Traditional quartz banger emulation: hot start for thick vapor, descending as concentrate thins.",
    duration_s: 55,
    keyframes: [
      { time_s: 0, temp_f: 535 },
      { time_s: 12, temp_f: 525 },
      { time_s: 30, temp_f: 475 },
      { time_s: 55, temp_f: 436 },
    ],
  },
  {
    id: "preset-linear-ramp",
    name: "Linear",
    description: "Continuous smooth thermal ramp",
    duration_s: 60,
    keyframes: [
      { time_s: 0, temp_f: 535 },
      { time_s: 60, temp_f: 420 },
    ],
  },
  {
    id: "preset-low-dwell",
    name: "Dwell",
    description: "Extended lower-temp plateau for solventless / live rosin with minimal thermal stress.",
    duration_s: 60,
    keyframes: [
      { time_s: 0, temp_f: 490 },
      { time_s: 20, temp_f: 490 },
      { time_s: 25, temp_f: 460 },
      { time_s: 60, temp_f: 460 },
    ],
  },
  {
    id: "preset-boost-finish",
    name: "Temp Burst",
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

const STORAGE_KEY = "puff_studio_curves_v2";

const COOKIE_CUSTOM_CURVES_KEY = 'puff_custom_curves';

function setCookie(name, value, days = 365) {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (e) {
    console.warn('Could not write cookie:', e);
  }
}

function getCookie(name) {
  try {
    const match = document.cookie.match(new RegExp('(?:^|; )' + encodeURIComponent(name).replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  } catch (e) {
    console.warn('Could not read cookie:', e);
    return null;
  }
}

class CurveStorage {
  constructor() {
    this._curves = [];
    this.load();
  }

  load() {
    let loadedFromStorage = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._curves = parsed;
          loadedFromStorage = true;
        }
      }
      // Migrate custom curves from v1 if available
      if (!loadedFromStorage) {
        const oldRaw = localStorage.getItem("puff_studio_curves_v1");
        if (oldRaw) {
          const oldParsed = JSON.parse(oldRaw);
          if (Array.isArray(oldParsed)) {
            const customOnly = oldParsed.filter((c) => c.id && c.id.startsWith("custom-"));
            this._curves = JSON.parse(JSON.stringify(DEFAULT_CURVE_PRESETS)).concat(customOnly);
            loadedFromStorage = true;
            this.save();
          }
        }
      }
    } catch (e) {
      console.warn("Could not load curves from localStorage:", e);
    }

    if (!loadedFromStorage || this._curves.length === 0) {
      // Fallback to default presets
      this._curves = JSON.parse(JSON.stringify(DEFAULT_CURVE_PRESETS));
    }

    // Mobile Cookie Fallback / Restore
    try {
      const cookieRaw = getCookie(COOKIE_CUSTOM_CURVES_KEY);
      if (cookieRaw) {
        const cookieCustomCurves = JSON.parse(cookieRaw);
        if (Array.isArray(cookieCustomCurves) && cookieCustomCurves.length > 0) {
          // Merge custom curves that might have been cleared from localStorage
          cookieCustomCurves.forEach((cc) => {
            if (cc.id && !this._curves.some((existing) => existing.id === cc.id)) {
              this._curves.push(cc);
            }
          });
        }
      }
    } catch (e) {
      console.warn("Could not parse custom curves cookie:", e);
    }

    this.save();
  }

  save() {
    // 1. Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._curves));
    } catch (e) {
      console.warn("Failed to persist curves to localStorage:", e);
    }

    // 2. Persist custom curves to Cookie for mobile persistence across resets
    try {
      const customCurves = this._curves.filter((c) => c.id && c.id.startsWith("custom-"));
      if (customCurves.length > 0) {
        // Strip any unnecessary large metadata before writing cookie to stay well within 4KB cookie limit
        const compactCustom = customCurves.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description || "",
          keyframes: c.keyframes,
          color: c.color || "#ff6b35",
        }));
        setCookie(COOKIE_CUSTOM_CURVES_KEY, JSON.stringify(compactCustom), 365);
      } else {
        setCookie(COOKIE_CUSTOM_CURVES_KEY, "", -1);
      }
    } catch (e) {
      console.warn("Failed to persist custom curves to cookie:", e);
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
