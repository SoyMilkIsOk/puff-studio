/**
 * puffsn0w — Standalone E-Rig Jailbreak Controller & Heat Curve Studio
 * Direct hardware & simulator integration, SVG curve editor with touch dragging,
 * live telemetry HUD, and dynamic thermal curve governor.
 */

// Core Services
let curveStorage = null;
let bleClient = null;
let simClient = null;
let activeClient = null;
let curveGovernor = null;

// Global State
let currentTelemetry = null;
let isDemoMode = false;
let isCurveRunning = false;
let curvesList = [];
let currentCurve = null;

// Curve Dragging State
let isDraggingNode = false;
let draggingNodeIndex = -1;
let justDragged = false;
let actualTrailPoints = [];

// Live Session Heat Curve State (dial graph)
let liveSessionPoints = [];
let sessionStartTime = null;
let lastPointRecordTime = 0;
let sessionPeakTemp = 0;
let sessionTempSum = 0;
let sessionTempCount = 0;
let wasHeating = false;
let wasDeviceConnected = false;

// DOM Element Cache
const el = {
  // Navigation Tabs & App Layout
  appLayout: document.querySelector('.app-layout'),
  tabControllerBtn: document.getElementById('tab-controller-btn'),
  tabCurvesBtn: document.getElementById('tab-curves-btn'),
  tabController: document.getElementById('tab-controller'),
  tabCurves: document.getElementById('tab-curves'),

  // Lockscreen & Slide to Unlock Elements
  lockscreen: document.getElementById('lockscreen'),
  lockscreenCenterSection: document.getElementById('lockscreen-center-section'),
  lockscreenConnectCard: document.getElementById('lockscreen-connect-card'),
  lockscreenClock: document.getElementById('lockscreen-clock'),
  lockscreenDate: document.getElementById('lockscreen-date'),
  lockscreenBtBadge: document.getElementById('lockscreen-bt-badge'),
  lockscreenBatteryPill: document.getElementById('lockscreen-battery-pill'),
  lockscreenBatteryVal: document.getElementById('lockscreen-battery-val'),
  lockscreenBatteryFill: document.getElementById('lockscreen-battery-fill'),
  lockscreenConnectBtn: document.getElementById('lockscreen-connect-btn'),
  lockscreenConnectLabel: document.getElementById('lockscreen-connect-label'),
  lockscreenGuideBtn: document.getElementById('lockscreen-guide-btn'),
  lockscreenDemoBtn: document.getElementById('lockscreen-demo-btn'),
  lockscreenStatusIndicator: document.getElementById('lockscreen-status-indicator'),
  lockscreenStatusMsg: document.getElementById('lockscreen-status-msg'),
  analyticsModal: document.getElementById('analytics-modal'),
  analyticsAcceptBtn: document.getElementById('analytics-accept-btn'),
  analyticsDismissBtn: document.getElementById('analytics-dismiss-btn'),
  lockscreenSliderTrack: document.getElementById('lockscreen-slider-track'),
  lockscreenSliderThumb: document.getElementById('lockscreen-slider-thumb'),
  slideShimmerLabel: document.getElementById('slide-shimmer-label'),
  sliderLockedHint: document.getElementById('slider-locked-hint'),
  sliderLockedText: document.getElementById('slider-locked-text'),
  lockScreenBtn: document.getElementById('lock-screen-btn'),

  // Header Status & Device
  deviceName: document.getElementById('device-name-display'),
  devicePill: document.getElementById('device-pill'),
  chamberPill: document.getElementById('chamber-pill'),
  batteryWidget: document.getElementById('battery-widget'),
  batteryDisplay: document.getElementById('battery-level-display'),
  batteryBolt: document.getElementById('battery-bolt'),
  batteryFill: document.getElementById('battery-fill-icon'),
  mainConnectBtn: document.getElementById('main-connect-btn'),
  infoTutorialBtn: document.getElementById('info-tutorial-btn'),
  connectTutorialModal: document.getElementById('connect-tutorial-modal'),
  closeTutorialModal: document.getElementById('close-tutorial-modal'),
  tutorialDismissBtn: document.getElementById('tutorial-dismiss-btn'),
  tutorialConnectBtn: document.getElementById('tutorial-connect-btn'),
  btIndicator: document.getElementById('bt-indicator'),

  // Compatibility Banner & Modal
  compatBanner: document.getElementById('compat-banner'),
  compatBannerMsg: document.getElementById('compat-banner-msg'),
  compatGuideBtn: document.getElementById('compat-guide-btn'),
  compatDismissBtn: document.getElementById('compat-dismiss-btn'),
  compatModal: document.getElementById('compat-modal'),
  closeCompatModal: document.getElementById('close-compat-modal'),
  closeCompatModalBtn: document.getElementById('close-compat-modal-btn'),

  // Standard Controller Gauge
  stateBadge: document.getElementById('state-badge'),
  gaugeHalo: document.getElementById('gauge-halo'),
  dialProgress: document.getElementById('dial-progress'),
  dialNeedle: document.getElementById('dial-setpoint-needle'),
  dialNeedleGroup: document.getElementById('dial-needle-group'),
  liveTempVal: document.getElementById('live-temp-val'),
  targetTempVal: document.getElementById('target-temp-val'),
  timerPill: document.getElementById('session-timer-pill'),
  timeRemainingVal: document.getElementById('time-remaining-val'),

  // Live Session Heat Curve (below dial)
  lsgPhasePill: document.getElementById('lsg-phase-pill'),
  lsgTargetReadout: document.getElementById('lsg-target-readout'),
  lsgLiveReadout: document.getElementById('lsg-live-readout'),
  lsgTargetLine: document.getElementById('lsg-target-line'),
  lsgTrailArea: document.getElementById('lsg-trail-area'),
  lsgTrailStroke: document.getElementById('lsg-trail-stroke'),
  lsgLiveDotGroup: document.getElementById('lsg-live-dot-group'),
  lsgLiveDot: document.getElementById('lsg-live-dot'),
  lsgTimeStat: document.getElementById('lsg-time-stat'),
  lsgPeakStat: document.getElementById('lsg-peak-stat'),
  lsgAvgStat: document.getElementById('lsg-avg-stat'),
  lsgT1: document.getElementById('lsg-t1'),
  lsgT2: document.getElementById('lsg-t2'),
  lsgT3: document.getElementById('lsg-t3'),
  lsgT4: document.getElementById('lsg-t4'),

  // Sesh Buttons
  startSeshBtn: document.getElementById('start-sesh-btn'),
  boostSeshBtn: document.getElementById('boost-sesh-btn'),
  stopSeshBtn: document.getElementById('stop-sesh-btn'),

  // Profiles & Tuning
  profilesContainer: document.getElementById('profiles-grid-container'),
  tempSlider: document.getElementById('temp-range-slider'),
  sliderTempVal: document.getElementById('slider-temp-val'),
  tempDecBtn: document.getElementById('temp-dec-btn'),
  tempIncBtn: document.getElementById('temp-inc-btn'),
  applyTempBtn: document.getElementById('apply-temp-btn'),
  presetPills: document.querySelectorAll('.preset-pill'),

  // Diagnostics
  statChamberName: document.getElementById('stat-chamber-name'),
  statTotalDabs: document.getElementById('stat-total-dabs'),
  statMacAddress: document.getElementById('stat-mac-address'),
  statFirmwareVersion: document.getElementById('stat-firmware-version'),

  // Toggles & Power
  stealthToggle: document.getElementById('stealth-mode-toggle'),
  lanternToggle: document.getElementById('lantern-mode-toggle'),
  sleepBtn: document.getElementById('sleep-btn'),
  powerOffBtn: document.getElementById('power-off-btn'),

  // Lantern Controls Panel
  lanternControlsPanel: document.getElementById('lantern-controls-panel'),
  lanternAuraPreview: document.getElementById('lantern-aura-preview'),
  lanternActiveEffectName: document.getElementById('lantern-active-effect-name'),
  lanternBrightnessSlider: document.getElementById('lantern-brightness-slider'),
  lanternBrightnessVal: document.getElementById('lantern-brightness-val'),

  // Curve Studio
  curvePillsContainer: document.getElementById('curve-pills-container'),
  newCurveBtn: document.getElementById('new-curve-btn'),
  saveCurveBtn: document.getElementById('save-curve-btn'),
  shareCurveBtn: document.getElementById('share-curve-btn'),
  activeCurveTitle: document.getElementById('active-curve-title'),
  activeCurveDesc: document.getElementById('active-curve-desc'),
  curveDurationBadge: document.getElementById('curve-duration-badge'),
  curveStatusBadge: document.getElementById('curve-status-badge'),
  curveGraphContainer: document.getElementById('curve-graph-container'),
  curveLockedBadge: document.getElementById('curve-locked-badge'),
  keyframeEditorSection: document.querySelector('.keyframe-editor-section'),
  curveSvg: document.getElementById('curve-svg'),
  curveAreaPath: document.getElementById('curve-area-path'),
  curveStrokePath: document.getElementById('curve-stroke-path'),
  curveActualTrail: document.getElementById('curve-actual-trail'),
  curvePlayheadLine: document.getElementById('curve-playhead-line'),
  curvePlayheadDotGroup: document.getElementById('curve-playhead-dot-group'),
  curvePlayheadDot: document.getElementById('curve-playhead-dot'),
  curveDragTooltip: document.getElementById('curve-drag-tooltip'),
  curvePointsLayer: document.getElementById('curve-points-layer'),
  curveElapsedDisplay: document.getElementById('curve-elapsed-display'),
  curveSetpointDisplay: document.getElementById('curve-setpoint-display'),
  curveActualDisplay: document.getElementById('curve-actual-display'),
  runCurveBtn: document.getElementById('run-curve-btn'),
  runCurveBtnLabel: document.getElementById('run-curve-btn-label'),
  stopCurveBtn: document.getElementById('stop-curve-btn'),
  keyframeTableBody: document.getElementById('keyframe-table-body'),
  addKeyframeBtn: document.getElementById('add-keyframe-btn'),

  // Modals
  saveCurveModal: document.getElementById('save-curve-modal'),
  closeSaveCurveModal: document.getElementById('close-save-curve-modal'),
  saveCurveNameInput: document.getElementById('save-curve-name-input'),
  saveCurveDescInput: document.getElementById('save-curve-desc-input'),
  confirmSaveCurveBtn: document.getElementById('confirm-save-curve-btn'),

  shareCurveModal: document.getElementById('share-curve-modal'),
  closeShareCurveModal: document.getElementById('close-share-curve-modal'),
  shareLinkInput: document.getElementById('share-link-input'),
  shareJsonInput: document.getElementById('share-json-input'),
  copyShareLinkBtn: document.getElementById('copy-share-link-btn'),

  toastContainer: document.getElementById('toast-container'),
};

// ==========================================================================
// Browser & Web Bluetooth Feature Detection
// ==========================================================================

function checkBrowserCompatibility() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const hasWebBluetooth = typeof navigator !== 'undefined' && !!navigator.bluetooth;
  const isDismissed = sessionStorage.getItem('compat_dismissed') === '1';

  if (!hasWebBluetooth) {
    el.btIndicator.textContent = 'No Web BLE';
    el.btIndicator.className = 'ws-pill ws-disconnected';

    if (!isDismissed) {
      el.compatBanner.classList.remove('hidden');
      if (isIOS) {
        el.compatBannerMsg.innerHTML = `<strong>iOS Notice:</strong> Safari does not support Bluetooth. Open in <strong>Path Browser</strong> or <strong>Bluefy</strong> to connect, or use <strong>Demo Mode</strong>!`;
      } else {
        el.compatBannerMsg.innerHTML = `<strong>Browser Notice:</strong> Web Bluetooth is not available in this browser. Use <strong>Google Chrome</strong> or <strong>Edge</strong>, or toggle <strong>Demo Mode</strong>!`;
      }
    }
  } else {
    el.btIndicator.textContent = 'Web BLE Ready';
    el.btIndicator.className = 'ws-pill ws-connected';
  }
}

