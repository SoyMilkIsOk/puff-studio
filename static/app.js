/**
 * Puffco Studio — Frontend Controller, Live Telemetry & Heat Curve Studio
 * Features:
 * - Real-time WebSockets telemetry & dual-trace graph
 * - Interactive SVG curve canvas with draggable keyframe nodes
 * - Clean curve presets & persistent custom library
 * - BLE host governor execution with real-time playhead tracking
 */

// Global State
let currentTelemetry = null;
let ws = null;
let wsReconnectTimer = null;
let isScanning = false;

// Curves State
let curvesList = [];
let currentCurve = {
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
};
let isDraggingNode = false;
let draggingNodeIndex = -1;
let actualTrailPoints = []; // [{x, y}] for live recorded bowl temperature
let isCurveRunning = false;

// Live Session Heat Curve State (below dial)
let liveSessionPoints = [];
let sessionStartTime = null;
let lastPointRecordTime = 0;
let sessionPeakTemp = 0;
let sessionTempSum = 0;
let sessionTempCount = 0;
let wasHeating = false;

// DOM Elements Cache
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
  batteryDisplay: document.getElementById('battery-level-display'),
  batteryBolt: document.getElementById('battery-bolt'),
  mainConnectBtn: document.getElementById('main-connect-btn'),
  demoModeToggle: document.getElementById('demo-mode-toggle'),
  wsIndicator: document.getElementById('ws-indicator'),

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

  scanModal: document.getElementById('scan-modal'),
  scanModalBtn: document.getElementById('scan-modal-btn'),
  closeScanModal: document.getElementById('close-scan-modal'),
  rescanBtn: document.getElementById('rescan-btn'),
  scannedDevicesList: document.getElementById('scanned-devices-list'),
  scanStatusBanner: document.getElementById('scan-status-banner'),
  scanStatusText: document.getElementById('scan-status-text'),

  toastContainer: document.getElementById('toast-container'),
};

// ---------------- WebSocket Telemetry ----------------

function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;

  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    el.wsIndicator.textContent = 'WS Live';
    el.wsIndicator.className = 'ws-pill ws-connected';
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'telemetry' && msg.data) {
        handleTelemetryUpdate(msg.data);
      } else if (msg.type === 'curve_telemetry' && msg.data) {
        handleCurveTelemetry(msg.data);
      } else if (msg.type === 'event') {
        showToast(msg.message, 'info');
      }
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  };

  ws.onclose = () => {
    el.wsIndicator.textContent = 'WS Offline';
    el.wsIndicator.className = 'ws-pill ws-disconnected';
    if (!wsReconnectTimer) {
      wsReconnectTimer = setTimeout(initWebSocket, 2000);
    }
  };

  ws.onerror = (err) => {
    console.warn('WS error:', err);
  };
}

// ---------------- Telemetry Rendering ----------------

