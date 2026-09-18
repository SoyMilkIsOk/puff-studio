# Puff Studio — Local Web Controller & Heat Curve Studio
### A Companion Reference Application for [`puffco-py`](https://github.com/SoyMilkIsOk/puffco-py)

[![PyPI - puffco-py](https://img.shields.io/pypi/v/puffco-py.svg?color=blue&label=puffco-py)](https://pypi.org/project/puffco-py/)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Platform: Windows | macOS | Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen.svg)](#prerequisites)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![BLE: Bleak](https://img.shields.io/badge/BLE-Bleak-blueviolet.svg)](https://github.com/hbldh/bleak)
[![Status: Companion Showcase](https://img.shields.io/badge/Role-Tagalong%20Showcase-cyan.svg)](#about-this-project)

---

## About This Project

> [!NOTE]
> **Puff Studio** is a **companion / tagalong reference repository** created specifically to demonstrate what the [`puffco-py`](https://github.com/SoyMilkIsOk/puffco-py) package is capable of when used to power a full-stack, production-grade application.

While [`puffco-py`](https://pypi.org/project/puffco-py/) provides the core Python Bluetooth Low Energy (BLE) driver, reverse-engineered Lorax protocol parser, and hardware abstraction layer for Puffco Peak Pro and Proxy devices, **Puff Studio** showcases how to harness that library to build:

1. **A Real-Time Web Controller & HUD**: Interactive browser-based telemetry dial, live session graphs, battery/chamber diagnostics, and tactile session triggers streaming at 2 Hz over WebSockets.
2. **Dynamic Host-Side Heat Curve Studio**: A visual SVG curve editor with custom temperature ramp interpolation ($400^\circ\text{F} \rightarrow 580^\circ\text{F}$) driving the device's hardware PID loop in real time over BLE.
3. **Hardware Profile & Flash Synchronization**: Direct reading, backup, modification, and restoration of on-device flash memory profile slots without vendor mobile app lock-in.
4. **Offline Mock & Simulation Architecture**: Demonstrating how to build robust hardware applications that can run in demo mode using `puffco-py` design patterns when physical devices are offline.

If you are a developer looking to integrate Puffco devices into **Home Assistant**, build **custom automated rigs**, or build **native desktop/mobile tools**, this repository serves as a complete architectural reference.

---

## Architecture: How Puff Studio Builds on `puffco-py`

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Puff Studio Frontend                          │
│        Interactive SVG Heat Curve Editor • Thermal Dial HUD • Controls │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / WebSocket (JSON)
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Puff Studio Server (server.py)                    │
│     aiohttp Web Server • Curve Governor • State Manager • REST APIs     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ High-level Async Python Calls
┌───────────────────────────────────▼────────────────────────────────────┐
│                       puffco-py (v0.1.3+) Engine                       │
│    • PuffcoClient & Connection Lifecycle                               │
│    • Lorax Protocol Handler & VFS Address Mapping                      │
│    • scan_puffco_devices() BLE Discovery                              │
│    • OperatingState & ChamberType State Machines                       │
│    • f_to_c() & IEEE-754 Telemetry Decoding                           │
│    • Custom Exceptions (PuffcoError, PuffcoConnectionError)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ GATT Read / Write / Notify
┌───────────────────────────────────▼────────────────────────────────────┐
│                      Bluetooth LE Stack (Bleak)                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 2.4 GHz BLE RF
┌───────────────────────────────────▼────────────────────────────────────┐
│            Puffco Hardware (Peak Pro / 3DXL / Proxy)                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features Powered by `puffco-py`

### 1. Dynamic Heat Curve Studio
- **Interactive Visual Canvas**: Plot Temperature (400°F–580°F) against Time (0s–90s) with glowing SVG gradients and draggable control keyframes.
- **Active Real-Time BLE Governor**: Computes linear piece-wise interpolations between keyframes at 2 Hz during an active session and updates the hardware setpoint over BLE on the fly.
- **Preheat Synchronization**: Automatically holds the curve clock during preheating while tracking live bowl climb (`PREHEATING: 135°F → 430°F`), officially starting the curve timeline only when the chamber reaches target temperature or enters `READY` state.
- **Flash Memory Safety**: Automatically writes the exact curve duration to hardware flash at session start (eliminating spurious timeout boosts) and restores original profile settings when complete.
- **Persistent Library (`curves.json`)**: Included presets:
  - `Step 430 → 485 → 520` (50s): 3-stage progression (cold-start flavor → cannabinoid vapor → cloud finish).
  - `Decay 535 → 465` (50s): Traditional quartz banger emulation (hot drop descending as oil thins).
  - `Linear 420 → 510` (60s): Smooth continuous thermal ramp (+1.5°F/s).
  - `Dwell 450` (60s): Low-temp plateau for live rosin and delicate terpenes.
  - `Peak Boost 480 → 535` (55s): Steady 480°F extraction with an aggressive 535°F cloud finish.

### 2. Live Chamber Dynamics & Telemetry HUD
- **Thermal Dial Gauge**: Circular SVG gauge displaying real-time bowl temperature vs setpoint with ambient state-reactive glow, calibrated 400°F–600°F scale ticks, and live needles.
- **Live Session Heat Curve**: Plots the actual chamber temperature trail starting from $t=0$, tracking preheat climb, plateau stability, and cooling ramp.
- **Tactile Session Controls**: One-click **START SESH**, real-time **BOOST (+15s / +10°F)**, and emergency **STOP** abort.
- **Hardware Diagnostics**: Live battery percentage, charging indicator, chamber detection (`3DXL`, regular, or missing), lifetime dab odometer, and BLE MAC/UUID.
- **Peripherals & Power Management**: Direct control over Stealth Mode (instant LED blackout), Lantern glow, low-power Sleep Mode, and complete Power Off.

### 3. BLE Discovery & Simulation
- **Device Scanner Modal**: Scans for nearby Puffco devices (`scan_puffco_devices`) and displays signal strength and device names for 1-click connection.
- **Built-in Demo / Simulator Mode**: Full offline simulation engine for testing heat curves and UI interactions without physical hardware.

---

## Code Recipes: How `puffco-py` is Used in This Repo

Here are examples showing how cleanly `server.py` leverages `puffco-py` primitives:

### 1. Automatic Discovery & Connection
```python
from puffco_py import scan_puffco_devices, PuffcoClient

# Discover nearby devices advertising Puffco BLE GATT services
devices = await scan_puffco_devices(timeout=5.0)
for dev in devices:
    print(f"Discovered {dev.name} at {dev.address}")

# Connect with auto-reconnection and Lorax handshake
client = PuffcoClient(target_address=devices[0].address, auto_reconnect=True)
await client.connect()
```

### 2. Reading Live Telemetry
```python
# The client maintains continuous telemetry state updated via BLE notifications
telemetry = client.telemetry

print(f"State: {telemetry.state_name}")          # IDLE, HEAT_PREHEAT, HEAT_ACTIVE, HEAT_FADE
print(f"Bowl Temp: {telemetry.chamber_temp_f:.1f}°F")
print(f"Target Temp: {telemetry.target_temp_f:.1f}°F")
print(f"Battery: {telemetry.battery_percent}%")
print(f"Chamber: {telemetry.chamber_type_name}") # e.g. 3DXL
print(f"Total Dabs: {telemetry.total_dabs}")
```

### 3. Dynamic Host-Side Setpoint Governor
```python
from puffco_py.constants import PATH_PROFILE_TEMP_PREFIX
from puffco_py.protocol import f_to_c
import struct

# Actively command the hardware PID loop to adjust temperature during a curve
temp_c = f_to_c(desired_temp_f)
temp_bytes = struct.pack("<f", temp_c)
await client.write_characteristic(PATH_PROFILE_TEMP_PREFIX, temp_bytes)
```

### 4. Hardware Power & Peripheral Control
```python
from puffco_py.constants import PATH_MODE_CONTROL

# Trigger hardware commands directly
await client.write_characteristic(PATH_MODE_CONTROL, bytes([0x01])) # Start Heat
await client.write_characteristic(PATH_MODE_CONTROL, bytes([0x02])) # Stop Heat
```

---

## Getting Started

### Prerequisites
- **Operating System**: Fully cross-platform!
  - **Windows**: Windows 10 (version 16299+) or Windows 11 with Bluetooth LE 4.0+ hardware. Runs natively using Windows WinRT Bluetooth APIs (`Windows.Devices.Bluetooth`) via `bleak`—no custom drivers (like Zadig/WinUSB) needed! Simply ensure Bluetooth is toggled **ON** in Windows Settings.
  - **macOS**: macOS 10.15+ with native CoreBluetooth support.
  - **Linux**: Any modern Linux distribution running BlueZ 5.43+.
- **Python**: 3.10 or higher (available via [python.org](https://www.python.org/downloads/) or Microsoft Store / winget on Windows).
- **Puffco Device**: Peak Pro (v1 or v2), Peak Pro with 3DXL chamber, or Proxy.

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/SoyMilkIsOk/test-puff.git
   cd test-puff
   ```

2. **Install dependencies** (includes `puffco-py>=0.1.3`):
   ```bash
   pip install -r requirements.txt
   ```
   *Alternatively, install directly via pip:*
   ```bash
   pip install "puffco-py>=0.1.3" aiohttp bleak
   ```

### Running the Application

Start the local server:

**macOS / Linux**:
```bash
python3 server.py
```

**Windows (PowerShell / Command Prompt)**:
```powershell
python server.py
# or using the Python launcher:
py server.py
```

Open your browser to:
> **[http://127.0.0.1:8080](http://127.0.0.1:8080)**

The server will automatically scan for and connect to your nearby Puffco device (e.g. `SAMS PEAK`). If no hardware is currently nearby, click **Demo Mode** in the header or device modal to simulate a live 3DXL chamber and test heat curves instantly!

---

## Project Structure

```
test-puff/
├── server.py          # aiohttp async server, WebSocket hub, and puffco-py BLE curve governor
├── requirements.txt   # Pinned dependencies (puffco-py>=0.1.3, aiohttp, bleak)
├── curves.json        # Persistent JSON database for heat curve presets and user curves
├── README.md          # Project documentation & puffco-py integration guide
└── static/
    ├── index.html     # Semantic HTML5 layout (Controller HUD & Heat Curve Studio)
    ├── styles.css     # Dark cyber glassmorphic design system
    └── app.js         # Reactive client logic, WebSocket handler, and interactive SVG canvas
```

---

## Related Repositories & Links

- **`puffco-py` Core Library**: [https://github.com/SoyMilkIsOk/puffco-py](https://github.com/SoyMilkIsOk/puffco-py)
- **`puffco-py` on PyPI**: [https://pypi.org/project/puffco-py/](https://pypi.org/project/puffco-py/)
- **Bug Tracker & Feature Requests**: [https://github.com/SoyMilkIsOk/test-puff/issues](https://github.com/SoyMilkIsOk/test-puff/issues)

---

## License

This project is licensed under the [MIT License](LICENSE).
Puffco, Peak Pro, Proxy, and 3DXL are registered trademarks of Puffco. This project is an independent open-source demonstration and is not affiliated with or endorsed by Puffco.