// ==========================================================================
// Telemetry Rendering
// ==========================================================================

function handleTelemetryUpdate(data) {
  currentTelemetry = data;

  const connected = !!data.connected;
  const isHeating = !!data.is_heating || ['HEAT_PREHEAT', 'HEAT_ACTIVE', 'READY'].includes(data.operating_state);

  // Device & Status Pill
  if (connected) {
    el.devicePill.className = 'status-pill status-connected' + (data.is_demo ? ' status-demo' : '');
    el.deviceName.textContent = data.device_name || 'Puff Device';
    el.mainConnectBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      Disconnect
    `;
    el.mainConnectBtn.className = 'btn btn-secondary';
  } else {
    el.devicePill.className = 'status-pill status-disconnected';
    el.deviceName.textContent = 'No Device';
    el.mainConnectBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg>
      Connect
    `;
    el.mainConnectBtn.className = 'btn btn-primary';
  }

  // Chamber Pill
  const isSyncing = connected && (!!data.is_syncing || data.battery_pct === null);
  const chamberStr = isSyncing ? 'Detecting...' : (data.chamber_name || (connected ? '3DXL' : 'Standard'));
  el.chamberPill.textContent = isSyncing ? 'Detecting...' : (data.chamber_name || '3DXL');
  el.statChamberName.textContent = chamberStr + (isSyncing ? '' : ' Chamber');

  // Battery Widget
  if (el.batteryWidget) {
    el.batteryWidget.className = 'battery-pill';
  }

  if (isSyncing) {
    el.batteryDisplay.textContent = '--%';
    el.batteryDisplay.classList.add('telemetry-syncing');
    el.batteryBolt.classList.add('hidden');
    if (el.batteryFill) el.batteryFill.setAttribute('width', '4');
    if (el.batteryWidget) {
      el.batteryWidget.classList.add('syncing');
    }
  } else {
    el.batteryDisplay.classList.remove('telemetry-syncing');
    const batPct = Math.max(0, Math.min(100, data.battery_pct || 0));
    el.batteryDisplay.textContent = connected ? `${batPct}%` : '--%';
    el.batteryBolt.classList.toggle('hidden', !data.is_charging);

    // Dynamic SVG Battery Fill Rect (inner width ranges from 0 to 12)
    if (el.batteryFill) {
      if (!connected || batPct <= 0) {
        el.batteryFill.setAttribute('width', '0');
      } else {
        const fillW = Math.max(2, Math.round((batPct / 100) * 12));
        el.batteryFill.setAttribute('width', String(fillW));
      }
    }

    // Dynamic Battery States
    if (el.batteryWidget && connected) {
      if (data.is_charging) {
        el.batteryWidget.classList.add('charging');
      } else if (batPct > 65) {
        el.batteryWidget.classList.add('battery-full');
      } else if (batPct > 25) {
        el.batteryWidget.classList.add('battery-med');
      } else if (batPct > 10) {
        el.batteryWidget.classList.add('battery-low');
      } else {
        el.batteryWidget.classList.add('battery-critical');
      }
    }
  }

  // Lockscreen Telemetry & Unlock Synchronization
  if (el.lockscreen) {
    if (connected) {
      el.lockscreen.classList.remove('lockscreen-locked');
      if (el.lockscreenBtBadge) el.lockscreenBtBadge.classList.add('connected');
      if (el.lockscreenBatteryVal) {
        const batPct = isSyncing ? '--' : Math.max(0, Math.min(100, data.battery_pct || 0));
        el.lockscreenBatteryVal.textContent = isSyncing ? '--%' : `${batPct}%`;
      }
      if (el.lockscreenBatteryFill) {
        const batPct = isSyncing ? 25 : Math.max(0, Math.min(100, data.battery_pct || 0));
        el.lockscreenBatteryFill.setAttribute('width', String(Math.max(2, Math.round((batPct / 100) * 12))));
      }
      if (el.lockscreenSliderTrack) {
        el.lockscreenSliderTrack.classList.remove('slider-locked');
      }
      if (el.lockscreenConnectCard) {
        el.lockscreenConnectCard.classList.add('connected-hidden');
      }
      if (!wasDeviceConnected) {
        showToast(`${data.device_name || 'Device'} Connected! Slide to unlock 🔓`, 'success', 3500);
      }
      if (el.lockscreenConnectBtn) {
        el.lockscreenConnectBtn.classList.add('connected');
        if (el.lockscreenConnectLabel) {
          el.lockscreenConnectLabel.textContent = `✓ ${data.device_name || 'E-Rig'} Connected`;
        }
      }
    } else {
      el.lockscreen.classList.add('lockscreen-locked');
      if (el.lockscreenBtBadge) el.lockscreenBtBadge.classList.remove('connected');
      if (el.lockscreenBatteryVal) el.lockscreenBatteryVal.textContent = '--%';
      if (el.lockscreenBatteryFill) el.lockscreenBatteryFill.setAttribute('width', '2');
      if (el.lockscreenSliderTrack) {
        el.lockscreenSliderTrack.classList.add('slider-locked');
      }
      if (el.lockscreenConnectCard) {
        el.lockscreenConnectCard.classList.remove('connected-hidden');
      }
      if (el.lockscreenConnectBtn) {
        el.lockscreenConnectBtn.classList.remove('connected');
        if (el.lockscreenConnectLabel) {
          el.lockscreenConnectLabel.textContent = 'Connect Device';
        }
      }
    }
  }

  wasDeviceConnected = connected;

  // Operating State Badge
  updateStateBadge(data.operating_state, data.state_name, isSyncing);

  // Temperature Readouts
  const liveTemp = Number(data.live_temp_f || 0);
  const targetTemp = Number(data.target_temp_f || 485);
  el.liveTempVal.textContent = connected && liveTemp > 30 ? Math.round(liveTemp) : '--';
  el.targetTempVal.textContent = Math.round(targetTemp);

  // Update SVG Dial Arc & Needle (350°F to 600°F)
  updateGauge(liveTemp, targetTemp, isHeating, data.operating_state);

  // Update Live Session Heat Curve below dial
  updateLiveSessionGraph(data, isHeating, liveTemp, targetTemp);

  // Session Timer Pill
  const timeRem = Number(data.time_remaining || 0);
  if (connected && (isHeating || timeRem > 0)) {
    el.timerPill.classList.remove('hidden');
    el.timeRemainingVal.textContent = timeRem;
  } else {
    el.timerPill.classList.add('hidden');
  }

  // Heat Curve Studio Tab passive readouts (when curve is not actively running)
  if (!isCurveRunning && el.curveActualDisplay && el.curveSetpointDisplay) {
    el.curveActualDisplay.textContent = connected && liveTemp > 30 ? `${liveTemp.toFixed(1)}°F` : '--°F';
    el.curveSetpointDisplay.textContent = `${targetTemp.toFixed(1)}°F`;
    if (el.curveElapsedDisplay && currentCurve) {
      el.curveElapsedDisplay.textContent = `READY (0.0s / ${currentCurve.duration_s || 50}s)`;
    }
  }

  // User Controls Disabling / Greying Out
  const controlsEnabled = connected && !isSyncing;

  // Sesh Control Buttons State
  el.startSeshBtn.disabled = !controlsEnabled || isHeating || isCurveRunning;
  el.boostSeshBtn.disabled = !controlsEnabled || !isHeating;
  el.stopSeshBtn.disabled = !controlsEnabled || !isHeating;

  // Run Curve Button State
  if (el.runCurveBtn) {
    el.runCurveBtn.disabled = !controlsEnabled || isHeating || isCurveRunning;
  }

  // Temperature Slider & Wrap
  if (el.tempSlider) {
    el.tempSlider.disabled = !controlsEnabled;
    const wrap = el.tempSlider.closest('.temp-slider-wrap');
    if (wrap) wrap.classList.toggle('disabled', !controlsEnabled);
  }

  // Quick Controls
  if (el.stealthToggle) {
    el.stealthToggle.disabled = !controlsEnabled;
    el.stealthToggle.closest('.control-toggle-card')?.classList.toggle('disabled', !controlsEnabled);
  }
  if (el.lanternToggle) {
    el.lanternToggle.disabled = !controlsEnabled;
    el.lanternToggle.closest('.control-toggle-card')?.classList.toggle('disabled', !controlsEnabled);
  }
  if (el.sleepBtn) el.sleepBtn.disabled = !controlsEnabled;
  if (el.powerOffBtn) el.powerOffBtn.disabled = !controlsEnabled;

  // Lantern Controls Panel Visibility & States
  if (el.lanternControlsPanel) {
    el.lanternControlsPanel.classList.toggle('disabled', !controlsEnabled);
    if (!data.lantern_active) {
      el.lanternControlsPanel.classList.add('hidden');
    } else {
      el.lanternControlsPanel.classList.remove('hidden');
      updateLanternPanelUI(data);
    }
  }

  // Profiles Matrix
  renderProfiles(data.profiles || [], data.active_profile, controlsEnabled);

  // Hardware Diagnostics
  if (isSyncing) {
    el.statTotalDabs.textContent = '--';
    el.statTotalDabs.classList.add('telemetry-syncing');
    el.statMacAddress.textContent = connected && data.mac_address ? data.mac_address : '--';
    el.statFirmwareVersion.textContent = '--';
    el.statFirmwareVersion.classList.add('telemetry-syncing');
  } else {
    el.statTotalDabs.classList.remove('telemetry-syncing');
    el.statFirmwareVersion.classList.remove('telemetry-syncing');
    el.statTotalDabs.textContent = connected ? Number(data.lifetime_dabs || 0).toLocaleString() : '--';
    el.statMacAddress.textContent = connected && data.mac_address ? data.mac_address : '--';
    el.statFirmwareVersion.textContent = connected && data.firmware_version ? data.firmware_version : (connected ? 'V1.3.8' : '--');
  }

  // Stealth & Lantern toggles sync
  el.stealthToggle.checked = !!data.stealth_mode;
  el.lanternToggle.checked = !!data.lantern_active;

  // Sync slider if not actively dragging
  if (!document.activeElement || document.activeElement !== el.tempSlider) {
    el.tempSlider.value = Math.round(targetTemp);
    el.sliderTempVal.textContent = `${Math.round(targetTemp)}°F`;
  }
}

function updateLanternPanelUI(data) {
  const effectName = data.lantern_effect || 'campfire';

  // Update effect buttons active state
  const fxBtns = document.querySelectorAll('.lantern-fx-btn');
  fxBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.effect === effectName);
  });

  // Update aura preview
  if (el.lanternAuraPreview) {
    el.lanternAuraPreview.className = `lantern-aura-preview effect-${effectName}`;
    if (el.lanternActiveEffectName) {
      const effectIcons = {
        campfire: 'Campfire 🔥',
        flicker: 'Candle Flicker 🕯️',
        night_light: 'Night Light 🌙',
        rainbow: 'Rainbow Spectrum 🌈',
        waterfall: 'Waterfall Cascade 🌊',
        breathing: 'Meditative Breath 🧘',
        disco: 'Party Disco ⚡',
        aurora: 'Aurora Borealis 🔮',
      };
      el.lanternActiveEffectName.textContent = effectIcons[effectName] || effectName;
    }
  }

  // Update brightness slider
  if (el.lanternBrightnessSlider && el.lanternBrightnessVal) {
    const rawVal = data.lantern_brightness ?? 255;
    const pct = Math.round((rawVal / 255) * 100);
    if (document.activeElement !== el.lanternBrightnessSlider) {
      el.lanternBrightnessSlider.value = pct;
      el.lanternBrightnessVal.textContent = `${pct}%`;
    }
  }
}