function handleTelemetryUpdate(data) {
  currentTelemetry = data;

  const connected = !!data.connected;
  const isHeating = !!data.is_heating || ['HEAT_PREHEAT', 'HEAT_ACTIVE', 'READY'].includes(data.operating_state);

  // Device & Status Pill
  if (connected) {
    el.devicePill.className = 'status-pill status-connected';
    el.deviceName.textContent = data.device_name || 'Puffco Device';
    el.mainConnectBtn.textContent = 'Disconnect';
    el.mainConnectBtn.className = 'btn btn-secondary';
  } else {
    el.devicePill.className = 'status-pill status-disconnected';
    el.deviceName.textContent = 'Disconnected';
    el.mainConnectBtn.textContent = 'Connect';
    el.mainConnectBtn.className = 'btn btn-primary';
  }

  // Chamber Pill
  el.chamberPill.textContent = data.chamber_name || '3DXL';
  el.statChamberName.textContent = (data.chamber_name || '3DXL') + ' Chamber';

  // Battery Widget
  const batPct = Math.max(0, Math.min(100, data.battery_pct || 0));
  el.batteryDisplay.textContent = connected ? `${batPct}%` : '--%';
  el.batteryBolt.classList.toggle('hidden', !data.is_charging);
  if (connected && data.is_charging) {
    el.batteryDisplay.parentElement.classList.add('charging');
  } else {
    el.batteryDisplay.parentElement.classList.remove('charging');
  }

  // Operating State Badge
  updateStateBadge(data.operating_state, data.state_name);

  // Temperature Readouts
  const liveTemp = Number(data.live_temp_f || 0);
  const targetTemp = Number(data.target_temp_f || 485);
  el.liveTempVal.textContent = connected && liveTemp > 30 ? Math.round(liveTemp) : '--';
  el.targetTempVal.textContent = Math.round(targetTemp);

  // Update SVG Dial Arc & Needle (Operating dab range: 350°F to 600°F)
  updateGauge(liveTemp, targetTemp, isHeating, data.operating_state);

  // Update Live Session Heat Curve (below dial)
  updateLiveSessionGraph(data, isHeating, liveTemp, targetTemp);

  // Session Timer Pill
  const timeRem = Number(data.time_remaining || 0);
  if (connected && (isHeating || timeRem > 0)) {
    el.timerPill.classList.remove('hidden');
    el.timeRemainingVal.textContent = timeRem;
  } else {
    el.timerPill.classList.add('hidden');
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
  el.statFirmwareVersion.textContent = connected && data.firmware_version ? data.firmware_version : (connected ? 'V1.3' : '--');

  // Stealth & Lantern toggles sync
  el.stealthToggle.checked = !!data.stealth_mode;
  el.lanternToggle.checked = !!data.lantern_active;
  el.demoModeToggle.checked = !!data.is_demo;

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

  // Progress arc fills from 400°F to 600°F (the active vaporization range)
  let livePct = 0;
  if (liveTemp >= minDialTemp) {
    livePct = Math.max(0, Math.min(1, (liveTemp - minDialTemp) / (maxDialTemp - minDialTemp)));
  }
  const offset = maxArc * (1 - livePct);
  el.dialProgress.style.strokeDashoffset = offset;

  // Target setpoint needle tick (accurately calibrated to 400°F - 600°F arc)
  const targetPct = Math.max(0, Math.min(1, (targetTemp - minDialTemp) / (maxDialTemp - minDialTemp)));
  const needleAngle = targetPct * 240;

  // Dual SVG attribute + CSS transform for 100% robust cross-browser pivot alignment
  if (el.dialNeedleGroup) {
    el.dialNeedleGroup.setAttribute('transform', `rotate(${needleAngle} 160 160)`);
    el.dialNeedleGroup.style.transform = `rotate(${needleAngle}deg)`;
  } else if (el.dialNeedle) {
    el.dialNeedle.setAttribute('transform', `rotate(${needleAngle} 160 160)`);
    el.dialNeedle.style.transform = `rotate(${needleAngle}deg)`;
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

  // 1. Legend labels
  el.lsgTargetReadout.textContent = `${Math.round(targetTemp)}°`;
  el.lsgLiveReadout.textContent = liveTemp > 30 ? `${Math.round(liveTemp)}°` : '--°';

  // 2. Position horizontal target line (scale 70°F to 600°F -> y: 148 to 16)
  const targetNorm = Math.max(0, Math.min(1, (targetTemp - 70) / (600 - 70)));
  const targetY = 148 - targetNorm * (148 - 16);
  el.lsgTargetLine.setAttribute('y1', targetY);
  el.lsgTargetLine.setAttribute('y2', targetY);

  const totalDuration = Number(data.total_time || 50);

  // 3. Detect session start (records initial bowl temp at t = 0)
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

  // 4. While session is active
  if (isHeating && sessionStartTime !== null) {
    const now = performance.now();
    const elapsed = Math.max(0, (now - sessionStartTime) / 1000);
    const opState = data.operating_state || '';

    // Update phase pill
    if (opState === 'HEAT_PREHEAT') {
      el.lsgPhasePill.className = 'badge badge-warning';
      el.lsgPhasePill.textContent = 'PREHEATING';
    } else if (opState === 'READY') {
      el.lsgPhasePill.className = 'badge badge-info';
      el.lsgPhasePill.textContent = 'READY TO INHALE';
    } else {
      el.lsgPhasePill.className = 'badge badge-subtle';
      el.lsgPhasePill.textContent = 'ACTIVE SESH';
    }

    // Peak & Average statistics
    if (liveTemp > sessionPeakTemp) sessionPeakTemp = liveTemp;
    sessionTempSum += liveTemp;
    sessionTempCount++;

    el.lsgPeakStat.textContent = `${Math.round(sessionPeakTemp)}°F`;
    el.lsgAvgStat.textContent = `${Math.round(sessionTempSum / sessionTempCount)}°F`;
    el.lsgTimeStat.textContent = `${Math.round(elapsed)}s / ${totalDuration}s`;

    // Sample points cleanly (~100ms interval or significant temp change)
    if (now - lastPointRecordTime >= 100 || Math.abs(liveTemp - (liveSessionPoints[liveSessionPoints.length - 1]?.temp || 0)) >= 1.0) {
      liveSessionPoints.push({ t: elapsed, temp: liveTemp });
      lastPointRecordTime = now;
    }

    // Dynamic timeline window (automatically expands if preheat + session exceeds profile duration)
    const windowDuration = Math.max(totalDuration, elapsed > totalDuration ? Math.ceil(elapsed + 5) : totalDuration);
    if (el.lsgT1) el.lsgT1.textContent = `${Math.round(windowDuration * 0.25)}s`;
    if (el.lsgT2) el.lsgT2.textContent = `${Math.round(windowDuration * 0.5)}s`;
    if (el.lsgT3) el.lsgT3.textContent = `${Math.round(windowDuration * 0.75)}s`;
    if (el.lsgT4) el.lsgT4.textContent = `${windowDuration}s`;

    // Render smooth SVG path & gradient fill
    if (liveSessionPoints.length > 0) {
      let strokeD = '';
      let currX = 0;
      let currY = 148;

      for (let i = 0; i < liveSessionPoints.length; i++) {
        const pt = liveSessionPoints[i];
        const px = Math.min(500, Math.max(0, (pt.t / windowDuration) * 500));
        const pyNorm = Math.max(0, Math.min(1, (pt.temp - 70) / (600 - 70)));
        const py = 148 - pyNorm * (148 - 16);
        currX = px;
        currY = py;

        if (i === 0) {
          strokeD += `M ${px.toFixed(1)} ${py.toFixed(1)}`;
        } else {
          strokeD += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
        }
      }

      el.lsgTrailStroke.setAttribute('d', strokeD);
      const areaD = `${strokeD} L ${currX.toFixed(1)} 160 L 0 160 Z`;
      el.lsgTrailArea.setAttribute('d', areaD);

      el.lsgLiveDot.setAttribute('cx', currX.toFixed(1));
      el.lsgLiveDot.setAttribute('cy', currY.toFixed(1));
      el.lsgLiveDot.classList.remove('hidden');
    }
  } else if (!isHeating) {
    if (wasHeating) {
      el.lsgPhasePill.className = 'badge badge-subtle';
      el.lsgPhasePill.textContent = 'COMPLETE';
      el.lsgLiveDot.classList.add('hidden');
    } else if (liveSessionPoints.length === 0) {
      el.lsgPhasePill.className = 'badge badge-subtle';
      el.lsgPhasePill.textContent = 'STANDBY';
      el.lsgTimeStat.textContent = `0s / ${totalDuration}s`;
    }
  }

  wasHeating = isHeating;
}

function renderProfiles(profiles, activeSlot, connected) {
  const existingCards = el.profilesContainer.querySelectorAll('.profile-card');

  // If cards already exist and match profiles length, update in-place without touching DOM tree
  if (existingCards.length === profiles.length && existingCards.length > 0) {
    profiles.forEach((p, idx) => {
      const card = existingCards[idx];
      const slot = p.slot ?? idx;
      card.dataset.slot = slot;

      // Update active state cleanly
      card.classList.toggle('active', idx === activeSlot);

      // Update values if changed
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

  // Initial creation or length mismatch
  el.profilesContainer.innerHTML = '';

  profiles.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = `profile-card ${idx === activeSlot ? 'active' : ''}`;
    const slot = p.slot ?? idx;
    card.dataset.slot = slot;

    const slotBadge = document.createElement('div');
    slotBadge.className = 'profile-slot-badge';
    slotBadge.textContent = `SLOT ${idx + 1}`;

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

    card.addEventListener('click', () => {
      if (!currentTelemetry?.connected) {
        showToast('Connect device to change heat profile', 'error');
        return;
      }
      selectProfile(slot);
    });

    el.profilesContainer.appendChild(card);
  });
}

// ---------------- Tab Navigation ----------------

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
// Heat Curve Studio Logic & SVG Canvas
// ==========================================================================

const GRAPH_WIDTH = 800;
const GRAPH_HEIGHT = 360;
const TIME_MAX = 90; // Seconds
const TEMP_MIN = 400; // °F
const TEMP_MAX = 580; // °F

function timeToX(t) {
  return (Math.max(0, Math.min(TIME_MAX, t)) / TIME_MAX) * GRAPH_WIDTH;
}

function xToTime(x) {
  return Math.round((Math.max(0, Math.min(GRAPH_WIDTH, x)) / GRAPH_WIDTH) * TIME_MAX);
}

function tempToY(t) {
  const norm = (Math.max(TEMP_MIN, Math.min(TEMP_MAX, t)) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
  return (1 - norm) * (GRAPH_HEIGHT - 36) + 18; // Leave margin top/bottom
}

function yToTemp(y) {
  const clampedY = Math.max(18, Math.min(GRAPH_HEIGHT - 18, y));
  const norm = 1 - (clampedY - 18) / (GRAPH_HEIGHT - 36);
  return Math.round(TEMP_MIN + norm * (TEMP_MAX - TEMP_MIN));
}

function renderCurveGraph() {
  const kfs = currentCurve.keyframes;
  if (!kfs || kfs.length === 0) return;

  // Build SVG path
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
    circle.setAttribute('r', '7');
    circle.setAttribute('fill', '#11141e');
    circle.setAttribute('stroke', '#ff7a00');
    circle.setAttribute('stroke-width', '3');
    circle.setAttribute('class', 'curve-node');
    circle.dataset.index = idx;

    // Drag events
    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isDraggingNode = true;
      draggingNodeIndex = idx;
      circle.classList.add('dragging');
    });

    // Double-click to delete
    circle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      deleteKeyframe(idx);
    });

    el.curvePointsLayer.appendChild(circle);
  });

  // Update Meta labels
  el.activeCurveTitle.textContent = currentCurve.name;
  el.activeCurveDesc.textContent = currentCurve.description || '';
  el.curveDurationBadge.textContent = `${currentCurve.duration_s}s Sesh`;
  if (!isCurveRunning) {
    el.curveElapsedDisplay.textContent = `0.0s / ${currentCurve.duration_s}s`;
    el.curveSetpointDisplay.textContent = `${kfs[0].temp_f}°F`;
  }

  // Rebuild Keyframe Table
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

