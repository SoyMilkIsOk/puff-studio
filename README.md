# Puffco Studio — Local Web Controller & Heat Curve Studio

A modern, high-performance local web application and real-time Bluetooth LE controller for Puffco Peak Pro and Proxy devices, powered by Python 3 (`aiohttp`) and [`puffco-py`](https://pypi.org/project/puffco-py/).

---

## Key Features

### 1. Dynamic Heat Curve Studio
- **Interactive Curve Canvas**: Visual SVG editor plotting Temperature (400°F–580°F) vs Time (0s–90s) with glowing gradient fill and gridlines.
  - **Draggable Control Nodes**: Drag keypoints up/down to adjust temperature and left/right to adjust timing.
  - **Click-to-Add & Double-Click-to-Delete**: Add arbitrary keyframes anywhere on the graph or remove them instantly.
  - **Numerical Keyframe Table**: Fine-tune exact seconds and degrees via input fields.
- **Preheat Synchronization**: Automatically holds the curve timer during preheating while displaying live temperature climb (`PREHEATING (BOWL: 135°F → 430°F)`), officially starting the curve timeline only when the chamber reaches initial temperature or transitions to `READY`.
- **Active Real-Time BLE Governor**: Actively interpolates temperature setpoints at 2 Hz during the session and drives the hardware PID loop over Bluetooth LE with live register re-assertion.
- **Dual-Trace Live Tracker**: Real-time sweeping playhead needle plotting the **Planned Setpoint Line** alongside the **Actual Live Bowl Temperature Trail** in glowing cyan.
- **Native Duration Setting & Profile Safety**: Writes the exact curve duration to hardware flash at start (eliminating spurious boosts) and automatically restores original profile settings when complete.
- **Persistent Library (`curves.json`)**: Save, edit, and manage custom curves with built-in presets:
  - `Step 430 → 485 → 520` (50s): 3-stage progression (cold-start flavor → cannabinoid vapor → cloud finish).
  - `Decay 535 → 465` (50s): Traditional quartz banger emulation (hot drop descending as oil thins).
  - `Linear 420 → 510` (60s): Smooth continuous linear thermal ramp (+1.5°F/s).
  - `Dwell 450` (60s): Extended low-temp plateau for live rosin and delicate concentrates.
  - `Peak Boost 480 → 535` (55s): Steady 480°F extraction with an aggressive 535°F cloud finish.

### 2. Live Chamber Dynamics & Session Controls
- **Hero Thermal Dial**: Circular SVG gauge displaying real-time bowl temperature vs setpoint with ambient state-reactive glow, calibrated 400°F–600°F scale ticks, endpoint indicators, and an amber setpoint needle.
- **Live Session Heat Curve**: Real-time session telemetry graph located directly below the dial that plots the chamber temperature starting from the current bowl temp at session start ($t=0$), tracking the preheat ramp, setpoint plateau, peak/average temperatures, and live playhead.
- **Session Controls**: Tactile glowing **START SESH**, real-time **BOOST (+15s / +10°F)**, and instant **STOP** abort.
- **Stored Profiles Matrix**: One-click switching between on-device flash memory slots (`Low`, `Medium`, `High`, `ROSIN`) plus temperature fine-tuning slider, steppers, and quick preset pills.
- **Hardware Diagnostics**: Real-time battery indicator with charging detection, chamber detection (`3DXL`), lifetime dab odometer, and Bluetooth UUID.
- **Peripherals & Power**: Stealth Mode toggle (instant LED blackout), ambient Lantern Mode, low-power Sleep Mode, and complete Power Off.
- **Device Scanner**: Built-in BLE discovery modal to scan and connect to nearby Puffco devices.
- **Simulation / Demo Mode**: Built-in simulator engine with realistic thermal curves for testing the UI offline.

---

## Getting Started

### Prerequisites
- macOS or Linux with Bluetooth LE support
- Python 3.10+
- Dependencies: `puffco-py`, `aiohttp`, `bleak`

Install dependencies:
```bash
pip install puffco-py aiohttp bleak
```

### Running the App

Start the server:
```bash
python3 server.py
```

Open your browser to:
> **[http://127.0.0.1:8080](http://127.0.0.1:8080)**

The server will automatically scan for and connect to your nearby Puffco Peak Pro or Proxy (e.g. `SAMS PEAK`).

---

## Project Structure

```
test-puff/
├── server.py        # aiohttp server, WebSocket engine, BLE driver & curve governor
├── curves.json      # Persistent storage for presets and custom heat curves
├── README.md        # Project documentation
└── static/
    ├── index.html   # Semantic HTML5 layout (Controller & Curve Studio tabs)
    ├── styles.css   # Dark cyber glassmorphic design system
    └── app.js       # Reactive client logic, WebSocket handler & SVG canvas editor
```