function updateStateBadge(state, stateName, isSyncing = false) {
  const badge = el.stateBadge;
  badge.className = 'state-tag';

  if (isSyncing) {
    badge.classList.add('state-syncing');
    badge.textContent = 'SYNCING DATA...';
    return;
  }

  switch (state) {
    case 'HEAT_PREHEAT':
    case 'HEAT_ACTIVE':
    case 'HEAT_FADE':
      badge.classList.add('state-heating');
      badge.textContent = stateName || 'HEATING';
      break;
    case 'READY':
      badge.classList.add('state-ready');
      badge.textContent = 'READY TO INHALE';
      break;
    case 'COOLDOWN':
      badge.classList.add('state-cooldown');
      badge.textContent = 'COOLING DOWN';
      break;
    case 'IDLE':
      badge.classList.add('state-idle');
      badge.textContent = 'STANDBY / IDLE';
      break;
    case 'SLEEP':
      badge.classList.add('state-sleep');
      badge.textContent = 'SLEEP MODE';
      break;
    default:
      badge.classList.add('state-disconnected');
      badge.textContent = stateName || 'DISCONNECTED';
      break;
  }
}

function updateGauge(liveTemp, targetTemp, isHeating, state) {
  const maxArc = 502.65;
  const minDialTemp = 400;
  const maxDialTemp = 600;

  let livePct = 0;
  if (liveTemp >= minDialTemp) {
    livePct = Math.max(0, Math.min(1, (liveTemp - minDialTemp) / (maxDialTemp - minDialTemp)));
  }
  const offset = maxArc * (1 - livePct);
  el.dialProgress.style.strokeDashoffset = offset;

  // Setpoint needle calibrated to 400°F - 600°F arc
  const targetPct = Math.max(0, Math.min(1, (targetTemp - minDialTemp) / (maxDialTemp - minDialTemp)));
  const needleAngle = targetPct * 240;

  if (el.dialNeedleGroup) {
    el.dialNeedleGroup.setAttribute('transform', `rotate(${needleAngle} 160 160)`);
    el.dialNeedleGroup.style.transform = `rotate(${needleAngle}deg)`;
  }

  el.gaugeHalo.className = 'gauge-glow-halo';
  if (state === 'READY') {
    el.gaugeHalo.classList.add('ready');
  } else if (isHeating) {
    el.gaugeHalo.classList.add('heating');
  }
}

function updateLiveSessionGraph(data, isHeating, liveTemp, targetTemp) {
  if (!el.lsgTargetLine) return;

  el.lsgTargetReadout.textContent = `${Math.round(targetTemp)}°`;
  el.lsgLiveReadout.textContent = liveTemp > 30 ? `${Math.round(liveTemp)}°` : '--°';

  // Position target line (70°F to 600°F -> y: 148 to 16)
  const targetNorm = Math.max(0, Math.min(1, (targetTemp - 70) / (600 - 70)));
  const targetY = 148 - targetNorm * (148 - 16);
  el.lsgTargetLine.setAttribute('y1', targetY);
  el.lsgTargetLine.setAttribute('y2', targetY);

  const totalDuration = Number(data.total_time || 50);

  // Detect session start
  if (isHeating && !wasHeating) {
    sessionStartTime = performance.now();
    lastPointRecordTime = sessionStartTime;
    liveSessionPoints = [{ t: 0, temp: liveTemp }];
    sessionPeakTemp = liveTemp;
    sessionTempSum = liveTemp;
    sessionTempCount = 1;
    el.lsgTrailArea.setAttribute('d', '');
    el.lsgTrailStroke.setAttribute('d', '');
    if (el.lsgLiveDotGroup) el.lsgLiveDotGroup.classList.remove('hidden');
    el.lsgLiveDot.classList.remove('hidden');
  }

  // During active heating
  if (isHeating && sessionStartTime !== null) {
    const now = performance.now();
    const elapsed = Math.max(0, (now - sessionStartTime) / 1000);
    const opState = data.operating_state || '';

    if (opState === 'HEAT_PREHEAT') {
      el.lsgPhasePill.className = 'badge badge-warning';
      el.lsgPhasePill.textContent = 'PREHEATING';
    } else if (opState === 'READY') {
      el.lsgPhasePill.className = 'badge badge-info';
      el.lsgPhasePill.textContent = 'READY TO INHALE';
    } else {
      el.lsgPhasePill.className = 'badge badge-success';
      el.lsgPhasePill.textContent = 'EXTRACTING';
    }

    if (now - lastPointRecordTime >= 300) {
      lastPointRecordTime = now;
      liveSessionPoints.push({ t: elapsed, temp: liveTemp });
      sessionPeakTemp = Math.max(sessionPeakTemp, liveTemp);
      sessionTempSum += liveTemp;
      sessionTempCount++;

      // Render live SVG trail
      renderLiveSessionTrail(totalDuration);
    }

    el.lsgTimeStat.textContent = `${Math.round(elapsed)}s / ${totalDuration}s`;
    el.lsgPeakStat.textContent = `${Math.round(sessionPeakTemp)}°F`;
    const avg = sessionTempCount > 0 ? Math.round(sessionTempSum / sessionTempCount) : Math.round(liveTemp);
    el.lsgAvgStat.textContent = `${avg}°F`;
  } else if (!isHeating && wasHeating) {
    el.lsgPhasePill.className = 'badge badge-subtle';
    el.lsgPhasePill.textContent = 'COMPLETE';
    if (el.lsgLiveDotGroup) el.lsgLiveDotGroup.classList.add('hidden');
    el.lsgLiveDot.classList.add('hidden');
  }

  wasHeating = isHeating;
}

function renderLiveSessionTrail(totalDuration) {
  if (liveSessionPoints.length < 2) return;

  const width = 500;
  const height = 160;
  const minY = 148;
  const maxY = 16;
  const minTemp = 70;
  const maxTemp = 600;

  const maxT = Math.max(totalDuration, liveSessionPoints[liveSessionPoints.length - 1].t, 30);

  function ptToSvg(pt) {
    const x = Math.min(width, (pt.t / maxT) * width);
    const normY = Math.max(0, Math.min(1, (pt.temp - minTemp) / (maxTemp - minTemp)));
    const y = minY - normY * (minY - maxY);
    return { x, y };
  }

  let strokeD = '';
  let areaD = '';

  liveSessionPoints.forEach((pt, idx) => {
    const { x, y } = ptToSvg(pt);
    if (idx === 0) {
      strokeD = `M ${x} ${y}`;
      areaD = `M ${x} ${height} L ${x} ${y}`;
    } else {
      strokeD += ` L ${x} ${y}`;
      areaD += ` L ${x} ${y}`;
    }
  });

  const lastPt = ptToSvg(liveSessionPoints[liveSessionPoints.length - 1]);
  areaD += ` L ${lastPt.x} ${height} Z`;

  el.lsgTrailStroke.setAttribute('d', strokeD);
  el.lsgTrailArea.setAttribute('d', areaD);

  if (el.lsgLiveDotGroup) {
    const lsgRect = el.lsgSvg ? el.lsgSvg.getBoundingClientRect() : null;
    const lsgKx = lsgRect && lsgRect.width > 0 ? 500 / lsgRect.width : 1;
    const lsgKy = lsgRect && lsgRect.height > 0 ? 160 / lsgRect.height : 1;
    el.lsgLiveDotGroup.dataset.x = lastPt.x;
    el.lsgLiveDotGroup.dataset.y = lastPt.y;
    el.lsgLiveDotGroup.setAttribute('transform', `translate(${lastPt.x}, ${lastPt.y}) scale(${lsgKx}, ${lsgKy})`);
    el.lsgLiveDotGroup.classList.remove('hidden');
  }
  el.lsgLiveDot.setAttribute('cx', 0);
  el.lsgLiveDot.setAttribute('cy', 0);
  el.lsgLiveDot.classList.remove('hidden');

  // Scale x-axis ticks
  el.lsgT1.textContent = `${Math.round(maxT * 0.25)}s`;
  el.lsgT2.textContent = `${Math.round(maxT * 0.5)}s`;
  el.lsgT3.textContent = `${Math.round(maxT * 0.75)}s`;
  el.lsgT4.textContent = `${Math.round(maxT)}s`;
}

function renderProfiles(profiles, activeSlot, connected) {
  const defaultProfiles = [
    { slot: 0, name: 'Low', target_temp_f: 480, duration_s: 50 },
    { slot: 1, name: 'Medium', target_temp_f: 485, duration_s: 60 },
    { slot: 2, name: 'High', target_temp_f: 530, duration_s: 40 },
    { slot: 3, name: 'ROSIN', target_temp_f: 465, duration_s: 90 },
  ];

  const list = profiles && profiles.length === 4 ? profiles : defaultProfiles;
  const existingCards = el.profilesContainer.querySelectorAll('.profile-card');

  // If cards already exist and match count, update in-place without rebuilding DOM tree
  if (existingCards.length === list.length && existingCards.length > 0) {
    list.forEach((p, idx) => {
      const card = existingCards[idx];
      const slot = p.slot ?? idx;
      const isActive = connected && slot === activeSlot;
      card.dataset.slot = slot;
      card.classList.toggle('active', isActive);
      card.classList.toggle('disabled', !connected);

      const nameEl = card.querySelector('.profile-name');
      const tempEl = card.querySelector('.p-temp');
      const durEl = card.querySelector('.p-dur');

      const nameText = p.name || `Profile ${idx + 1}`;
      const tempText = `${p.target_temp_f}°F`;
      const durText = `${p.duration_s || 50}s`;

      if (nameEl && nameEl.textContent !== nameText) nameEl.textContent = nameText;
      if (tempEl && tempEl.textContent !== tempText) tempEl.textContent = tempText;
      if (durEl && durEl.textContent !== durText) durEl.textContent = durText;
    });
    return;
  }

  // Initial creation or card count mismatch
  el.profilesContainer.innerHTML = '';

  list.forEach((p, idx) => {
    const card = document.createElement('div');
    const slot = p.slot ?? idx;
    const isActive = connected && slot === activeSlot;
    card.className = `profile-card ${isActive ? 'active' : ''} ${connected ? '' : 'disabled'}`;
    card.dataset.slot = slot;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const slotBadge = document.createElement('div');
    slotBadge.className = 'profile-slot-badge';
    slotBadge.textContent = `SLOT ${slot + 1}`;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'profile-name';
    nameDiv.textContent = p.name || `Profile ${idx + 1}`;

    const specsDiv = document.createElement('div');
    specsDiv.className = 'profile-specs';

    const tempSpan = document.createElement('span');
    tempSpan.className = 'p-temp';
    tempSpan.textContent = `${p.target_temp_f}°F`;

    const durSpan = document.createElement('span');
    durSpan.className = 'p-dur';
    durSpan.textContent = `${p.duration_s || 50}s`;

    specsDiv.appendChild(tempSpan);
    specsDiv.appendChild(durSpan);

    card.appendChild(slotBadge);
    card.appendChild(nameDiv);
    card.appendChild(specsDiv);

    card.addEventListener('click', async () => {
      if (!currentTelemetry?.connected || currentTelemetry?.is_syncing) {
        showToast('Connect device to change heat profile', 'error');
        return;
      }
      try {
        await activeClient.setProfile(slot);
        showToast(`Profile ${slot + 1} (${p.name || 'Slot ' + (slot + 1)}) activated`, 'info');
      } catch (err) {
        showToast(`Failed to set profile: ${err.message}`, 'error');
      }
    });

    el.profilesContainer.appendChild(card);
  });
}