// Setup SVG Drag & Click Interaction
function setupSvgInteraction() {
  const svg = el.curveSvg;

  function getSvgCoords(e) {
    const rect = svg.getBoundingClientRect();
    const scaleX = GRAPH_WIDTH / rect.width;
    const scaleY = GRAPH_HEIGHT / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  // Click on blank SVG canvas to add keyframe
  svg.addEventListener('click', (e) => {
    if (isDraggingNode) return;
    const coords = getSvgCoords(e);
    const time = xToTime(coords.x);
    const temp = yToTemp(coords.y);
    addKeyframe(time, temp);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingNode || draggingNodeIndex < 0) return;
    const coords = getSvgCoords(e);
    const time = xToTime(coords.x);
    const temp = yToTemp(coords.y);

    const kf = currentCurve.keyframes[draggingNodeIndex];
    if (kf) {
      kf.time_s = time;
      kf.temp_f = temp;
      renderCurveGraph();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingNode) {
      isDraggingNode = false;
      draggingNodeIndex = -1;
      sortAndRefreshCurve();
    }
  });

  el.addKeyframeBtn.addEventListener('click', () => {
    const last = currentCurve.keyframes[currentCurve.keyframes.length - 1];
    const newTime = last ? Math.min(TIME_MAX, last.time_s + 10) : 30;
    addKeyframe(newTime, 485);
  });
}

