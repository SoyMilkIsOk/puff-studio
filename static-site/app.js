/**
 * Puff Studio — Standalone Mobile & Web Bluetooth Frontend Controller
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
let actualTrailPoints = [];

// Live Session Heat Curve State (dial graph)
let liveSessionPoints = [];
let sessionStartTime = null;
let lastPointRecordTime = 0;
let sessionPeakTemp = 0;
let sessionTempSum = 0;
let sessionTempCount = 0;
let wasHeating = false;

// DOM Cache
const el = {
  // Tabs
  tabControllerBtn: document.getElementById('tab-controller-btn'),
  tabCurvesBtn: document.getElementById('tab-curves-btn'),
  tabController: document.getElementById('tab-controller'),
  tabCurves: document.getElementById('tab-curves'),

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

  // Curve Studio
  curvePillsContainer: document.getElementById('curve-pills-container'),
  newCurveBtn: document.getElementById('new-curve-btn'),
  saveCurveBtn: document.getElementById('save-curve-btn'),
  shareCurveBtn: document.getElementById('share-curve-btn'),
  activeCurveTitle: document.getElementById('active-curve-title'),
  activeCurveDesc: document.getElementById('active-curve-desc'),
  curveDurationBadge: document.getElementById('curve-duration-badge'),
  curveStatusBadge: document.getElementById('curve-status-badge'),
  curveSvg: document.getElementById('curve-svg'),
  curveAreaPath: document.getElementById('curve-area-path'),
  curveStrokePath: document.getElementById('curve-stroke-path'),
  curveActualTrail: document.getElementById('curve-actual-trail'),
  curvePlayheadLine: document.getElementById('curve-playhead-line'),
  curvePlayheadDot: document.getElementById('curve-playhead-dot'),
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
    el.devicePill.className = 'status-pill status-connected';
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
  el.chamberPill.textContent = data.chamber_name || '3DXL';
  el.statChamberName.textContent = (data.chamber_name || '3DXL') + ' Chamber';

  // Battery Widget
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
  if (el.batteryWidget) {
    el.batteryWidget.classList.remove('charging', 'battery-full', 'battery-med', 'battery-low', 'battery-critical');
    if (connected) {
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

  // Operating State Badge
  updateStateBadge(data.operating_state, data.state_name);

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

  // Sesh Control Buttons State
  el.startSeshBtn.disabled = !connected || isHeating || isCurveRunning;
  el.boostSeshBtn.disabled = !connected || !isHeating;
  el.stopSeshBtn.disabled = !connected || !isHeating;

  // Profiles Matrix
  renderProfiles(data.profiles || [], data.active_profile, connected);

  // Hardware Diagnostics
  el.statTotalDabs.textContent = connected ? Number(data.lifetime_dabs || 0).toLocaleString() : '--';
  el.statMacAddress.textContent = connected && data.mac_address ? data.mac_address : '--';
  el.statFirmwareVersion.textContent = connected && data.firmware_version ? data.firmware_version : (connected ? 'V1.3.8' : '--');

  // Stealth & Lantern toggles sync
  el.stealthToggle.checked = !!data.stealth_mode;
  el.lanternToggle.checked = !!data.lantern_active;

  // Sync slider if not actively dragging
  if (!document.activeElement || document.activeElement !== el.tempSlider) {
    el.tempSlider.value = Math.round(targetTemp);
    el.sliderTempVal.textContent = `${Math.round(targetTemp)}°F`;
  }
}

function updateStateBadge(state, stateName) {
  const badge = el.stateBadge;
  badge.className = 'state-tag';

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

  el.lsgLiveDot.setAttribute('cx', lastPt.x);
  el.lsgLiveDot.setAttribute('cy', lastPt.y);

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
    card.className = `profile-card ${isActive ? 'active' : ''}`;
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
      if (!currentTelemetry?.connected) {
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

  // Render draggable control nodes
  el.curvePointsLayer.innerHTML = '';
  kfs.forEach((k, idx) => {
    const x = timeToX(k.time_s);
    const y = tempToY(k.temp_f);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', '#11141e');
    circle.setAttribute('stroke', '#ff7a00');
    circle.setAttribute('stroke-width', '3');
    circle.setAttribute('class', 'curve-node');
    circle.dataset.index = idx;

    // Mouse drag
    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isDraggingNode = true;
      draggingNodeIndex = idx;
      circle.classList.add('dragging');
    });

    // Touch drag on mobile
    circle.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      isDraggingNode = true;
      draggingNodeIndex = idx;
      circle.classList.add('dragging');
    }, { passive: false });

    // Double-click / double-tap to delete
    circle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      deleteKeyframe(idx);
    });

    el.curvePointsLayer.appendChild(circle);
  });

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
    inputTime.value = k.time_s;
    inputTime.min = 0;
    inputTime.max = TIME_MAX;
    inputTime.addEventListener('change', (e) => {
      k.time_s = Math.max(0, Math.min(TIME_MAX, Number(e.target.value)));
      sortAndRefreshCurve();
    });
    tdTime.appendChild(inputTime);

    const tdTemp = document.createElement('td');
    const inputTemp = document.createElement('input');
    inputTemp.type = 'number';
    inputTemp.className = 'kf-input';
    inputTemp.value = k.temp_f;
    inputTemp.min = TEMP_MIN;
    inputTemp.max = TEMP_MAX;
    inputTemp.addEventListener('change', (e) => {
      k.temp_f = Math.max(TEMP_MIN, Math.min(TEMP_MAX, Number(e.target.value)));
      renderCurveGraph();
    });
    tdTemp.appendChild(inputTemp);

    const tdAction = document.createElement('td');
    const btnDel = document.createElement('button');
    btnDel.className = 'btn-delete-node';
    btnDel.textContent = '✕';
    btnDel.title = 'Remove keyframe';
    btnDel.addEventListener('click', () => deleteKeyframe(idx));
    tdAction.appendChild(btnDel);

    tr.appendChild(tdIdx);
    tr.appendChild(tdTime);
    tr.appendChild(tdTemp);
    tr.appendChild(tdAction);

    el.keyframeTableBody.appendChild(tr);
  });
}

function sortAndRefreshCurve() {
  currentCurve.keyframes.sort((a, b) => a.time_s - b.time_s);
  const lastKf = currentCurve.keyframes[currentCurve.keyframes.length - 1];
  currentCurve.duration_s = lastKf ? lastKf.time_s : 50;
  renderCurveGraph();
}

function deleteKeyframe(idx) {
  if (currentCurve.keyframes.length <= 2) {
    showToast('Curves require at least 2 keyframes (start and finish)', 'error');
    return;
  }
  currentCurve.keyframes.splice(idx, 1);
  sortAndRefreshCurve();
  showToast('Keyframe removed', 'info');
}

function addKeyframe(time_s, temp_f) {
  currentCurve.keyframes.push({
    time_s: Math.max(0, Math.min(TIME_MAX, time_s)),
    temp_f: Math.max(TEMP_MIN, Math.min(TEMP_MAX, temp_f)),
  });
  sortAndRefreshCurve();
  showToast(`Added keyframe at ${time_s}s, ${temp_f}°F`, 'info');
}

// ==========================================================================
// Touch & Mouse Dragging for Curve Canvas
// ==========================================================================

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
    if (isDraggingNode) return;
    const coords = getSvgCoords(e.clientX, e.clientY);
    const time = xToTime(coords.x);
    const temp = yToTemp(coords.y);
    addKeyframe(time, temp);
  });

  // Mouse drag
  window.addEventListener('mousemove', (e) => {
    if (!isDraggingNode || draggingNodeIndex < 0) return;
    const coords = getSvgCoords(e.clientX, e.clientY);
    applyNodeDrag(coords.x, coords.y);
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingNode) {
      isDraggingNode = false;
      draggingNodeIndex = -1;
      sortAndRefreshCurve();
    }
  });

  // Touch drag for mobile screens
  window.addEventListener('touchmove', (e) => {
    if (!isDraggingNode || draggingNodeIndex < 0) return;
    const touch = e.touches[0];
    if (touch) {
      const coords = getSvgCoords(touch.clientX, touch.clientY);
      applyNodeDrag(coords.x, coords.y);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (isDraggingNode) {
      isDraggingNode = false;
      draggingNodeIndex = -1;
      sortAndRefreshCurve();
    }
  });

  function applyNodeDrag(x, y) {
    const time = xToTime(x);
    const temp = yToTemp(y);

    const kf = currentCurve.keyframes[draggingNodeIndex];
    if (kf) {
      kf.time_s = time;
      kf.temp_f = temp;
      renderCurveGraph();
    }
  }

  el.addKeyframeBtn.addEventListener('click', () => {
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
      el.runCurveBtn.disabled = false;
      el.runCurveBtnLabel.textContent = 'RUNNING CURVE...';
      el.stopCurveBtn.disabled = false;
      el.curveStatusBadge.className = 'state-tag state-heating';
      el.curveStatusBadge.textContent = 'HEATING CURVE';
      el.curvePlayheadLine.classList.remove('hidden');
      el.curvePlayheadDot.classList.remove('hidden');

      showToast(`Executing curve "${currentCurve.name}"! 🔥`, 'success');
      await curveGovernor.run(currentCurve);
    } catch (err) {
      showToast(err.message || 'Failed to start curve', 'error');
    } finally {
      isCurveRunning = false;
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
    el.runCurveBtnLabel.textContent = 'EXECUTE HEAT CURVE';
    el.runCurveBtn.disabled = false;
    el.stopCurveBtn.disabled = true;
    el.curveStatusBadge.className = 'state-tag state-offline';
    el.curveStatusBadge.textContent = 'OVERHEAT CUTOFF';
    showToast(`🚨 EMERGENCY SAFETY CUTOFF: Chamber reached ${Number(data.live_temp_f || 600).toFixed(1)}°F! Heating auto-aborted to prevent damage.`, 'error');
    el.curvePlayheadLine.classList.add('hidden');
    el.curvePlayheadDot.classList.add('hidden');
    return;
  }

  if (data.status === 'stopped' || data.status === 'completed' || data.status === 'ended_early' || !data.is_active) {
    isCurveRunning = false;
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
        el.curvePlayheadDot.classList.add('hidden');
      }
    }, 4000);
    return;
  }

  isCurveRunning = true;
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
    el.curvePlayheadDot.setAttribute('cx', playheadX);
    el.curvePlayheadDot.setAttribute('cy', playheadY);
    el.curvePlayheadLine.classList.remove('hidden');
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
    el.curvePlayheadDot.setAttribute('cx', playheadX);
    el.curvePlayheadDot.setAttribute('cy', playheadY);
    el.curvePlayheadLine.classList.remove('hidden');
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
    showToast('Demo mode active. Turn off Demo mode switch to connect hardware.', 'info');
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
      showToast(`Connected to ${activeClient.telemetry.device_name || 'Puff'}! 🌿`, 'success', 3500);
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
// Event Listeners Binding
// ==========================================================================

function attachEventListeners() {
  setupTabs();
  setupSvgInteraction();
  setupCurveActions();

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
    await activeClient.setLanternMode(e.target.checked);
    showToast(`Lantern mode ${e.target.checked ? 'started ✨' : 'stopped'}`, 'info');
  });

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

  attachEventListeners();
  checkBrowserCompatibility();
  loadCurvesList();
  renderCurveGraph();

  // Initial UI state
  handleTelemetryUpdate(activeClient.telemetry);

  // Auto-connect to previously paired Bluetooth device if permitted by browser
  if (bleClient && bleClient.isWebBluetoothSupported() && typeof navigator.bluetooth?.getDevices === 'function') {
    bleClient.autoConnect().then((connected) => {
      if (connected) {
        showToast(`Auto-connected to ${bleClient.telemetry.device_name || 'Puff'}! 🌿`, 'success', 3500);
      }
    }).catch((err) => {
      console.log('[PuffStudio] Auto-connect check bypassed:', err);
    });
  }

  // Register Service Worker for offline PWA
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => {
      console.log('ServiceWorker registration skipped:', e);
    });
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