// ==========================================================================
// Heat Curve Studio Logic & SVG Canvas
// ==========================================================================

const GRAPH_WIDTH = 800;
const GRAPH_HEIGHT = 360;
const TIME_MAX = 90;
const TEMP_MIN = 400;
const TEMP_MAX = 580;

function timeToX(t) {
  return (Math.max(0, Math.min(TIME_MAX, t)) / TIME_MAX) * GRAPH_WIDTH;
}

function xToTime(x) {
  return Math.round((Math.max(0, Math.min(GRAPH_WIDTH, x)) / GRAPH_WIDTH) * TIME_MAX);
}

function tempToY(t) {
  const norm = (Math.max(TEMP_MIN, Math.min(TEMP_MAX, t)) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
  return (1 - norm) * (GRAPH_HEIGHT - 36) + 18;
}

function yToTemp(y) {
  const clampedY = Math.max(18, Math.min(GRAPH_HEIGHT - 18, y));
  const norm = 1 - (clampedY - 18) / (GRAPH_HEIGHT - 36);
  return Math.round(TEMP_MIN + norm * (TEMP_MAX - TEMP_MIN));
}

function renderCurveGraph() {
  if (!currentCurve) return;
  const kfs = currentCurve.keyframes;
  if (!kfs || kfs.length === 0) return;

  let pathD = '';
  let areaD = '';

  kfs.forEach((k, idx) => {
    const x = timeToX(k.time_s);
    const y = tempToY(k.temp_f);

    if (idx === 0) {
      pathD = `M ${x} ${y}`;
      areaD = `M ${x} ${GRAPH_HEIGHT} L ${x} ${y}`;
    } else {
      pathD += ` L ${x} ${y}`;
      areaD += ` L ${x} ${y}`;
    }
  });

  const lastX = timeToX(kfs[kfs.length - 1].time_s);
  areaD += ` L ${lastX} ${GRAPH_HEIGHT} Z`;

  el.curveStrokePath.setAttribute('d', pathD);
  el.curveAreaPath.setAttribute('d', areaD);

  // Render draggable control nodes inside counter-scaled groups (ensures perfect circles on any aspect ratio)
  const rect = el.curveSvg.getBoundingClientRect();
  const kx = rect.width > 0 ? GRAPH_WIDTH / rect.width : 1;
  const ky = rect.height > 0 ? GRAPH_HEIGHT / rect.height : 1;
  const isMobile = window.innerWidth <= 768;
  const hitR = isMobile ? '32' : '20';
  const nodeR = isMobile ? '14' : '9';
  const innerR = isMobile ? '4.5' : '3';

  const existingGroups = el.curvePointsLayer.querySelectorAll('.curve-node-group');
  if (existingGroups.length === kfs.length) {
    kfs.forEach((k, idx) => {
      const x = timeToX(k.time_s);
      const y = tempToY(k.temp_f);
      const group = existingGroups[idx];
      group.dataset.x = x;
      group.dataset.y = y;
      group.setAttribute('transform', `translate(${x}, ${y}) scale(${kx}, ${ky})`);
      group.classList.toggle('dragging', !isCurveRunning && isDraggingNode && draggingNodeIndex === idx);
    });
  } else {
    el.curvePointsLayer.innerHTML = '';
    kfs.forEach((k, idx) => {
      const x = timeToX(k.time_s);
      const y = tempToY(k.temp_f);

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `curve-node-group${!isCurveRunning && isDraggingNode && draggingNodeIndex === idx ? ' dragging' : ''}`);
      group.setAttribute('transform', `translate(${x}, ${y}) scale(${kx}, ${ky})`);
      group.dataset.index = idx;
      group.dataset.x = x;
      group.dataset.y = y;

      // Transparent hit target for effortless mobile/desktop grabbing
      const hitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitCircle.setAttribute('cx', '0');
      hitCircle.setAttribute('cy', '0');
      hitCircle.setAttribute('r', hitR);
      hitCircle.setAttribute('class', 'curve-node-hit');

      // Visual outer circular ring
      const visualCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      visualCircle.setAttribute('cx', '0');
      visualCircle.setAttribute('cy', '0');
      visualCircle.setAttribute('r', nodeR);
      visualCircle.setAttribute('class', 'curve-node');

      // Visual inner reticle dot
      const innerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      innerDot.setAttribute('cx', '0');
      innerDot.setAttribute('cy', '0');
      innerDot.setAttribute('r', innerR);
      innerDot.setAttribute('class', 'curve-node-inner');

      group.appendChild(hitCircle);
      group.appendChild(visualCircle);
      group.appendChild(innerDot);

      // Mouse drag
      group.addEventListener('mousedown', (e) => {
        if (isCurveRunning) return;
        e.stopPropagation();
        isDraggingNode = true;
        draggingNodeIndex = idx;
        justDragged = true;
        group.classList.add('dragging');
        const nodeX = timeToX(k.time_s);
        const nodeY = tempToY(k.temp_f);
        updateDragTooltip(nodeX, nodeY, k.time_s, k.temp_f);
      });

      // Touch drag on mobile
      group.addEventListener('touchstart', (e) => {
        if (isCurveRunning) return;
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        isDraggingNode = true;
        draggingNodeIndex = idx;
        justDragged = true;
        group.classList.add('dragging');
        const nodeX = timeToX(k.time_s);
        const nodeY = tempToY(k.temp_f);
        updateDragTooltip(nodeX, nodeY, k.time_s, k.temp_f);
        if (navigator.vibrate) navigator.vibrate(10);
      }, { passive: false });

      // Double-click to delete
      group.addEventListener('dblclick', (e) => {
        if (isCurveRunning) return;
        e.stopPropagation();
        deleteKeyframe(idx);
      });

      // Double-tap on mobile to delete
      let lastTapTime = 0;
      group.addEventListener('touchend', (e) => {
        if (isCurveRunning) return;
        const now = Date.now();
        if (now - lastTapTime < 320 && now - lastTapTime > 0) {
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          deleteKeyframe(idx);
        }
        lastTapTime = now;
      });

      el.curvePointsLayer.appendChild(group);
    });
  }

  // Meta labels
  el.activeCurveTitle.textContent = currentCurve.name;
  el.activeCurveDesc.textContent = currentCurve.description || '';
  el.curveDurationBadge.textContent = `${currentCurve.duration_s}s Sesh`;
  if (!isCurveRunning) {
    el.curveElapsedDisplay.textContent = `0.0s / ${currentCurve.duration_s}s`;
    el.curveSetpointDisplay.textContent = `${kfs[0].temp_f}°F`;
  }

  renderKeyframeTable();
}

function renderKeyframeTable() {
  el.keyframeTableBody.innerHTML = '';
  currentCurve.keyframes.forEach((k, idx) => {
    const tr = document.createElement('tr');

    const tdIdx = document.createElement('td');
    tdIdx.textContent = idx + 1;

    const tdTime = document.createElement('td');
    const inputTime = document.createElement('input');
    inputTime.type = 'number';
    inputTime.className = 'kf-input';
    inputTime.step = '5';
    inputTime.value = k.time_s;
    inputTime.min = 0;
    inputTime.max = TIME_MAX;
    inputTime.disabled = isCurveRunning;
    inputTime.addEventListener('change', (e) => {
      if (isCurveRunning) return;
      k.time_s = Math.max(0, Math.min(TIME_MAX, Number(e.target.value)));
      sortAndRefreshCurve();
    });
    tdTime.appendChild(inputTime);

    const tdTemp = document.createElement('td');
    const inputTemp = document.createElement('input');
    inputTemp.type = 'number';
    inputTemp.className = 'kf-input';
    inputTemp.step = '5';
    inputTemp.value = k.temp_f;
    inputTemp.min = TEMP_MIN;
    inputTemp.max = TEMP_MAX;
    inputTemp.disabled = isCurveRunning;
    inputTemp.addEventListener('change', (e) => {
      if (isCurveRunning) return;
      k.temp_f = Math.max(TEMP_MIN, Math.min(TEMP_MAX, Number(e.target.value)));
      renderCurveGraph();
    });
    tdTemp.appendChild(inputTemp);

    const tdAction = document.createElement('td');
    const btnDel = document.createElement('button');
    btnDel.className = 'btn-delete-node';
    btnDel.textContent = '✕';
    btnDel.title = 'Remove keyframe';
    btnDel.disabled = isCurveRunning;
    btnDel.addEventListener('click', () => {
      if (isCurveRunning) return;
      deleteKeyframe(idx);
    });
    tdAction.appendChild(btnDel);

    tr.appendChild(tdIdx);
    tr.appendChild(tdTime);
    tr.appendChild(tdTemp);
    tr.appendChild(tdAction);

    el.keyframeTableBody.appendChild(tr);
  });
}

function sortAndRefreshCurve() {
  if (isCurveRunning) return;
  currentCurve.keyframes.sort((a, b) => a.time_s - b.time_s);
  const lastKf = currentCurve.keyframes[currentCurve.keyframes.length - 1];
  currentCurve.duration_s = lastKf ? lastKf.time_s : 50;
  renderCurveGraph();
}

function deleteKeyframe(idx) {
  if (isCurveRunning) {
    showToast('Cannot modify keyframes while heat curve is executing', 'warning');
    return;
  }
  if (currentCurve.keyframes.length <= 2) {
    showToast('Curves require at least 2 keyframes (start and finish)', 'error');
    return;
  }
  currentCurve.keyframes.splice(idx, 1);
  sortAndRefreshCurve();
  showToast('Keyframe removed', 'info');
}

function addKeyframe(time_s, temp_f) {
  if (isCurveRunning) {
    showToast('Cannot add keyframes while heat curve is executing', 'warning');
    return;
  }
  const snappedTime = Math.max(0, Math.min(TIME_MAX, Math.round(time_s / 5) * 5));
  const snappedTemp = Math.max(TEMP_MIN, Math.min(TEMP_MAX, Math.round(temp_f / 5) * 5));
  currentCurve.keyframes.push({
    time_s: snappedTime,
    temp_f: snappedTemp,
  });
  sortAndRefreshCurve();
  showToast(`Added keyframe at ${snappedTime}s, ${snappedTemp}°F`, 'info');
}

// ==========================================================================
// Touch & Mouse Dragging for Curve Canvas
// ==========================================================================