// ---------------- Curve Presets & Library ----------------

async function loadCurvesList() {
  const res = await apiRequest('/api/curves');
  if (res.ok && res.data?.curves) {
    curvesList = res.data.curves;
    renderCurvePills();
  }
}

function renderCurvePills() {
  el.curvePillsContainer.innerHTML = '';
  curvesList.forEach((c) => {
    const pill = document.createElement('button');
    pill.className = `curve-pill ${c.id === currentCurve.id ? 'active' : ''}`;
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
      name: "Custom Curve",
      description: "User-defined custom temperature profile",
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

  el.confirmSaveCurveBtn.addEventListener('click', async () => {
    const name = el.saveCurveNameInput.value.trim() || 'Custom Curve';
    const desc = el.saveCurveDescInput.value.trim();
    currentCurve.name = name;
    currentCurve.description = desc;

    const res = await apiRequest('/api/curves', 'POST', currentCurve);
    if (res.ok) {
      showToast(`Curve "${name}" saved to library!`, 'success');
      el.saveCurveModal.classList.add('hidden');
      await loadCurvesList();
    } else {
      showToast('Failed to save curve', 'error');
    }
  });

  // Run Curve
  el.runCurveBtn.addEventListener('click', async () => {
    if (isCurveRunning) return;
    if (!currentTelemetry?.connected) {
      showToast('Connect your Puffco device to run this curve', 'error');
      return;
    }

    actualTrailPoints = [];
    el.curveActualTrail.setAttribute('d', '');
    el.runCurveBtn.disabled = true;
    el.runCurveBtnLabel.textContent = 'STARTING...';

    const res = await apiRequest('/api/curves/run', 'POST', currentCurve);
    if (res.ok) {
      isCurveRunning = true;
      el.runCurveBtn.disabled = false;
      el.runCurveBtnLabel.textContent = 'RUNNING CURVE...';
      el.stopCurveBtn.disabled = false;
      el.curveStatusBadge.className = 'state-tag state-heating';
      el.curveStatusBadge.textContent = 'HEATING CURVE';
      el.curvePlayheadLine.classList.remove('hidden');
      el.curvePlayheadDot.classList.remove('hidden');
      showToast(`Executing curve "${currentCurve.name}"! 🔥`, 'success');
    } else {
      el.runCurveBtn.disabled = false;
      el.runCurveBtnLabel.textContent = 'EXECUTE HEAT CURVE';
      showToast(res.data?.message || 'Failed to start curve', 'error');
    }
  });

  // Stop Curve
  el.stopCurveBtn.addEventListener('click', async () => {
    await apiRequest('/api/curves/stop', 'POST');
    showToast('Curve governor stopped', 'info');
  });
}

function handleCurveTelemetry(data) {
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

  // Distinguish PREHEATING vs RUNNING phase
  if (data.phase === 'preheating') {
    el.runCurveBtnLabel.textContent = 'PREHEATING BOWL...';
    el.curveStatusBadge.className = 'state-tag state-heating';
    el.curveStatusBadge.textContent = `PREHEATING TO ${Math.round(target)}°F`;

    el.curveElapsedDisplay.textContent = `PREHEATING (${live.toFixed(1)}°F → ${Math.round(target)}°F)`;
    el.curveSetpointDisplay.textContent = `${target.toFixed(1)}°F`;
    el.curveActualDisplay.textContent = `${live.toFixed(1)}°F`;

    // Keep playhead at start line during preheating
    const playheadX = timeToX(0);
    const playheadY = tempToY(target);
    el.curvePlayheadLine.setAttribute('x1', playheadX);
    el.curvePlayheadLine.setAttribute('x2', playheadX);
    el.curvePlayheadDot.setAttribute('cx', playheadX);
    el.curvePlayheadDot.setAttribute('cy', playheadY);
    el.curvePlayheadLine.classList.remove('hidden');
    el.curvePlayheadDot.classList.remove('hidden');
  } else {
    // Active curve governor phase
    el.runCurveBtnLabel.textContent = 'RUNNING CURVE...';
    el.curveStatusBadge.className = 'state-tag state-ready';
    el.curveStatusBadge.textContent = 'ACTIVE GOVERNOR';

    el.curveElapsedDisplay.textContent = `${elapsed.toFixed(1)}s / ${total}s`;
    el.curveSetpointDisplay.textContent = `${target.toFixed(1)}°F`;
    el.curveActualDisplay.textContent = `${live.toFixed(1)}°F`;

    // Move Playhead Needle along timeline
    const playheadX = timeToX(elapsed);
    const playheadY = tempToY(target);
    el.curvePlayheadLine.setAttribute('x1', playheadX);
    el.curvePlayheadLine.setAttribute('x2', playheadX);
    el.curvePlayheadDot.setAttribute('cx', playheadX);
    el.curvePlayheadDot.setAttribute('cy', playheadY);
    el.curvePlayheadLine.classList.remove('hidden');
    el.curvePlayheadDot.classList.remove('hidden');

    // Record live actual temperature trail on the graph
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

// ---------------- Standard REST API Actions ----------------

async function apiRequest(endpoint, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(endpoint, opts);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`API ${endpoint} error:`, err);
    return { ok: false, data: { message: err.message } };
  }
}

async function connectDevice(address = null) {
  showToast('Connecting to Puffco BLE device...', 'info');
  el.mainConnectBtn.disabled = true;
  el.mainConnectBtn.textContent = 'Connecting...';

  const res = await apiRequest('/api/connect', 'POST', address ? { address } : {});
  el.mainConnectBtn.disabled = false;

  if (res.ok) {
    showToast('Connected to device successfully!', 'success');
  } else {
    showToast(res.data?.message || 'Failed to connect. Ensure device is awake.', 'error');
    el.mainConnectBtn.textContent = 'Connect';
    el.mainConnectBtn.className = 'btn btn-primary';
  }
}

async function disconnectDevice() {
  showToast('Disconnecting...', 'info');
  await apiRequest('/api/disconnect', 'POST');
}

async function startSession() {
  const res = await apiRequest('/api/session/start', 'POST');
  if (res.ok) {
    showToast('Heating session initiated! 🔥', 'success');
  } else {
    showToast(res.data?.message || 'Failed to start session', 'error');
  }
}

async function boostSession() {
  const res = await apiRequest('/api/session/boost', 'POST');
  if (res.ok) {
    showToast('Heat boost triggered (+15s / +10°F) ⚡', 'success');
  } else {
    showToast(res.data?.message || 'Failed to send boost', 'error');
  }
}

async function stopSession() {
  const res = await apiRequest('/api/session/stop', 'POST');
  if (res.ok) {
    showToast('Session cancelled / cooling down', 'info');
  } else {
    showToast(res.data?.message || 'Failed to cancel session', 'error');
  }
}

async function selectProfile(slot) {
  const res = await apiRequest('/api/profile/select', 'POST', { slot });
  if (res.ok) {
    showToast(`Profile slot ${slot + 1} selected`, 'info');
  } else {
    showToast(res.data?.message || 'Failed to select profile', 'error');
  }
}

async function applyTemperature(temp_f) {
  const res = await apiRequest('/api/temperature', 'POST', { temp_f });
  if (res.ok) {
    showToast(`Target temperature set to ${temp_f}°F`, 'success');
  } else {
    showToast(res.data?.message || 'Failed to update temperature', 'error');
  }
}

async function toggleStealth(enabled) {
  const res = await apiRequest('/api/stealth', 'POST', { enabled });
  if (res.ok) {
    showToast(`Stealth mode ${enabled ? 'enabled (LEDs off)' : 'disabled'}`, 'info');
  } else {
    showToast('Failed to toggle stealth mode', 'error');
  }
}

async function toggleLantern(enabled) {
  const res = await apiRequest('/api/lantern', 'POST', { enabled });
  if (res.ok) {
    showToast(`Lantern mode ${enabled ? 'started ✨' : 'stopped'}`, 'info');
  } else {
    showToast('Failed to toggle lantern mode', 'error');
  }
}

async function enterSleep() {
  if (!confirm('Put device into low-power sleep mode?')) return;
  const res = await apiRequest('/api/power/sleep', 'POST');
  if (res.ok) {
    showToast('Puffco entered sleep mode 💤', 'info');
  }
}

async function powerOff() {
  if (!confirm('Completely power off your Puffco device?')) return;
  const res = await apiRequest('/api/power/off', 'POST');
  if (res.ok) {
    showToast('Device powered down', 'info');
  }
}

async function toggleDemo(enabled) {
  const res = await apiRequest('/api/demo', 'POST', { enabled });
  if (res.ok) {
    showToast(enabled ? 'Demo simulation mode enabled' : 'Demo mode deactivated', 'info');
  }
}

// ---------------- Scanner Modal ----------------

async function runDeviceScan() {
  if (isScanning) return;
  isScanning = true;
  el.scanStatusBanner.classList.remove('hidden');
  el.scanStatusText.textContent = 'Scanning for Bluetooth LE advertisements (4s)...';
  el.scannedDevicesList.innerHTML = '';
  el.rescanBtn.disabled = true;

  const res = await apiRequest('/api/scan?timeout=4.0', 'GET');
  isScanning = false;
  el.rescanBtn.disabled = false;
  el.scanStatusBanner.classList.add('hidden');

  if (res.ok && res.data?.devices && res.data.devices.length > 0) {
    renderScannedDevices(res.data.devices);
  } else {
    el.scannedDevicesList.innerHTML = `
      <div style="text-align:center; padding: 24px; color: var(--text-muted); font-size: 0.85rem;">
        No Puffco devices found in range.<br>Ensure Bluetooth is enabled and device is awake.
      </div>
    `;
  }
}

function renderScannedDevices(devices) {
  el.scannedDevicesList.innerHTML = '';
  devices.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'device-item';

    const info = document.createElement('div');
    info.className = 'device-item-info';

    const name = document.createElement('div');
    name.className = 'device-item-name';
    name.textContent = d.name || 'Puffco Device';

    const addr = document.createElement('div');
    addr.className = 'device-item-addr';
    addr.textContent = d.address;

    const rssi = document.createElement('div');
    rssi.className = 'device-item-rssi';
    rssi.textContent = `RSSI: ${d.rssi} dBm`;

    info.appendChild(name);
    info.appendChild(addr);
    info.appendChild(rssi);

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn btn-primary';
    connectBtn.textContent = 'Connect';
    connectBtn.style.padding = '6px 14px';
    connectBtn.style.fontSize = '0.8rem';
    connectBtn.addEventListener('click', async () => {
      closeScanModal();
      await connectDevice(d.address);
    });

    item.appendChild(info);
    item.appendChild(connectBtn);
    el.scannedDevicesList.appendChild(item);
  });
}