function updateDragTooltip(x, y, time_s, temp_f) {
  if (!el.curveDragTooltip) return;
  const rect = el.curveSvg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const kx = GRAPH_WIDTH / rect.width;
  const ky = GRAPH_HEIGHT / rect.height;
  const isMobile = window.innerWidth <= 768;

  el.curveDragTooltip.setAttribute('transform', `translate(${x}, ${y}) scale(${kx}, ${ky})`);
  el.curveDragTooltip.classList.remove('hidden');

  const timeText = el.curveDragTooltip.querySelector('.drag-val-time');
  const tempText = el.curveDragTooltip.querySelector('.drag-val-temp');
  if (timeText) timeText.textContent = `${time_s}s`;
  if (tempText) tempText.textContent = `${temp_f}°F`;

  const isNearTop = y < 65;
  const bg = el.curveDragTooltip.querySelector('.drag-tooltip-bg');
  const arrowDown = el.curveDragTooltip.querySelector('.drag-tooltip-arrow');
  const arrowUp = el.curveDragTooltip.querySelector('.drag-tooltip-arrow-flip');
  const text = el.curveDragTooltip.querySelector('.drag-tooltip-text');

  const yOffset = isMobile ? (isNearTop ? 28 : -52) : (isNearTop ? 22 : -44);
  const textY = isMobile ? (isNearTop ? 44 : -36) : (isNearTop ? 37 : -29);
  const arrowDownPoints = isMobile ? "-7,-22 7,-22 0,-14" : "-6,-18 6,-18 0,-11";
  const arrowUpPoints = isMobile ? "-7,22 7,22 0,14" : "-6,18 6,18 0,11";

  const screenX = (x / GRAPH_WIDTH) * rect.width;
  let shiftX = 0;
  if (screenX < 65) {
    shiftX = (65 - screenX);
  } else if (screenX > rect.width - 65) {
    shiftX = -((screenX + 65) - rect.width);
  }

  if (bg) {
    const w = isMobile ? 116 : 104;
    const h = isMobile ? 34 : 28;
    bg.setAttribute('x', (-w / 2) + shiftX);
    bg.setAttribute('y', yOffset);
    bg.setAttribute('width', w);
    bg.setAttribute('height', h);
  }

  if (text) {
    text.setAttribute('x', shiftX);
    text.setAttribute('y', textY);
  }

  if (arrowDown && arrowUp) {
    arrowDown.setAttribute('points', arrowDownPoints);
    arrowUp.setAttribute('points', arrowUpPoints);
    if (isNearTop) {
      arrowDown.classList.add('hidden');
      arrowUp.classList.remove('hidden');
    } else {
      arrowDown.classList.remove('hidden');
      arrowUp.classList.add('hidden');
    }
  }
}

function hideDragTooltip() {
  if (el.curveDragTooltip) {
    el.curveDragTooltip.classList.add('hidden');
  }
}

function updateNodeScales() {
  if (!el.curveSvg) return;
  const rect = el.curveSvg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const kx = GRAPH_WIDTH / rect.width;
  const ky = GRAPH_HEIGHT / rect.height;
  const isMobile = window.innerWidth <= 768;
  const hitR = isMobile ? '32' : '20';
  const nodeR = isMobile ? '14' : '9';
  const innerR = isMobile ? '4.5' : '3';

  const groups = el.curvePointsLayer ? el.curvePointsLayer.querySelectorAll('.curve-node-group') : [];
  groups.forEach((g) => {
    const x = g.dataset.x;
    const y = g.dataset.y;
    if (x !== undefined && y !== undefined) {
      g.setAttribute('transform', `translate(${x}, ${y}) scale(${kx}, ${ky})`);
    }
    const hitCircle = g.querySelector('.curve-node-hit');
    const visualCircle = g.querySelector('.curve-node');
    const innerDot = g.querySelector('.curve-node-inner');
    if (hitCircle) hitCircle.setAttribute('r', hitR);
    if (visualCircle) visualCircle.setAttribute('r', nodeR);
    if (innerDot) innerDot.setAttribute('r', innerR);
  });

  if (isDraggingNode && draggingNodeIndex >= 0 && currentCurve && currentCurve.keyframes[draggingNodeIndex]) {
    const kf = currentCurve.keyframes[draggingNodeIndex];
    updateDragTooltip(timeToX(kf.time_s), tempToY(kf.temp_f), kf.time_s, kf.temp_f);
  }

  if (el.curvePlayheadDotGroup && el.curvePlayheadDotGroup.dataset.x) {
    const px = el.curvePlayheadDotGroup.dataset.x;
    const py = el.curvePlayheadDotGroup.dataset.y;
    el.curvePlayheadDotGroup.setAttribute('transform', `translate(${px}, ${py}) scale(${kx}, ${ky})`);
  }

  if (el.lsgSvg && el.lsgLiveDotGroup && el.lsgLiveDotGroup.dataset.x) {
    const lsgRect = el.lsgSvg.getBoundingClientRect();
    if (lsgRect.width > 0 && lsgRect.height > 0) {
      const lsgKx = 500 / lsgRect.width;
      const lsgKy = 160 / lsgRect.height;
      const lx = el.lsgLiveDotGroup.dataset.x;
      const ly = el.lsgLiveDotGroup.dataset.y;
      el.lsgLiveDotGroup.setAttribute('transform', `translate(${lx}, ${ly}) scale(${lsgKx}, ${lsgKy})`);
    }
  }
}

function setCurveLocked(locked) {
  if (locked) {
    if (isDraggingNode) {
      isDraggingNode = false;
      draggingNodeIndex = -1;
      justDragged = false;
      hideDragTooltip();
    }
    if (el.curveGraphContainer) el.curveGraphContainer.classList.add('locked');
    if (el.curveSvg) el.curveSvg.classList.add('locked');
    if (el.curvePointsLayer) el.curvePointsLayer.classList.add('locked');
    if (el.curveLockedBadge) el.curveLockedBadge.classList.remove('hidden');
    if (el.curvePillsContainer) el.curvePillsContainer.classList.add('locked');
    if (el.keyframeEditorSection) el.keyframeEditorSection.classList.add('locked');
    if (el.addKeyframeBtn) el.addKeyframeBtn.disabled = true;
    if (el.newCurveBtn) el.newCurveBtn.disabled = true;
    if (el.saveCurveBtn) el.saveCurveBtn.disabled = true;
    if (el.keyframeTableBody) {
      el.keyframeTableBody.querySelectorAll('input, button').forEach((elem) => {
        elem.disabled = true;
      });
    }
  } else {
    if (el.curveGraphContainer) el.curveGraphContainer.classList.remove('locked');
    if (el.curveSvg) el.curveSvg.classList.remove('locked');
    if (el.curvePointsLayer) el.curvePointsLayer.classList.remove('locked');
    if (el.curveLockedBadge) el.curveLockedBadge.classList.add('hidden');
    if (el.curvePillsContainer) el.curvePillsContainer.classList.remove('locked');
    if (el.keyframeEditorSection) el.keyframeEditorSection.classList.remove('locked');
    if (el.addKeyframeBtn) el.addKeyframeBtn.disabled = false;
    if (el.newCurveBtn) el.newCurveBtn.disabled = false;
    if (el.saveCurveBtn) el.saveCurveBtn.disabled = false;
    if (el.keyframeTableBody) {
      el.keyframeTableBody.querySelectorAll('input, button').forEach((elem) => {
        elem.disabled = false;
      });
    }
  }
}

function setupSvgInteraction() {
  const svg = el.curveSvg;

  function getSvgCoords(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const scaleX = GRAPH_WIDTH / rect.width;
    const scaleY = GRAPH_HEIGHT / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  // Click on canvas to add setpoint
  svg.addEventListener('click', (e) => {
    if (isCurveRunning || isDraggingNode || justDragged) return;
    const coords = getSvgCoords(e.clientX, e.clientY);
    const time = xToTime(coords.x);
    const temp = yToTemp(coords.y);
    addKeyframe(time, temp);
  });

  // Touchstart proximity check on canvas to grab nearby node
  svg.addEventListener('touchstart', (e) => {
    if (isCurveRunning || isDraggingNode) return;
    const touch = e.touches[0];
    if (!touch || !currentCurve || !currentCurve.keyframes) return;
    const coords = getSvgCoords(touch.clientX, touch.clientY);

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const kx = GRAPH_WIDTH / rect.width;
    const ky = GRAPH_HEIGHT / rect.height;

    let closestIdx = -1;
    let closestDistPx = Infinity;

    currentCurve.keyframes.forEach((kf, idx) => {
      const kfX = timeToX(kf.time_s);
      const kfY = tempToY(kf.temp_f);
      const dxPx = (coords.x - kfX) / kx;
      const dyPx = (coords.y - kfY) / ky;
      const distPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
      if (distPx < closestDistPx) {
        closestDistPx = distPx;
        closestIdx = idx;
      }
    });

    if (closestDistPx <= 38 && closestIdx >= 0) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      isDraggingNode = true;
      draggingNodeIndex = closestIdx;
      justDragged = true;
      const groups = el.curvePointsLayer.querySelectorAll('.curve-node-group');
      if (groups[closestIdx]) {
        groups[closestIdx].classList.add('dragging');
      }
      const kf = currentCurve.keyframes[closestIdx];
      if (kf) {
        updateDragTooltip(timeToX(kf.time_s), tempToY(kf.temp_f), kf.time_s, kf.temp_f);
      }
      if (navigator.vibrate) navigator.vibrate(10);
    }
  }, { passive: false });

  // Mouse drag
  window.addEventListener('mousemove', (e) => {
    if (isCurveRunning || !isDraggingNode || draggingNodeIndex < 0) return;
    const coords = getSvgCoords(e.clientX, e.clientY);
    applyNodeDrag(coords.x, coords.y, e.shiftKey);
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingNode) {
      isDraggingNode = false;
      draggingNodeIndex = -1;
      hideDragTooltip();
      if (!isCurveRunning) sortAndRefreshCurve();
      setTimeout(() => { justDragged = false; }, 120);
    }
  });

  // Touch drag for mobile screens — preventDefault stops window scrolling completely
  window.addEventListener('touchmove', (e) => {
    if (isCurveRunning || !isDraggingNode || draggingNodeIndex < 0) return;
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    if (touch) {
      const coords = getSvgCoords(touch.clientX, touch.clientY);
      applyNodeDrag(coords.x, coords.y, false);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (isDraggingNode) {
      isDraggingNode = false;
      draggingNodeIndex = -1;
      hideDragTooltip();
      if (!isCurveRunning) sortAndRefreshCurve();
      setTimeout(() => { justDragged = false; }, 120);
    }
  });

  window.addEventListener('touchcancel', () => {
    if (isDraggingNode) {
      isDraggingNode = false;
      draggingNodeIndex = -1;
      hideDragTooltip();
      if (!isCurveRunning) sortAndRefreshCurve();
      justDragged = false;
    }
  });

  function applyNodeDrag(x, y, isFinePrecision = false) {
    if (isCurveRunning || !isDraggingNode || draggingNodeIndex < 0 || !currentCurve) return;
    justDragged = true;
    const rawTime = xToTime(x);
    const rawTemp = yToTemp(y);

    const stepTime = isFinePrecision ? 1 : 5;
    const stepTemp = isFinePrecision ? 1 : 5;

    const time = Math.max(0, Math.min(TIME_MAX, Math.round(rawTime / stepTime) * stepTime));
    const temp = Math.max(TEMP_MIN, Math.min(TEMP_MAX, Math.round(rawTemp / stepTemp) * stepTemp));

    const kf = currentCurve.keyframes[draggingNodeIndex];
    if (kf) {
      const changed = (kf.time_s !== time || kf.temp_f !== temp);
      kf.time_s = time;
      kf.temp_f = temp;
      renderCurveGraph();

      const nodeX = timeToX(time);
      const nodeY = tempToY(temp);
      updateDragTooltip(nodeX, nodeY, time, temp);

      if (changed && navigator.vibrate) {
        try { navigator.vibrate(6); } catch (_) {}
      }
    }
  }

  // Window resize & orientation change to keep circles perfectly round
  window.addEventListener('resize', updateNodeScales);
  window.addEventListener('orientationchange', () => {
    setTimeout(updateNodeScales, 150);
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      updateNodeScales();
    });
    if (el.curveSvg) ro.observe(el.curveSvg);
    if (el.lsgSvg) ro.observe(el.lsgSvg);
  }

  el.addKeyframeBtn.addEventListener('click', () => {
    if (isCurveRunning) {
      showToast('Cannot add keyframes while heat curve is executing', 'warning');
      return;
    }
    const last = currentCurve.keyframes[currentCurve.keyframes.length - 1];
    const newTime = last ? Math.min(TIME_MAX, last.time_s + 10) : 30;
    addKeyframe(newTime, 485);
  });
}

// ==========================================================================
// Curve Presets & Persistence
// ==========================================================================

function loadCurvesList() {
  curvesList = curveStorage.listAll();
  renderCurvePills();

  // Check URL Hash for shared curve: #curve=...
  if (location.hash && location.hash.startsWith('#curve=')) {
    try {
      const base64 = location.hash.replace('#curve=', '');
      const json = decodeURIComponent(atob(base64));
      const shared = JSON.parse(json);
      if (shared && shared.keyframes) {
        currentCurve = shared;
        curveStorage.upsert(shared);
        showToast(`Loaded shared curve "${shared.name}"!`, 'success');
      }
    } catch (e) {
      console.warn('Could not parse shared curve from URL hash:', e);
    }
  }

  if (!currentCurve) {
    currentCurve = JSON.parse(JSON.stringify(curvesList[0]));
  }
}

function renderCurvePills() {
  el.curvePillsContainer.innerHTML = '';
  curvesList.forEach((c) => {
    const pill = document.createElement('button');
    pill.className = `curve-pill ${currentCurve && c.id === currentCurve.id ? 'active' : ''}`;
    pill.innerHTML = `<span class="curve-pill-dot"></span><span>${c.name}</span>`;
    pill.addEventListener('click', () => selectCurve(c));
    el.curvePillsContainer.appendChild(pill);
  });
}

function selectCurve(curve) {
  if (isCurveRunning) {
    showToast('Curve is actively executing. Stop before switching curves.', 'warning');
    return;
  }
  currentCurve = JSON.parse(JSON.stringify(curve));
  const pills = el.curvePillsContainer.querySelectorAll('.curve-pill');
  if (pills.length === curvesList.length && pills.length > 0) {
    curvesList.forEach((c, idx) => {
      pills[idx].classList.toggle('active', c.id === currentCurve.id);
    });
  } else {
    renderCurvePills();
  }
  renderCurveGraph();
}

function setupCurveActions() {
  // New Curve
  el.newCurveBtn.addEventListener('click', () => {
    if (isCurveRunning) {
      showToast('Cannot create a new curve while a curve is running', 'warning');
      return;
    }
    currentCurve = {
      id: `custom-${Date.now().toString(36)}`,
      name: 'Custom Curve',
      description: 'User-defined custom temperature profile',
      duration_s: 50,
      keyframes: [
        { time_s: 0, temp_f: 435 },
        { time_s: 25, temp_f: 485 },
        { time_s: 50, temp_f: 515 },
      ],
    };
    renderCurvePills();
    renderCurveGraph();
    showToast('New curve draft created', 'info');
  });

  // Save Curve Modal
  el.saveCurveBtn.addEventListener('click', () => {
    if (isCurveRunning) {
      showToast('Cannot modify or save curves while a curve is running', 'warning');
      return;
    }
    el.saveCurveNameInput.value = currentCurve.name;
    el.saveCurveDescInput.value = currentCurve.description || '';
    el.saveCurveModal.classList.remove('hidden');
  });

  el.closeSaveCurveModal.addEventListener('click', () => {
    el.saveCurveModal.classList.add('hidden');
  });

  el.confirmSaveCurveBtn.addEventListener('click', () => {
    const name = el.saveCurveNameInput.value.trim() || 'Custom Curve';
    const desc = el.saveCurveDescInput.value.trim();
    currentCurve.name = name;
    currentCurve.description = desc;

    curveStorage.upsert(currentCurve);
    curvesList = curveStorage.listAll();
    renderCurvePills();
    renderCurveGraph();

    showToast(`Curve "${name}" saved to library!`, 'success');
    el.saveCurveModal.classList.add('hidden');
  });

  // Share Curve Modal
  el.shareCurveBtn.addEventListener('click', () => {
    const json = JSON.stringify(currentCurve);
    const base64 = btoa(encodeURIComponent(json));
    const url = `${location.origin}${location.pathname}#curve=${base64}`;

    el.shareLinkInput.value = url;
    el.shareJsonInput.value = JSON.stringify(currentCurve, null, 2);
    el.shareCurveModal.classList.remove('hidden');
  });

  el.closeShareCurveModal.addEventListener('click', () => {
    el.shareCurveModal.classList.add('hidden');
  });

  el.copyShareLinkBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.shareLinkInput.value);
      showToast('Share link copied to clipboard! 📋', 'success');
    } catch (e) {
      el.shareLinkInput.select();
      document.execCommand('copy');
      showToast('Link copied!', 'success');
    }
  });

  // Run Curve
  el.runCurveBtn.addEventListener('click', async () => {
    if (isCurveRunning) return;
    if (!currentTelemetry?.connected) {
      showToast('Connect your Puff device to run this curve', 'error');
      return;
    }

    actualTrailPoints = [];
    el.curveActualTrail.setAttribute('d', '');
    el.runCurveBtn.disabled = true;
    el.runCurveBtnLabel.textContent = 'STARTING...';

    try {
      curveGovernor.client = activeClient;
      isCurveRunning = true;
      setCurveLocked(true);
      el.runCurveBtn.disabled = false;
      el.runCurveBtnLabel.textContent = 'RUNNING CURVE...';
      el.stopCurveBtn.disabled = false;
      el.curveStatusBadge.className = 'state-tag state-heating';
      el.curveStatusBadge.textContent = 'HEATING CURVE';
      el.curvePlayheadLine.classList.remove('hidden');
      if (el.curvePlayheadDotGroup) el.curvePlayheadDotGroup.classList.remove('hidden');
      el.curvePlayheadDot.classList.remove('hidden');

      showToast(`Executing curve "${currentCurve.name}"! 🔥`, 'success');
      await curveGovernor.run(currentCurve);
    } catch (err) {
      showToast(err.message || 'Failed to start curve', 'error');
    } finally {
      isCurveRunning = false;
      setCurveLocked(false);
      el.runCurveBtn.disabled = false;
      el.runCurveBtnLabel.textContent = 'EXECUTE HEAT CURVE';
      el.stopCurveBtn.disabled = true;
      el.curveStatusBadge.className = 'state-tag state-idle';
      el.curveStatusBadge.textContent = 'READY';
    }
  });

  // Stop Curve
  el.stopCurveBtn.addEventListener('click', async () => {
    el.stopCurveBtn.disabled = true;
    el.runCurveBtnLabel.textContent = 'STOPPING...';
    try {
      await curveGovernor.stop();
      if (activeClient && activeClient.isConnected) {
        await activeClient.stopSession();
      }
      showToast('Heat curve stopped and heating aborted', 'info');
    } catch (e) {
      console.warn('Error stopping curve:', e);
    } finally {
      isCurveRunning = false;
      setCurveLocked(false);
      el.runCurveBtnLabel.textContent = 'EXECUTE HEAT CURVE';
      el.runCurveBtn.disabled = false;
      el.stopCurveBtn.disabled = true;
      el.curveStatusBadge.className = 'state-tag state-idle';
      el.curveStatusBadge.textContent = 'READY';
    }
  });
}

function handleCurveTelemetry(data) {
  if (data.status === 'emergency_cutoff') {
    isCurveRunning = false;
    setCurveLocked(false);
    el.runCurveBtnLabel.textContent = 'EXECUTE HEAT CURVE';
    el.runCurveBtn.disabled = false;
    el.stopCurveBtn.disabled = true;
    el.curveStatusBadge.className = 'state-tag state-offline';
    el.curveStatusBadge.textContent = 'OVERHEAT CUTOFF';
    showToast(`🚨 EMERGENCY SAFETY CUTOFF: Chamber reached ${Number(data.live_temp_f || 600).toFixed(1)}°F! Heating auto-aborted to prevent damage.`, 'error');
    el.curvePlayheadLine.classList.add('hidden');
    if (el.curvePlayheadDotGroup) el.curvePlayheadDotGroup.classList.add('hidden');
    el.curvePlayheadDot.classList.add('hidden');
    return;
  }

  if (data.status === 'stopped' || data.status === 'completed' || data.status === 'ended_early' || !data.is_active) {
    isCurveRunning = false;
    setCurveLocked(false);
    el.runCurveBtnLabel.textContent = 'EXECUTE HEAT CURVE';
    el.runCurveBtn.disabled = false;
    el.stopCurveBtn.disabled = true;
    el.curveStatusBadge.className = 'state-tag state-idle';
    el.curveStatusBadge.textContent = data.status === 'completed' ? 'COMPLETED' : 'READY';
    if (data.status === 'completed') {
      showToast('Heat curve completed successfully!', 'success');
    }
    setTimeout(() => {
      if (!isCurveRunning) {
        el.curvePlayheadLine.classList.add('hidden');
        if (el.curvePlayheadDotGroup) el.curvePlayheadDotGroup.classList.add('hidden');
        el.curvePlayheadDot.classList.add('hidden');
      }
    }, 4000);
    return;
  }

  isCurveRunning = true;
  setCurveLocked(true);
  el.stopCurveBtn.disabled = false;

  const elapsed = Number(data.elapsed_s || 0);
  const total = Number(data.duration_s || currentCurve.duration_s);
  const target = Number(data.target_temp_f || 0);
  const live = Number(data.live_temp_f || 0);

  if (data.phase === 'preheating') {
    el.runCurveBtnLabel.textContent = 'PREHEATING BOWL...';
    el.curveStatusBadge.className = 'state-tag state-heating';
    el.curveStatusBadge.textContent = `PREHEATING TO ${Math.round(target)}°F`;

    el.curveElapsedDisplay.textContent = `PREHEATING (${live.toFixed(1)}°F → ${Math.round(target)}°F)`;
    el.curveSetpointDisplay.textContent = `${target.toFixed(1)}°F`;
    el.curveActualDisplay.textContent = `${live.toFixed(1)}°F`;

    const playheadX = timeToX(0);
    const playheadY = tempToY(target);
    el.curvePlayheadLine.setAttribute('x1', playheadX);
    el.curvePlayheadLine.setAttribute('x2', playheadX);
    el.curvePlayheadLine.classList.remove('hidden');

    if (el.curvePlayheadDotGroup) {
      const rect = el.curveSvg.getBoundingClientRect();
      const kx = rect.width > 0 ? GRAPH_WIDTH / rect.width : 1;
      const ky = rect.height > 0 ? GRAPH_HEIGHT / rect.height : 1;
      el.curvePlayheadDotGroup.dataset.x = playheadX;
      el.curvePlayheadDotGroup.dataset.y = playheadY;
      el.curvePlayheadDotGroup.setAttribute('transform', `translate(${playheadX}, ${playheadY}) scale(${kx}, ${ky})`);
      el.curvePlayheadDotGroup.classList.remove('hidden');
    }
    el.curvePlayheadDot.setAttribute('cx', 0);
    el.curvePlayheadDot.setAttribute('cy', 0);
    el.curvePlayheadDot.classList.remove('hidden');
  } else {
    el.runCurveBtnLabel.textContent = 'RUNNING CURVE...';
    el.curveStatusBadge.className = 'state-tag state-ready';
    el.curveStatusBadge.textContent = 'ACTIVE GOVERNOR';

    el.curveElapsedDisplay.textContent = `${elapsed.toFixed(1)}s / ${total}s`;
    el.curveSetpointDisplay.textContent = `${target.toFixed(1)}°F`;
    el.curveActualDisplay.textContent = `${live.toFixed(1)}°F`;

    const playheadX = timeToX(elapsed);
    const playheadY = tempToY(target);
    el.curvePlayheadLine.setAttribute('x1', playheadX);
    el.curvePlayheadLine.setAttribute('x2', playheadX);
    el.curvePlayheadLine.classList.remove('hidden');

    if (el.curvePlayheadDotGroup) {
      const rect = el.curveSvg.getBoundingClientRect();
      const kx = rect.width > 0 ? GRAPH_WIDTH / rect.width : 1;
      const ky = rect.height > 0 ? GRAPH_HEIGHT / rect.height : 1;
      el.curvePlayheadDotGroup.dataset.x = playheadX;
      el.curvePlayheadDotGroup.dataset.y = playheadY;
      el.curvePlayheadDotGroup.setAttribute('transform', `translate(${playheadX}, ${playheadY}) scale(${kx}, ${ky})`);
      el.curvePlayheadDotGroup.classList.remove('hidden');
    }
    el.curvePlayheadDot.setAttribute('cx', 0);
    el.curvePlayheadDot.setAttribute('cy', 0);
    el.curvePlayheadDot.classList.remove('hidden');

    const liveY = tempToY(live);
    actualTrailPoints.push({ x: playheadX, y: liveY });

    if (actualTrailPoints.length > 1) {
      let trailD = `M ${actualTrailPoints[0].x} ${actualTrailPoints[0].y}`;
      for (let i = 1; i < actualTrailPoints.length; i++) {
        trailD += ` L ${actualTrailPoints[i].x} ${actualTrailPoints[i].y}`;
      }
      el.curveActualTrail.setAttribute('d', trailD);
    }
  }
}