function openScanModal() {
  el.scanModal.classList.remove('hidden');
  runDeviceScan();
}

function closeScanModal() {
  el.scanModal.classList.add('hidden');
}

// ---------------- Toast Alerts ----------------

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

// ---------------- Event Listeners ----------------

function attachEventListeners() {
  setupTabs();
  setupSvgInteraction();
  setupCurveActions();

  // Main Connect / Disconnect button
  el.mainConnectBtn.addEventListener('click', () => {
    if (currentTelemetry && currentTelemetry.connected) {
      disconnectDevice();
    } else {
      connectDevice();
    }
  });

  // Standard Sesh Control Buttons
  el.startSeshBtn.addEventListener('click', startSession);
  el.boostSeshBtn.addEventListener('click', boostSession);
  el.stopSeshBtn.addEventListener('click', stopSession);

  // Temperature Slider & Controls
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

  el.applyTempBtn.addEventListener('click', () => {
    applyTemperature(Number(el.tempSlider.value));
  });

  el.presetPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      const temp = Number(btn.dataset.temp);
      el.tempSlider.value = temp;
      el.sliderTempVal.textContent = `${temp}°F`;
      applyTemperature(temp);
    });
  });

  // Toggles
  el.stealthToggle.addEventListener('change', (e) => toggleStealth(e.target.checked));
  el.lanternToggle.addEventListener('change', (e) => toggleLantern(e.target.checked));
  el.demoModeToggle.addEventListener('change', (e) => toggleDemo(e.target.checked));

  // Power
  el.sleepBtn.addEventListener('click', enterSleep);
  el.powerOffBtn.addEventListener('click', powerOff);

  // Scanner Modal
  el.scanModalBtn.addEventListener('click', openScanModal);
  el.closeScanModal.addEventListener('click', closeScanModal);
  el.rescanBtn.addEventListener('click', runDeviceScan);
  el.scanModal.addEventListener('click', (e) => {
    if (e.target === el.scanModal) closeScanModal();
  });
}

// ---------------- Bootstrap ----------------

async function bootstrap() {
  attachEventListeners();
  initWebSocket();
  await loadCurvesList();
  renderCurveGraph();

  // Initial status fetch
  const res = await apiRequest('/api/status');
  if (res.ok && res.data) {
    handleTelemetryUpdate(res.data);
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