// ==========================================================================
// Tab Switching
// ==========================================================================

function setupTabs() {
  el.tabControllerBtn.addEventListener('click', () => {
    el.tabControllerBtn.classList.add('active');
    el.tabCurvesBtn.classList.remove('active');
    el.tabController.classList.remove('hidden');
    el.tabCurves.classList.add('hidden');
  });

  el.tabCurvesBtn.addEventListener('click', () => {
    el.tabCurvesBtn.classList.add('active');
    el.tabControllerBtn.classList.remove('active');
    el.tabCurves.classList.remove('hidden');
    el.tabController.classList.add('hidden');
    renderCurveGraph();
  });
}

// ==========================================================================
// Device Connection & Action Handlers
// ==========================================================================

async function handleConnectToggle(options = {}) {
  if (isDemoMode) {
    if (activeClient && activeClient.isConnected) {
      showToast('Disconnecting demo...', 'info', 1500);
      await activeClient.disconnect();
      showToast('Demo Puffco disconnected', 'info', 2500);
    } else {
      showToast('Connecting demo Puffco...', 'info', 1500);
      await activeClient.connect();
      showToast('Demo Puffco reconnected ⚡', 'success', 2500);
    }
    handleTelemetryUpdate(activeClient.telemetry);
    return;
  }

  if (activeClient && activeClient.isConnected) {
    showToast('Disconnecting...', 'info');
    await activeClient.disconnect();
    showToast('Disconnected', 'info');
    handleTelemetryUpdate(activeClient.telemetry);
  } else {
    try {
      showToast('Scanning for nearby Bluetooth devices...', 'info', 3000);
      el.mainConnectBtn.disabled = true;
      el.mainConnectBtn.textContent = 'Connecting...';

      await activeClient.connect({ showAll: true, ...options });
    } catch (err) {
      console.warn('[App] Connect error:', err);
      const isUserCancel =
        err.message?.includes('cancelled') ||
        err.message?.includes('No device selected') ||
        err.name === 'NotFoundError';

      if (isUserCancel) {
        showToast('Pairing cancelled.', 'info', 2500);
      } else {
        showToast(err.message || 'Connection failed or device not recognized.', 'error', 5000);
      }
    } finally {
      el.mainConnectBtn.disabled = false;
      handleTelemetryUpdate(activeClient.telemetry);
    }
  }
}

async function handleDemoToggle(enabled) {
  isDemoMode = enabled;

  if (activeClient && activeClient.isConnected) {
    await activeClient.disconnect();
  }

  if (enabled) {
    activeClient = simClient;
    curveGovernor.client = simClient;
    await simClient.connect();
    showToast('Demo simulation mode activated ⚡', 'info');
  } else {
    activeClient = bleClient;
    curveGovernor.client = bleClient;
    showToast('Switched to Bluetooth hardware mode', 'info');
  }
}

// ==========================================================================
// Toast Alerts
// ==========================================================================

function showToast(message, type = 'info', duration = 3200) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span style="font-weight:700;">${icon}</span><span>${message}</span>`;

  el.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ==========================================================================
// puffsn0w Lockscreen & iPod Touch "Slide to Unlock" Controller
// ==========================================================================

function updateLockscreenClock() {
  const now = new Date();
  if (el.lockscreenClock) {
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    // Classic 12-hour format without leading zero (e.g. 9:41)
    hours = hours % 12;
    hours = hours ? hours : 12;
    el.lockscreenClock.textContent = `${hours}:${minutes}`;
  }
  if (el.lockscreenDate) {
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    el.lockscreenDate.textContent = now.toLocaleDateString(undefined, options);
  }
}

function unlockToDashboard(options = {}) {
  const silent = typeof options === 'object' && !!options?.silent;

  if (!silent && 'vibrate' in navigator) {
    try { navigator.vibrate(45); } catch (e) {}
  }

  // Restore document scrolling capability and layout display
  document.documentElement.classList.remove('lockscreen-active');
  document.body.classList.remove('lockscreen-active');

  if (el.appLayout) {
    el.appLayout.removeAttribute('inert');
    el.appLayout.removeAttribute('aria-hidden');
  }

  // Ensure window scroll starts cleanly at top
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  // Recalculate curve graph for true layout dimensions
  if (typeof renderCurveGraph === 'function') {
    requestAnimationFrame(() => {
      renderCurveGraph();
    });
  }

  // Animate lockscreen sliding up
  if (el.lockscreen) {
    el.lockscreen.classList.add('unlocked');
    if (silent) {
      el.lockscreen.style.display = 'none';
    } else {
      setTimeout(() => {
        if (el.lockscreen && el.lockscreen.classList.contains('unlocked')) {
          el.lockscreen.style.display = 'none';
        }
      }, 700);
    }
  }

  if (!silent) {
    showToast('puffsn0w unlocked 🔓', 'success', 3500);
  }
}

function lockToLockscreen() {
  if (el.lockscreen) {
    el.lockscreen.style.display = 'flex';
    // Force reflow before removing .unlocked
    void el.lockscreen.offsetHeight;
    el.lockscreen.classList.remove('unlocked');

    const isConn = (activeClient && activeClient.isConnected) || false;
    if (isConn) {
      el.lockscreen.classList.remove('lockscreen-locked');
    } else {
      el.lockscreen.classList.add('lockscreen-locked');
    }
  }

  document.documentElement.classList.add('lockscreen-active');
  document.body.classList.add('lockscreen-active');

  if (el.appLayout) {
    el.appLayout.setAttribute('inert', '');
    el.appLayout.setAttribute('aria-hidden', 'true');
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  if (el.lockscreenSliderThumb) {
    el.lockscreenSliderThumb.style.transform = 'translateX(0px)';
  }
  if (el.slideShimmerLabel) {
    el.slideShimmerLabel.style.opacity = '1';
  }
}

function setupAnalyticsConsent() {
  const consent = localStorage.getItem('puffsn0w_analytics_consent');
  if (consent) {
    if (el.analyticsModal) el.analyticsModal.classList.add('hidden');
    if (consent === 'granted' && typeof gtag === 'function') {
      gtag('consent', 'update', {
        'analytics_storage': 'granted'
      });
    }
  }

  if (el.analyticsAcceptBtn) {
    el.analyticsAcceptBtn.addEventListener('click', () => {
      localStorage.setItem('puffsn0w_analytics_consent', 'granted');
      if (typeof gtag === 'function') {
        gtag('consent', 'update', {
          'analytics_storage': 'granted'
        });
      }
      if (el.analyticsModal) el.analyticsModal.classList.add('hidden');
      showToast('Anonymous compatibility analytics enabled. Thank you!', 'info', 3000);
    });
  }

  if (el.analyticsDismissBtn) {
    el.analyticsDismissBtn.addEventListener('click', () => {
      localStorage.setItem('puffsn0w_analytics_consent', 'denied');
      if (typeof gtag === 'function') {
        gtag('consent', 'update', {
          'analytics_storage': 'denied'
        });
      }
      if (el.analyticsModal) el.analyticsModal.classList.add('hidden');
    });
  }
}

function setupSlideToUnlock() {
  const track = el.lockscreenSliderTrack;
  const thumb = el.lockscreenSliderThumb;
  const shimmer = el.slideShimmerLabel;
  if (!track || !thumb) return;

  let isDragging = false;
  let startX = 0;
  let currentTranslateX = 0;
  let maxDistance = 0;

  function calculateMaxDistance() {
    const trackWidth = track.clientWidth;
    const thumbWidth = thumb.offsetWidth || 68;
    return Math.max(0, trackWidth - thumbWidth - 10);
  }

  function onDragStart(clientX) {
    if (track.classList.contains('slider-locked')) {
      showToast('Please connect your device first to unlock.', 'info', 2800);
      return;
    }
    isDragging = true;
    startX = clientX;
    maxDistance = calculateMaxDistance();
    thumb.classList.add('dragging');
    thumb.classList.remove('snapping');
  }

  function onDragMove(clientX) {
    if (!isDragging) return;
    const deltaX = clientX - startX;
    currentTranslateX = Math.max(0, Math.min(deltaX, maxDistance));
    thumb.style.transform = `translateX(${currentTranslateX}px)`;

    if (shimmer && maxDistance > 0) {
      const progress = currentTranslateX / maxDistance;
      shimmer.style.opacity = String(Math.max(0, 1 - progress * 1.35));
    }
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    thumb.classList.remove('dragging');

    // Threshold: 78% or more triggers unlock
    if (maxDistance > 0 && currentTranslateX >= maxDistance * 0.78) {
      thumb.style.transform = `translateX(${maxDistance}px)`;
      if (shimmer) shimmer.style.opacity = '0';
      unlockToDashboard();
    } else {
      thumb.classList.add('snapping');
      thumb.style.transform = 'translateX(0px)';
      currentTranslateX = 0;
      if (shimmer) shimmer.style.opacity = '1';
      setTimeout(() => {
        thumb.classList.remove('snapping');
      }, 350);
    }
  }

  // Touch Drag Listeners
  thumb.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      onDragStart(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDragging) {
      if (e.cancelable) e.preventDefault();
      if (e.touches && e.touches[0]) {
        onDragMove(e.touches[0].clientX);
      }
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (isDragging) onDragEnd();
  }, { passive: true });

  window.addEventListener('touchcancel', () => {
    if (isDragging) onDragEnd();
  }, { passive: true });

  // Mouse Drag Listeners
  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onDragStart(e.clientX);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      e.preventDefault();
      onDragMove(e.clientX);
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) onDragEnd();
  });
}

function setupLockscreen() {
  updateLockscreenClock();
  setInterval(updateLockscreenClock, 1000);

  // Lockscreen Connect Button
  if (el.lockscreenConnectBtn) {
    el.lockscreenConnectBtn.addEventListener('click', async () => {
      if (activeClient && activeClient.isConnected) {
        unlockToDashboard();
      } else {
        await handleConnectToggle({ showAll: true });
      }
    });
  }

  // Header Lock button
  if (el.lockScreenBtn) {
    el.lockScreenBtn.addEventListener('click', () => {
      lockToLockscreen();
    });
  }

  setupAnalyticsConsent();
  setupSlideToUnlock();

  // Prevent any wheel or touch scrolling while on the lockscreen
  if (el.lockscreen) {
    el.lockscreen.addEventListener('wheel', (e) => {
      if (!el.lockscreen.classList.contains('unlocked')) {
        e.preventDefault();
      }
    }, { passive: false });

    el.lockscreen.addEventListener('touchmove', (e) => {
      if (!el.lockscreen.classList.contains('unlocked') && !e.target.closest('.slide-thumb')) {
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });
  }
}

// ==========================================================================
// Event Listeners Binding
// ==========================================================================

function attachEventListeners() {
  setupTabs();
  setupSvgInteraction();
  setupCurveActions();
  setupLockscreen();

  // Connect Button
  el.mainConnectBtn.addEventListener('click', () => handleConnectToggle({ showAll: true }));

  // Information / Connection Tutorial Modal
  if (el.infoTutorialBtn) {
    el.infoTutorialBtn.addEventListener('click', () => {
      if (el.connectTutorialModal) el.connectTutorialModal.classList.remove('hidden');
    });
  }

  if (el.closeTutorialModal) {
    el.closeTutorialModal.addEventListener('click', () => {
      if (el.connectTutorialModal) el.connectTutorialModal.classList.add('hidden');
    });
  }

  if (el.tutorialDismissBtn) {
    el.tutorialDismissBtn.addEventListener('click', () => {
      if (el.connectTutorialModal) el.connectTutorialModal.classList.add('hidden');
    });
  }

  if (el.tutorialConnectBtn) {
    el.tutorialConnectBtn.addEventListener('click', async () => {
      if (el.connectTutorialModal) el.connectTutorialModal.classList.add('hidden');
      await handleConnectToggle({ showAll: true });
    });
  }

  if (el.connectTutorialModal) {
    el.connectTutorialModal.addEventListener('click', (e) => {
      if (e.target === el.connectTutorialModal) el.connectTutorialModal.classList.add('hidden');
    });
  }

  // Global Escape key to dismiss active modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el.connectTutorialModal && !el.connectTutorialModal.classList.contains('hidden')) {
        el.connectTutorialModal.classList.add('hidden');
      }
      if (el.compatModal && !el.compatModal.classList.contains('hidden')) {
        el.compatModal.classList.add('hidden');
      }
    }
  });

  // Compatibility Guide Banner & Modal
  el.compatGuideBtn.addEventListener('click', () => {
    el.compatModal.classList.remove('hidden');
  });

  el.compatDismissBtn.addEventListener('click', () => {
    el.compatBanner.classList.add('hidden');
    sessionStorage.setItem('compat_dismissed', '1');
  });

  el.closeCompatModal.addEventListener('click', () => {
    el.compatModal.classList.add('hidden');
  });

  el.closeCompatModalBtn.addEventListener('click', () => {
    el.compatModal.classList.add('hidden');
  });

  el.compatModal.addEventListener('click', (e) => {
    if (e.target === el.compatModal) el.compatModal.classList.add('hidden');
  });

  // Standard Sesh Buttons
  el.startSeshBtn.addEventListener('click', async () => {
    if (!activeClient.isConnected) return;
    el.startSeshBtn.disabled = true;
    showToast('Heating session initiated! 🔥', 'success');
    await activeClient.startSession();
  });

  el.boostSeshBtn.addEventListener('click', async () => {
    if (!activeClient.isConnected) return;
    showToast('Heat boost triggered (+15s / +10°F) ⚡', 'success');
    await activeClient.boostSession();
  });

  el.stopSeshBtn.addEventListener('click', async () => {
    if (!activeClient.isConnected) return;
    if (isCurveRunning) {
      await curveGovernor.stop();
    }
    showToast('Session cancelled / cooling down', 'info');
    await activeClient.stopSession();
  });

  // Temperature Controls
  el.tempSlider.addEventListener('input', (e) => {
    el.sliderTempVal.textContent = `${e.target.value}°F`;
  });

  el.tempDecBtn.addEventListener('click', () => {
    let val = Math.max(400, Number(el.tempSlider.value) - 5);
    el.tempSlider.value = val;
    el.sliderTempVal.textContent = `${val}°F`;
  });

  el.tempIncBtn.addEventListener('click', () => {
    let val = Math.min(600, Number(el.tempSlider.value) + 5);
    el.tempSlider.value = val;
    el.sliderTempVal.textContent = `${val}°F`;
  });

  el.applyTempBtn.addEventListener('click', async () => {
    const val = Number(el.tempSlider.value);
    await activeClient.writeTemperature(val);
    showToast(`Target temperature set to ${val}°F`, 'success');
  });

  el.presetPills.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const temp = Number(btn.dataset.temp);
      el.tempSlider.value = temp;
      el.sliderTempVal.textContent = `${temp}°F`;
      await activeClient.writeTemperature(temp);
      showToast(`Target setpoint adjusted to ${temp}°F`, 'info');
    });
  });

  // Stealth & Lantern toggles
  el.stealthToggle.addEventListener('change', async (e) => {
    await activeClient.setStealthMode(e.target.checked);
    showToast(`Stealth mode ${e.target.checked ? 'enabled (LEDs blackout)' : 'disabled'}`, 'info');
  });

  el.lanternToggle.addEventListener('change', async (e) => {
    const isChecked = e.target.checked;
    if (el.lanternControlsPanel) {
      if (isChecked) {
        el.lanternControlsPanel.classList.remove('hidden');
      } else {
        el.lanternControlsPanel.classList.add('hidden');
      }
    }
    await activeClient.setLanternMode(isChecked);
    showToast(`Lantern mode ${isChecked ? 'started ✨' : 'stopped'}`, 'info');
  });

  // Lantern Lighting Effect Buttons
  const fxBtns = document.querySelectorAll('.lantern-fx-btn');
  fxBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const effect = btn.dataset.effect;
      if (!effect) return;

      fxBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      if (activeClient && typeof activeClient.startLanternEffect === 'function') {
        await activeClient.startLanternEffect(effect);
      }

      const effectTitles = {
        campfire: 'Campfire 🔥',
        flicker: 'Candle Flicker 🕯️',
        night_light: 'Night Light 🌙',
        rainbow: 'Rainbow Spectrum 🌈',
        waterfall: 'Waterfall Cascade 🌊',
        breathing: 'Meditative Breath 🧘',
        disco: 'Party Disco ⚡',
        aurora: 'Aurora Borealis 🔮',
      };

      if (el.lanternAuraPreview) {
        el.lanternAuraPreview.className = `lantern-aura-preview effect-${effect}`;
        if (el.lanternActiveEffectName) {
          el.lanternActiveEffectName.textContent = effectTitles[effect] || effect;
        }
      }

      showToast(`Lighting effect: ${effectTitles[effect] || effect}`, 'info', 2200);
    });
  });

  // Lantern Color Swatches
  const swatches = document.querySelectorAll('.swatch-btn');
  swatches.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const colorStr = btn.dataset.color;
      if (!colorStr) return;
      const parts = colorStr.split(',').map((n) => parseInt(n.trim(), 10));
      if (parts.length < 3) return;

      swatches.forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');

      if (activeClient && typeof activeClient.setLanternColor === 'function') {
        await activeClient.setLanternColor(parts[0], parts[1], parts[2]);
      }
      showToast('Color tint updated', 'info', 1800);
    });
  });

  // Lantern Brightness Slider
  if (el.lanternBrightnessSlider) {
    el.lanternBrightnessSlider.addEventListener('input', (e) => {
      if (el.lanternBrightnessVal) {
        el.lanternBrightnessVal.textContent = `${e.target.value}%`;
      }
    });
    el.lanternBrightnessSlider.addEventListener('change', async (e) => {
      const val = parseInt(e.target.value, 10);
      if (activeClient && typeof activeClient.setLanternBrightness === 'function') {
        await activeClient.setLanternBrightness(val);
      }
    });
  }

  // Power controls
  el.sleepBtn.addEventListener('click', async () => {
    if (!confirm('Put Puff device into low-power sleep mode?')) return;
    await activeClient.enterSleepMode();
    showToast('Device entered sleep mode 💤', 'info');
  });

  el.powerOffBtn.addEventListener('click', async () => {
    if (!confirm('Completely power off your Puff device?')) return;
    await activeClient.powerOff();
    showToast('Device powered down', 'info');
  });
}

// ==========================================================================
// Bootstrap
// ==========================================================================

function bootstrap() {
  curveStorage = new CurveStorage();
  bleClient = new PuffcoBleClient();
  simClient = new PuffcoSimulator();
  activeClient = bleClient;
  curveGovernor = new CurveGovernor(activeClient);

  // Wire telemetry listeners
  bleClient.addTelemetryListener(handleTelemetryUpdate);
  simClient.addTelemetryListener(handleTelemetryUpdate);
  curveGovernor.addCurveListener(handleCurveTelemetry);

  // Wire disconnect notification listener
  bleClient.addDisconnectListener(({ wasConnected, isIntentional }) => {
    console.warn('[App] BLE Disconnect notification received. Was connected:', wasConnected, 'Intentional:', isIntentional);
    if (wasConnected && !isIntentional) {
      showToast('Device connection lost. Reconnect to resume control.', 'error', 6500);
    }
    handleTelemetryUpdate(bleClient.telemetry);
  });
  simClient.addDisconnectListener(({ wasConnected, isIntentional }) => {
    if (wasConnected && !isIntentional) {
      showToast('Demo device disconnected.', 'info', 3000);
    }
    handleTelemetryUpdate(simClient.telemetry);
  });

  attachEventListeners();
  checkBrowserCompatibility();
  loadCurvesList();
  renderCurveGraph();

  // Detect /demo route, demo parameter, or demo dataset flag
  const isDemoRequested =
    window.__DEMO_MODE__ === true ||
    document.documentElement.dataset.demo === 'true' ||
    document.body?.dataset.demo === 'true' ||
    window.location.pathname.replace(/\/+$/, '').endsWith('/demo') ||
    window.location.pathname.includes('/demo/') ||
    new URLSearchParams(window.location.search).has('demo') ||
    window.location.hash.toLowerCase().includes('demo');

  if (isDemoRequested) {
    isDemoMode = true;
    activeClient = simClient;
    curveGovernor.client = simClient;
    document.documentElement.dataset.demo = 'true';
    if (document.body) document.body.dataset.demo = 'true';

    // Pre-configure lockscreen in connected state so it is instantly slideable
    if (el.lockscreen) {
      el.lockscreen.classList.remove('lockscreen-locked');
      if (el.lockscreenBtBadge) el.lockscreenBtBadge.classList.add('connected');
      if (el.lockscreenBatteryVal) el.lockscreenBatteryVal.textContent = '84%';
      if (el.lockscreenBatteryFill) el.lockscreenBatteryFill.setAttribute('width', '10');
      if (el.lockscreenSliderTrack) el.lockscreenSliderTrack.classList.remove('slider-locked');
      if (el.lockscreenConnectCard) el.lockscreenConnectCard.classList.add('connected-hidden');
    }

    // Connect demo hardware simulation on dashboard behind lockscreen
    simClient.connect().then(() => {
      handleTelemetryUpdate(simClient.telemetry);
    }).catch((err) => {
      console.warn('[Demo] Simulator connect error:', err);
    });
  } else {
    // Initial UI state for normal hardware mode
    handleTelemetryUpdate(activeClient.telemetry);

    // Auto-connect to previously paired Bluetooth device if permitted by browser
    if (bleClient && bleClient.isWebBluetoothSupported() && typeof navigator.bluetooth?.getDevices === 'function') {
      bleClient.autoConnect().then((connected) => {
        if (connected) {
          showToast(`Auto-connected to ${bleClient.telemetry.device_name || 'Puff'}! 🌿`, 'success', 3500);
        }
      }).catch((err) => {
        console.log('[puffsn0w] Auto-connect check bypassed:', err);
      });
    }
  }

  // Register Service Worker for offline PWA
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => {
      console.log('ServiceWorker registration skipped:', e);
    });
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
