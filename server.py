#!/usr/bin/env python3
"""
Puff Studio — Local Web Controller & Heat Curve Studio
Companion / tagalong reference application demonstrating the full capabilities
of the puffco-py library (v0.1.3+) over Bluetooth LE.
"""

import asyncio
import json
import logging
import math
import os
import struct
import sys
import time
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple

from aiohttp import web
import aiohttp

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("puffco_server")

try:
    import puffco_py
    from puffco_py import (
        PuffcoClient,
        OperatingState,
        ChamberType,
        scan_puffco_devices,
    )
    from puffco_py.constants import (
        PATH_ACTIVE_PROFILE,
        PATH_PROFILE_TEMP_PREFIX,
        PATH_PROFILE_TIME_PREFIX,
        PATH_MODE_CONTROL,
    )
    from puffco_py.protocol import f_to_c
except ImportError as e:
    logger.error(f"Failed to import puffco_py: {e}")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CURVES_FILE = os.path.join(BASE_DIR, "curves.json")


def parse_duration_seconds(raw_val: int) -> int:
    """
    On Puffco Peak Pro hardware, profile duration values in flash are often
    IEEE 754 float32 values stored as raw 32-bit integers.
    Decodes float32 if large integer or returns sanitized integer seconds.
    """
    if raw_val > 10000:
        try:
            f_val = struct.unpack("<f", struct.pack("<I", raw_val))[0]
            if 5.0 <= f_val <= 300.0:
                return int(round(f_val))
        except Exception:
            pass
    if 5 <= raw_val <= 300:
        return raw_val
    return 45


# ---------------- Curve Storage & Interpolation ----------------

class CurveStore:
    def __init__(self, filepath: str = CURVES_FILE):
        self.filepath = filepath
        self._curves: List[Dict[str, Any]] = []
        self.load()

    def load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r") as f:
                    self._curves = json.load(f)
                return
            except Exception as e:
                logger.error(f"Failed to load curves file {self.filepath}: {e}")
        self._curves = self._default_presets()
        self.save()

    def save(self):
        try:
            with open(self.filepath, "w") as f:
                json.dump(self._curves, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save curves file: {e}")

    def list_all(self) -> List[Dict[str, Any]]:
        return self._curves

    def get(self, curve_id: str) -> Optional[Dict[str, Any]]:
        for c in self._curves:
            if c.get("id") == curve_id:
                return c
        return None

    def upsert(self, curve_data: Dict[str, Any]) -> Dict[str, Any]:
        cid = curve_data.get("id")
        if not cid:
            cid = f"custom-{uuid.uuid4().hex[:8]}"
            curve_data["id"] = cid

        keyframes = sorted(
            curve_data.get("keyframes", []),
            key=lambda k: float(k.get("time_s", 0)),
        )
        if not keyframes:
            keyframes = [{"time_s": 0, "temp_f": 450}, {"time_s": 50, "temp_f": 485}]

        duration_s = int(curve_data.get("duration_s", keyframes[-1]["time_s"]))
        if duration_s <= 0:
            duration_s = int(keyframes[-1]["time_s"]) or 50

        sanitized = {
            "id": cid,
            "name": str(curve_data.get("name", "Custom Curve")),
            "description": str(curve_data.get("description", "")),
            "duration_s": duration_s,
            "keyframes": keyframes,
        }

        for idx, existing in enumerate(self._curves):
            if existing.get("id") == cid:
                self._curves[idx] = sanitized
                self.save()
                return sanitized

        self._curves.append(sanitized)
        self.save()
        return sanitized

    def delete(self, curve_id: str) -> bool:
        initial_len = len(self._curves)
        self._curves = [c for c in self._curves if c.get("id") != curve_id]
        if len(self._curves) != initial_len:
            self.save()
            return True
        return False

    def _default_presets(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": "preset-step-3",
                "name": "Step 430 → 485 → 520",
                "description": "3-stage progression: initial low-temp terpene boil, steady extraction, high-temp cloud finish.",
                "duration_s": 50,
                "keyframes": [
                    {"time_s": 0, "temp_f": 430},
                    {"time_s": 15, "temp_f": 430},
                    {"time_s": 18, "temp_f": 485},
                    {"time_s": 35, "temp_f": 485},
                    {"time_s": 38, "temp_f": 520},
                    {"time_s": 50, "temp_f": 520},
                ],
            },
            {
                "id": "preset-thermal-decay",
                "name": "Decay 535 → 465",
                "description": "Traditional quartz banger emulation: hot start for thick vapor, descending as concentrate thins.",
                "duration_s": 50,
                "keyframes": [
                    {"time_s": 0, "temp_f": 535},
                    {"time_s": 12, "temp_f": 535},
                    {"time_s": 30, "temp_f": 495},
                    {"time_s": 50, "temp_f": 465},
                ],
            },
            {
                "id": "preset-linear-ramp",
                "name": "Linear 420 → 510",
                "description": "Continuous smooth thermal ramp (+1.5°F/s) across a 60s session.",
                "duration_s": 60,
                "keyframes": [
                    {"time_s": 0, "temp_f": 420},
                    {"time_s": 60, "temp_f": 510},
                ],
            },
            {
                "id": "preset-low-dwell",
                "name": "Dwell 450",
                "description": "Extended low-temp plateau for solventless / live rosin with minimal thermal stress.",
                "duration_s": 60,
                "keyframes": [
                    {"time_s": 0, "temp_f": 445},
                    {"time_s": 20, "temp_f": 445},
                    {"time_s": 25, "temp_f": 460},
                    {"time_s": 60, "temp_f": 460},
                ],
            },
            {
                "id": "preset-boost-finish",
                "name": "Peak Boost 480 → 535",
                "description": "Steady 480°F extraction with an aggressive 535°F boost for the final 15 seconds.",
                "duration_s": 55,
                "keyframes": [
                    {"time_s": 0, "temp_f": 480},
                    {"time_s": 38, "temp_f": 480},
                    {"time_s": 42, "temp_f": 535},
                    {"time_s": 55, "temp_f": 535},
                ],
            },
        ]


curve_store = CurveStore()


def interpolate_curve_target(keyframes: List[Dict[str, Any]], elapsed_s: float) -> float:
    if not keyframes:
        return 485.0
    if elapsed_s <= keyframes[0]["time_s"]:
        return float(keyframes[0]["temp_f"])
    if elapsed_s >= keyframes[-1]["time_s"]:
        return float(keyframes[-1]["temp_f"])

    for i in range(len(keyframes) - 1):
        k1 = keyframes[i]
        k2 = keyframes[i + 1]
        t1, temp1 = float(k1["time_s"]), float(k1["temp_f"])
        t2, temp2 = float(k2["time_s"]), float(k2["temp_f"])
        if t1 <= elapsed_s <= t2:
            if t2 == t1:
                return temp2
            ratio = (elapsed_s - t1) / (t2 - t1)
            return temp1 + ratio * (temp2 - temp1)
    return float(keyframes[-1]["temp_f"])


# ---------------- Device & Session Manager ----------------

class PuffcoDeviceManager:
    def __init__(self):
        self.client: Optional[PuffcoClient] = None
        self.target_address: Optional[str] = None
        self.websockets: Set[web.WebSocketResponse] = set()
        self.is_demo: bool = False
        self._demo_task: Optional[asyncio.Task] = None
        self._curve_task: Optional[asyncio.Task] = None
        self._active_curve: Optional[Dict[str, Any]] = None
        self._backup_profile_data: Optional[Dict[str, Any]] = None
        self._lock = asyncio.Lock()

        # Cache last serialized telemetry
        self._last_telemetry_dict: Dict[str, Any] = self._default_telemetry()

    def _default_telemetry(self) -> Dict[str, Any]:
        return {
            "connected": False,
            "device_name": "Puff Device",
            "mac_address": "",
            "serial_number": "",
            "firmware_version": "",
            "operating_state": "DISCONNECTED",
            "state_name": "Disconnected",
            "live_temp_f": 0.0,
            "target_temp_f": 485.0,
            "time_remaining": 0,
            "total_time": 45,
            "battery_pct": 0,
            "is_charging": False,
            "is_heating": False,
            "chamber_type": "STANDARD",
            "chamber_name": "Standard",
            "lifetime_dabs": 0,
            "stealth_mode": False,
            "lantern_active": False,
            "active_profile": 0,
            "profiles": [
                {"slot": 0, "name": "Low", "target_temp_f": 480, "duration_s": 50},
                {"slot": 1, "name": "Medium", "target_temp_f": 485, "duration_s": 60},
                {"slot": 2, "name": "High", "target_temp_f": 530, "duration_s": 40},
                {"slot": 3, "name": "ROSIN", "target_temp_f": 465, "duration_s": 90},
            ],
            "is_demo": self.is_demo,
            "active_curve_running": False,
        }

    def serialize_telemetry(self, t: Any) -> Dict[str, Any]:
        profiles_data = []
        if hasattr(t, "profiles") and t.profiles:
            for p in t.profiles:
                dur = parse_duration_seconds(getattr(p, "duration_s", 45))
                profiles_data.append({
                    "slot": getattr(p, "slot", 0),
                    "name": getattr(p, "name", f"Profile {getattr(p, 'slot', 0) + 1}"),
                    "target_temp_f": getattr(p, "target_temp_f", 485),
                    "duration_s": dur,
                })
        else:
            profiles_data = self._default_telemetry()["profiles"]

        op_state = getattr(t, "operating_state", None)
        state_str = op_state.name if op_state and hasattr(op_state, "name") else "IDLE"

        chamber_type = getattr(t, "chamber_type", None)
        chamber_str = chamber_type.name if chamber_type and hasattr(chamber_type, "name") else "STANDARD"

        # Accurately report heating status inclusive of READY state
        raw_heating = bool(getattr(t, "is_heating", False))
        is_heating = raw_heating or (state_str in ("HEAT_PREHEAT", "HEAT_ACTIVE", "READY"))

        return {
            "connected": bool(getattr(t, "connected", False)),
            "device_name": str(getattr(t, "device_name", "Puff Device")),
            "mac_address": str(getattr(t, "mac_address", "")),
            "serial_number": str(getattr(t, "serial_number", "")),
            "firmware_version": str(getattr(t, "firmware_version", "")),
            "operating_state": state_str,
            "state_name": str(getattr(t, "state_name", state_str.title().replace("_", " "))),
            "live_temp_f": round(float(getattr(t, "live_temp_f", 0.0)), 1),
            "target_temp_f": round(float(getattr(t, "target_temp_f", 485.0)), 1),
            "time_remaining": int(getattr(t, "time_remaining", 0)),
            "total_time": int(getattr(t, "total_time", 45)),
            "battery_pct": int(getattr(t, "battery_pct", 0)),
            "is_charging": bool(getattr(t, "is_charging", False)),
            "is_heating": is_heating,
            "chamber_type": chamber_str,
            "chamber_name": str(getattr(t, "chamber_name", "3DXL")),
            "lifetime_dabs": int(getattr(t, "lifetime_dabs", 0)),
            "stealth_mode": bool(getattr(t, "stealth_mode", False)),
            "lantern_active": bool(getattr(self, "_lantern_active", False)),
            "active_profile": int(getattr(t, "active_profile", 0)),
            "profiles": profiles_data,
            "is_demo": self.is_demo,
            "active_curve_running": bool(self._curve_task and not self._curve_task.done()),
        }

    async def broadcast(self, message: Dict[str, Any]):
        if not self.websockets:
            return
        dead = set()
        text = json.dumps(message)
        for ws in self.websockets:
            try:
                if ws.closed:
                    dead.add(ws)
                else:
                    await ws.send_str(text)
            except Exception:
                dead.add(ws)
        if dead:
            self.websockets -= dead

    def _on_telemetry_update(self, telemetry: Any):
        data = self.serialize_telemetry(telemetry)
        self._last_telemetry_dict = data
        asyncio.create_task(self.broadcast({"type": "telemetry", "data": data}))

    async def scan(self, timeout: float = 4.0) -> List[Dict[str, Any]]:
        logger.info(f"Scanning for Puffco devices (timeout={timeout}s)...")
        try:
            discovered = await scan_puffco_devices(timeout=timeout)
            results = []
            for d in discovered:
                results.append({
                    "name": d.name or "Puff Device",
                    "address": d.address,
                    "rssi": d.rssi,
                    "is_lorax": getattr(d, "is_lorax", False),
                })
            logger.info(f"Scan complete. Found {len(results)} Puffco devices.")
            return results
        except Exception as e:
            logger.error(f"Scan failed: {e}")
            return []

    async def connect(self, address: Optional[str] = None, timeout: float = 12.0) -> bool:
        async with self._lock:
            if self.is_demo:
                await self.stop_demo()

            if self.client:
                try:
                    await self.client.disconnect()
                except Exception:
                    pass
                self.client = None

            self.target_address = address
            logger.info(f"Connecting to Puffco address: {address or 'auto-select'}...")

            try:
                client = PuffcoClient(target_address=address, auto_reconnect=True)
                connected = await client.connect(timeout=timeout)
                if not connected:
                    logger.warning("Failed to connect to Puffco device.")
                    return False

                self.client = client
                self.target_address = client.target_address

                client.add_telemetry_listener(self._on_telemetry_update)
                await client.start_telemetry_stream(
                    interval_heating=0.06,
                    interval_idle=0.25,
                    slow_poll_interval=4.0,
                )

                self._last_telemetry_dict = self.serialize_telemetry(client.telemetry)
                await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
                await self.broadcast({
                    "type": "event",
                    "event": "connected",
                    "message": f"Connected to {client.telemetry.device_name}",
                })
                logger.info(f"Successfully streaming telemetry for {client.telemetry.device_name}")
                return True
            except Exception as e:
                logger.error(f"Error during Puffco connection: {e}", exc_info=True)
                self._last_telemetry_dict["connected"] = False
                self._last_telemetry_dict["operating_state"] = "DISCONNECTED"
                await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
                return False

    async def disconnect(self):
        async with self._lock:
            await self.stop_curve()

            if self.client:
                try:
                    await self.client.disconnect()
                except Exception as e:
                    logger.warning(f"Error disconnecting client: {e}")
                self.client = None

            if self.is_demo:
                await self.stop_demo()

            self._last_telemetry_dict["connected"] = False
            self._last_telemetry_dict["operating_state"] = "DISCONNECTED"
            self._last_telemetry_dict["state_name"] = "Disconnected"
            await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
            await self.broadcast({
                "type": "event",
                "event": "disconnected",
                "message": "Device disconnected",
            })
            logger.info("Device disconnected.")

    # ---------------- Robust Temperature & Profile Writing ----------------

    async def write_temperature_robust(self, temp_f: float, slot: Optional[int] = None) -> bool:
        """
        Robustly writes target temperature over BLE:
        1. Writes float32 Celsius to profile path (/u/app/hc/{slot}/temp)
        2. Re-asserts active profile slot (/p/app/hcs) to force firmware PID reload
        """
        if self.is_demo:
            self._last_telemetry_dict["target_temp_f"] = float(temp_f)
            await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
            return True

        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")

        if slot is None:
            slot = self.client.telemetry.active_profile

        # Strict numeric sanitization & hard clamp [350°F, 590°F]
        try:
            val = float(temp_f)
            if math.isnan(val) or math.isinf(val):
                raise ValueError("Temperature must be a finite number")
            temp_f = min(590.0, max(350.0, round(val, 1)))
        except (TypeError, ValueError) as e:
            logger.error(f"Invalid temperature setpoint rejected: {temp_f} ({e})")
            return False

        c = f_to_c(temp_f)
        path = PATH_PROFILE_TEMP_PREFIX.format(slot=slot)
        is_proxy = "proxy" in (self.client.telemetry.device_name or "").lower() or getattr(self.client.telemetry, "chamber_type", None) == ChamberType.STANDARD
        payload = struct.pack("<i", int(round(c * 10.0))) if is_proxy else struct.pack("<f", c)

        success = False
        for attempt in range(2):
            try:
                success = await self.client.write_path(path, payload)
                if success:
                    # Re-assert active profile to update live PID register
                    await self.client.write_path(PATH_ACTIVE_PROFILE, bytes([slot]))
                    break
            except Exception as e:
                logger.warning(f"Error on set_temperature attempt {attempt+1}: {e}")
                await asyncio.sleep(0.05)

        if success:
            logger.info(f"Target temp successfully set to {temp_f}°F ({c:.1f}°C) on slot {slot}")
            self.client.telemetry.target_temp_f = float(temp_f)
            self._last_telemetry_dict = self.serialize_telemetry(self.client.telemetry)
            await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
        else:
            logger.error(f"Failed to write temperature {temp_f}°F to slot {slot}")
        return success

    async def set_temperature(self, temp_f: float) -> bool:
        return await self.write_temperature_robust(temp_f)

    # ---------------- Standard Hardware Controls ----------------

    async def start_session(self) -> bool:
        if self.is_demo:
            return await self._demo_start_session()
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")

        # Hardware safety interlocks
        live_temp = float(self._last_telemetry_dict.get("live_temp_f", 0.0))
        if live_temp >= 600.0:
            raise RuntimeError("Cannot start session: Chamber temperature is at or above 600°F safety limit")
        op_state = self._last_telemetry_dict.get("operating_state", "")
        if op_state in ("COOLDOWN", "ERROR", "OFF", "BOOTING", "SHUTDOWN"):
            raise RuntimeError(f"Cannot start session: Device is in {op_state} state")
        battery_soc = self._last_telemetry_dict.get("battery_pct")
        if battery_soc is not None and battery_soc < 12:
            raise RuntimeError(f"Cannot start session: Battery critically low ({battery_soc}%)")

        logger.info("Triggering heat session with safety interlocks passed...")
        return await self.client.start_session()

    async def stop_session(self) -> bool:
        await self.stop_curve()
        if self.is_demo:
            return await self._demo_stop_session()
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")
        logger.info("Aborting session with redundant stop burst...")
        res = False
        for _ in range(3):
            try:
                res = await self.client.stop_session()
                await asyncio.sleep(0.04)
            except Exception:
                pass
        return res

    async def boost(self) -> bool:
        if self.is_demo:
            return await self._demo_boost()
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")
        logger.info("Sending session boost...")
        return await self.client.boost()

    async def set_profile(self, slot: int) -> bool:
        if self.is_demo:
            return await self._demo_set_profile(slot)
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")
        logger.info(f"Selecting profile slot {slot}...")
        res = await self.client.set_profile(slot)
        if res:
            self._last_telemetry_dict = self.serialize_telemetry(self.client.telemetry)
            await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
        return res

    async def set_stealth_mode(self, enabled: bool) -> bool:
        if self.is_demo:
            self._last_telemetry_dict["stealth_mode"] = enabled
            await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
            return True
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")
        return await self.client.set_stealth_mode(enabled)

    async def set_lantern(self, enabled: bool) -> bool:
        self._lantern_active = enabled
        if self.is_demo:
            self._last_telemetry_dict["lantern_active"] = enabled
            await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
            return True
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")
        if enabled:
            return await self.client.start_lantern()
        else:
            return await self.client.stop_lantern()

    async def enter_sleep(self) -> bool:
        if self.is_demo:
            self._last_telemetry_dict["operating_state"] = "SLEEP"
            self._last_telemetry_dict["state_name"] = "Sleep"
            await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
            return True
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")
        return await self.client.enter_sleep_mode()

    async def power_off(self) -> bool:
        if self.is_demo:
            await self.stop_demo()
            return True
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Device not connected")
        return await self.client.power_off()

    # ---------------- Robust Custom Heat Curve Governor ----------------

    async def run_curve(self, curve_data: Dict[str, Any]) -> bool:
        """
        Executes a custom heat curve with preheat wait and robust temperature updates.
        """
        if not self.is_demo and (not self.client or not self.client.is_connected):
            raise RuntimeError("Device must be connected to run a custom heat curve")

        await self.stop_curve()
        self._active_curve = curve_data

        keyframes = sorted(curve_data.get("keyframes", []), key=lambda k: float(k["time_s"]))
        if not keyframes:
            raise ValueError("Curve has no keyframes")

        duration = float(curve_data.get("duration_s", keyframes[-1]["time_s"]))
        initial_temp = float(keyframes[0]["temp_f"])

        # Determine target slot
        slot = self._last_telemetry_dict.get("active_profile", 0)

        # 1. Snapshot original profile in hardware so we can restore it when done
        if not self.is_demo and self.client and self.client.is_connected:
            try:
                prof_temp_b = await self.client.read_path(PATH_PROFILE_TEMP_PREFIX.format(slot=slot))
                prof_time_b = await self.client.read_path(PATH_PROFILE_TIME_PREFIX.format(slot=slot))
                self._backup_profile_data = {
                    "slot": slot,
                    "temp_bytes": prof_temp_b,
                    "time_bytes": prof_time_b,
                }
                logger.info(f"Backed up original profile settings on slot {slot}")
            except Exception as e:
                logger.warning(f"Failed to backup profile settings: {e}")

            # 2. Set initial temperature and full curve duration directly in hardware flash
            await self.write_temperature_robust(initial_temp, slot)
            is_proxy = "proxy" in (self.client.telemetry.device_name or "").lower() or getattr(self.client.telemetry, "chamber_type", None) == ChamberType.STANDARD
            time_payload = struct.pack("<I", int(round(duration * 100))) if is_proxy else struct.pack("<f", float(duration))
            await self.client.write_path(PATH_PROFILE_TIME_PREFIX.format(slot=slot), time_payload)
            logger.info(f"Configured slot {slot} for curve: {initial_temp}°F, duration {duration}s")
        else:
            self._last_telemetry_dict["target_temp_f"] = initial_temp
            self._last_telemetry_dict["total_time"] = int(duration)

        # 3. Start heating session
        if not self.is_demo:
            await self.client.start_session()
        else:
            await self._demo_start_session()

        # 4. Launch background execution task
        self._curve_task = asyncio.create_task(self._curve_execution_loop(curve_data, keyframes, duration, initial_temp, slot))
        return True

    async def stop_curve(self):
        if self._curve_task and not self._curve_task.done():
            self._curve_task.cancel()
            self._curve_task = None
            logger.info("Custom heat curve execution stopped.")
            await self._restore_backup_profile()
            await self.broadcast({
                "type": "curve_telemetry",
                "data": {"is_active": False, "status": "stopped"},
            })

    async def _restore_backup_profile(self):
        """Restores original user profile in flash."""
        if not self.is_demo and self.client and self.client.is_connected and self._backup_profile_data:
            try:
                slot = self._backup_profile_data["slot"]
                tb = self._backup_profile_data.get("temp_bytes")
                timeb = self._backup_profile_data.get("time_bytes")
                if tb:
                    await self.client.write_path(PATH_PROFILE_TEMP_PREFIX.format(slot=slot), tb)
                if timeb:
                    await self.client.write_path(PATH_PROFILE_TIME_PREFIX.format(slot=slot), timeb)
                await self.client.write_path(PATH_ACTIVE_PROFILE, bytes([slot]))
                logger.info(f"Restored original profile settings on slot {slot}")
            except Exception as e:
                logger.warning(f"Error restoring profile: {e}")
            finally:
                self._backup_profile_data = None

    async def _curve_execution_loop(
        self,
        curve: Dict[str, Any],
        keyframes: List[Dict[str, Any]],
        duration_s: float,
        initial_temp: float,
        slot: int,
    ):
        cid = curve.get("id", "custom")
        cname = curve.get("name", "Custom Curve")
        logger.info(f"Curve loop initialized for '{cname}'. Entering PREHEAT wait phase...")

        try:
            # ---------------- PHASE 1: PREHEAT WAIT ----------------
            preheat_start = time.monotonic()
            while True:
                await asyncio.sleep(0.3)
                live_temp = float(self._last_telemetry_dict.get("live_temp_f", 0.0))
                op_state = self._last_telemetry_dict.get("operating_state", "")

                # Emergency thermal cutoff (> 600°F)
                if live_temp >= 600.0:
                    logger.error(f"[EMERGENCY SAFETY CUTOFF] Live temp {live_temp:.1f}°F exceeded 600°F! Aborting!")
                    await self.stop_session()
                    await self._restore_backup_profile()
                    await self.broadcast({
                        "type": "curve_telemetry",
                        "data": {"is_active": False, "status": "emergency_cutoff", "live_temp_f": live_temp},
                    })
                    return

                # If user aborted or device turned off
                if op_state in ("IDLE", "DISCONNECTED", "COOLDOWN", "OFF") and (time.monotonic() - preheat_start > 3.0):
                    logger.info("Session aborted during preheat.")
                    await self.broadcast({
                        "type": "curve_telemetry",
                        "data": {"is_active": False, "status": "aborted", "phase": "preheating"},
                    })
                    return

                # Broadcast preheat status to frontend
                await self.broadcast({
                    "type": "curve_telemetry",
                    "data": {
                        "curve_id": cid,
                        "curve_name": cname,
                        "phase": "preheating",
                        "elapsed_s": 0.0,
                        "duration_s": round(duration_s, 1),
                        "target_temp_f": initial_temp,
                        "live_temp_f": live_temp,
                        "progress_pct": 0.0,
                        "is_active": True,
                        "status": "preheating",
                    },
                })

                # Check if device reached initial target temperature:
                # 1. State transitions to READY or HEAT_ACTIVE
                # 2. Or actual bowl temp is within 8°F of initial target
                elapsed_preheat = time.monotonic() - preheat_start
                is_ready = (op_state in ("READY", "HEAT_ACTIVE") and elapsed_preheat > 2.0) or (live_temp >= (initial_temp - 8.0) and elapsed_preheat > 1.5)
                if is_ready:
                    logger.info(f"Chamber reached initial temperature ({live_temp:.1f}°F >= {initial_temp - 8.0}°F, state={op_state})! STARTING CURVE TIMELINE.")
                    break

                # Safety timeout (65 seconds max preheat)
                if time.monotonic() - preheat_start > 65.0:
                    logger.warning("Preheat phase timed out after 65s; advancing to curve timeline.")
                    break

            # ---------------- PHASE 2: ACTIVE CURVE GOVERNOR ----------------
            start_time = time.monotonic()
            last_sent_temp = initial_temp
            logger.info(f"Active curve execution started at t=0.0s for {duration_s}s...")

            while True:
                elapsed = time.monotonic() - start_time
                if elapsed >= duration_s:
                    logger.info(f"Curve '{cname}' completed after {elapsed:.1f}s.")
                    await self.broadcast({
                        "type": "curve_telemetry",
                        "data": {
                            "curve_id": cid,
                            "curve_name": cname,
                            "phase": "completed",
                            "elapsed_s": round(duration_s, 1),
                            "duration_s": round(duration_s, 1),
                            "target_temp_f": last_sent_temp,
                            "live_temp_f": self._last_telemetry_dict.get("live_temp_f", 0.0),
                            "progress_pct": 100.0,
                            "is_active": False,
                            "status": "completed",
                        },
                    })
                    await self.stop_session()
                    await self._restore_backup_profile()
                    break

                # Check if device stopped heating externally
                op_state = self._last_telemetry_dict.get("operating_state", "")
                is_heating = self._last_telemetry_dict.get("is_heating", False) or op_state in ("HEAT_ACTIVE", "READY")
                if not is_heating and elapsed > 2.0:
                    logger.info("Heat session ended externally; stopping curve governor.")
                    await self.broadcast({
                        "type": "curve_telemetry",
                        "data": {"is_active": False, "status": "ended_early"},
                    })
                    await self._restore_backup_profile()
                    break

                live_temp = float(self._last_telemetry_dict.get("live_temp_f", 0.0))
                # Emergency thermal cutoff (> 600°F)
                if live_temp >= 600.0:
                    logger.error(f"[EMERGENCY SAFETY CUTOFF] Live temp {live_temp:.1f}°F exceeded 600°F! Aborting!")
                    await self.stop_session()
                    await self._restore_backup_profile()
                    await self.broadcast({
                        "type": "curve_telemetry",
                        "data": {"is_active": False, "status": "emergency_cutoff", "live_temp_f": live_temp},
                    })
                    return

                # Compute interpolated target temperature for current timestamp
                current_target = min(590.0, max(350.0, round(interpolate_curve_target(keyframes, elapsed), 1)))

                # Send robust setpoint update if target changed by >= 1.0°F
                if abs(current_target - last_sent_temp) >= 1.0:
                    await self.write_temperature_robust(current_target, slot)
                    last_sent_temp = current_target

                # Broadcast curve telemetry packet to browser
                live_temp = float(self._last_telemetry_dict.get("live_temp_f", 0.0))
                pct = round(min(100.0, (elapsed / duration_s) * 100.0), 1)
                await self.broadcast({
                    "type": "curve_telemetry",
                    "data": {
                        "curve_id": cid,
                        "curve_name": cname,
                        "phase": "running",
                        "elapsed_s": round(elapsed, 1),
                        "duration_s": round(duration_s, 1),
                        "target_temp_f": current_target,
                        "live_temp_f": live_temp,
                        "progress_pct": pct,
                        "is_active": True,
                        "status": "running",
                    },
                })

                await asyncio.sleep(0.5)  # 2 Hz curve modulation rate

        except asyncio.CancelledError:
            await self._restore_backup_profile()
        except Exception as e:
            logger.error(f"Error in curve governor loop: {e}", exc_info=True)
            await self._restore_backup_profile()

    # ---------------- Demo Simulation Engine ----------------

    async def start_demo(self):
        if self.client and self.client.is_connected:
            await self.disconnect()
        self.is_demo = True
        self._last_telemetry_dict = {
            "connected": True,
            "device_name": "SAMS PEAK (Demo)",
            "mac_address": "DEMO-F711-95C5-149B",
            "serial_number": "PK2026-DEMO",
            "firmware_version": "V1.3.8",
            "operating_state": "IDLE",
            "state_name": "Idle",
            "live_temp_f": 78.5,
            "target_temp_f": 485.0,
            "time_remaining": 0,
            "total_time": 50,
            "battery_pct": 82,
            "is_charging": False,
            "is_heating": False,
            "chamber_type": "CHAMBER_3DXL",
            "chamber_name": "3DXL",
            "lifetime_dabs": 443,
            "stealth_mode": False,
            "lantern_active": False,
            "active_profile": 1,
            "profiles": [
                {"slot": 0, "name": "Low", "target_temp_f": 480, "duration_s": 50},
                {"slot": 1, "name": "Medium", "target_temp_f": 485, "duration_s": 60},
                {"slot": 2, "name": "High", "target_temp_f": 530, "duration_s": 40},
                {"slot": 3, "name": "ROSIN", "target_temp_f": 465, "duration_s": 90},
            ],
            "is_demo": True,
            "active_curve_running": False,
        }
        if self._demo_task and not self._demo_task.done():
            self._demo_task.cancel()
        self._demo_task = asyncio.create_task(self._demo_loop())
        await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})
        await self.broadcast({"type": "event", "event": "demo_started", "message": "Demo mode activated"})

    async def stop_demo(self):
        self.is_demo = False
        await self.stop_curve()
        if self._demo_task and not self._demo_task.done():
            self._demo_task.cancel()
            self._demo_task = None
        self._last_telemetry_dict["connected"] = False
        self._last_telemetry_dict["operating_state"] = "DISCONNECTED"
        self._last_telemetry_dict["state_name"] = "Disconnected"
        self._last_telemetry_dict["is_demo"] = False
        await self.broadcast({"type": "telemetry", "data": self._last_telemetry_dict})

    async def _demo_loop(self):
        try:
            while self.is_demo:
                await asyncio.sleep(0.2)
                t = self._last_telemetry_dict
                state = t["operating_state"]
                target = t["target_temp_f"]

                if state == "HEAT_PREHEAT":
                    t["is_heating"] = True
                    diff = target - t["live_temp_f"]
                    step = max(5.0, diff * 0.18)
                    t["live_temp_f"] = round(min(target, t["live_temp_f"] + step), 1)
                    if t["live_temp_f"] >= target - 2.0:
                        t["operating_state"] = "READY"
                        t["state_name"] = "Ready"
                        t["time_remaining"] = t["total_time"]
                elif state in ("READY", "HEAT_ACTIVE"):
                    t["is_heating"] = True
                    diff = target - t["live_temp_f"]
                    t["live_temp_f"] = round(t["live_temp_f"] + diff * 0.20, 1)
                    if not (self._curve_task and not self._curve_task.done()):
                        t["time_remaining"] = max(0, t["time_remaining"] - 1)
                        if t["time_remaining"] <= 0:
                            t["operating_state"] = "COOLDOWN"
                            t["state_name"] = "Cooldown"
                            t["lifetime_dabs"] += 1
                            t["is_heating"] = False
                elif state == "COOLDOWN":
                    t["is_heating"] = False
                    if t["live_temp_f"] > 78.5:
                        t["live_temp_f"] = round(max(78.5, t["live_temp_f"] - 4.5), 1)
                    else:
                        t["operating_state"] = "IDLE"
                        t["state_name"] = "Idle"
                elif state == "IDLE":
                    t["is_heating"] = False
                    if t["live_temp_f"] > 78.5:
                        t["live_temp_f"] = round(max(78.5, t["live_temp_f"] - 1.5), 1)

                await self.broadcast({"type": "telemetry", "data": t})
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Demo loop error: {e}")

    async def _demo_start_session(self) -> bool:
        t = self._last_telemetry_dict
        t["operating_state"] = "HEAT_PREHEAT"
        t["state_name"] = "Preheating"
        t["is_heating"] = True
        slot = t["active_profile"]
        if 0 <= slot < len(t["profiles"]):
            prof = t["profiles"][slot]
            t["total_time"] = prof["duration_s"]
            t["time_remaining"] = prof["duration_s"]
        await self.broadcast({"type": "telemetry", "data": t})
        return True

    async def _demo_stop_session(self) -> bool:
        t = self._last_telemetry_dict
        t["operating_state"] = "IDLE"
        t["state_name"] = "Idle"
        t["is_heating"] = False
        t["time_remaining"] = 0
        await self.broadcast({"type": "telemetry", "data": t})
        return True

    async def _demo_boost(self) -> bool:
        t = self._last_telemetry_dict
        t["target_temp_f"] = round(t["target_temp_f"] + 10.0, 1)
        t["time_remaining"] += 15
        t["total_time"] += 15
        await self.broadcast({"type": "telemetry", "data": t})
        return True

    async def _demo_set_profile(self, slot: int) -> bool:
        t = self._last_telemetry_dict
        if 0 <= slot < len(t["profiles"]):
            t["active_profile"] = slot
            prof = t["profiles"][slot]
            t["target_temp_f"] = prof["target_temp_f"]
            t["total_time"] = prof["duration_s"]
            await self.broadcast({"type": "telemetry", "data": t})
            return True
        return False


# Global device manager instance
manager = PuffcoDeviceManager()


# ---------------- API Handlers ----------------

async def handle_status(request: web.Request) -> web.Response:
    return web.json_response(manager._last_telemetry_dict)


async def handle_scan(request: web.Request) -> web.Response:
    timeout = float(request.query.get("timeout", 4.0))
    devices = await manager.scan(timeout=timeout)
    return web.json_response({"status": "ok", "devices": devices})


async def handle_connect(request: web.Request) -> web.Response:
    data = {}
    if request.can_read_body:
        try:
            data = await request.json()
        except Exception:
            pass
    address = data.get("address")
    success = await manager.connect(address=address)
    if success:
        return web.json_response({"status": "ok", "message": "Connected", "telemetry": manager._last_telemetry_dict})
    return web.json_response({"status": "error", "message": "Failed to connect to Puff device"}, status=400)


async def handle_disconnect(request: web.Request) -> web.Response:
    await manager.disconnect()
    return web.json_response({"status": "ok", "message": "Disconnected"})


async def handle_session_start(request: web.Request) -> web.Response:
    try:
        success = await manager.start_session()
        return web.json_response({"status": "ok", "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_session_stop(request: web.Request) -> web.Response:
    try:
        success = await manager.stop_session()
        return web.json_response({"status": "ok", "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_session_boost(request: web.Request) -> web.Response:
    try:
        success = await manager.boost()
        return web.json_response({"status": "ok", "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_profile_select(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        slot = int(data.get("slot", 0))
        success = await manager.set_profile(slot)
        return web.json_response({"status": "ok", "slot": slot, "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_temperature(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        temp_f = float(data.get("temp_f", 485.0))
        success = await manager.set_temperature(temp_f)
        return web.json_response({"status": "ok", "target_temp_f": temp_f, "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_stealth(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        enabled = bool(data.get("enabled", False))
        success = await manager.set_stealth_mode(enabled)
        return web.json_response({"status": "ok", "stealth_mode": enabled, "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_lantern(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        enabled = bool(data.get("enabled", False))
        success = await manager.set_lantern(enabled)
        return web.json_response({"status": "ok", "lantern": enabled, "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_sleep(request: web.Request) -> web.Response:
    try:
        success = await manager.enter_sleep()
        return web.json_response({"status": "ok", "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_power_off(request: web.Request) -> web.Response:
    try:
        success = await manager.power_off()
        return web.json_response({"status": "ok", "success": success})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_demo_toggle(request: web.Request) -> web.Response:
    data = await request.json()
    enabled = bool(data.get("enabled", not manager.is_demo))
    if enabled:
        await manager.start_demo()
    else:
        await manager.stop_demo()
    return web.json_response({"status": "ok", "is_demo": manager.is_demo})


# ---------------- Curve API Handlers ----------------

async def handle_curves_list(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "curves": curve_store.list_all()})


async def handle_curves_save(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        saved = curve_store.upsert(data)
        return web.json_response({"status": "ok", "curve": saved})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_curves_delete(request: web.Request) -> web.Response:
    cid = request.match_info.get("id")
    if not cid:
        return web.json_response({"status": "error", "message": "Missing curve id"}, status=400)
    success = curve_store.delete(cid)
    return web.json_response({"status": "ok", "deleted": success})


async def handle_curves_run(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        cid = data.get("id")
        curve_data = None
        if cid:
            curve_data = curve_store.get(cid)
        if not curve_data:
            curve_data = data
        if not curve_data or not curve_data.get("keyframes"):
            return web.json_response({"status": "error", "message": "Invalid curve data"}, status=400)

        success = await manager.run_curve(curve_data)
        return web.json_response({"status": "ok", "success": success, "curve": curve_data})
    except Exception as e:
        logger.error(f"Error running curve: {e}")
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_curves_stop(request: web.Request) -> web.Response:
    await manager.stop_curve()
    await manager.stop_session()
    return web.json_response({"status": "ok", "message": "Curve stopped"})


# ---------------- WebSocket Handler ----------------

async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    manager.websockets.add(ws)
    logger.info(f"WebSocket client connected ({len(manager.websockets)} active)")

    try:
        await ws.send_str(json.dumps({"type": "telemetry", "data": manager._last_telemetry_dict}))
    except Exception:
        pass

    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    payload = json.loads(msg.data)
                    action = payload.get("action")
                    if action == "ping":
                        await ws.send_str(json.dumps({"type": "pong", "time": time.time()}))
                    elif action == "refresh":
                        await ws.send_str(json.dumps({"type": "telemetry", "data": manager._last_telemetry_dict}))
                except Exception as e:
                    logger.debug(f"WS message handling error: {e}")
            elif msg.type == aiohttp.WSMsgType.ERROR:
                logger.debug(f"WS error: {ws.exception()}")
    finally:
        manager.websockets.discard(ws)
        logger.info(f"WebSocket client disconnected ({len(manager.websockets)} active)")

    return ws


# ---------------- Server Setup & Lifecycle ----------------

async def on_startup(app: web.Application):
    async def try_autoconnect():
        await asyncio.sleep(1.0)
        logger.info("Checking for nearby Puffco device for auto-connect...")
        devices = await manager.scan(timeout=3.0)
        if devices:
            target = devices[0]["address"]
            name = devices[0]["name"]
            logger.info(f"Auto-connecting to discovered device: {name} ({target})")
            await manager.connect(address=target, timeout=10.0)

    app["autoconnect_task"] = asyncio.create_task(try_autoconnect())


async def on_cleanup(app: web.Application):
    if "autoconnect_task" in app and not app["autoconnect_task"].done():
        app["autoconnect_task"].cancel()
    await manager.disconnect()


def create_app() -> web.Application:
    app = web.Application()

    # REST Routes
    app.router.add_get("/api/status", handle_status)
    app.router.add_get("/api/scan", handle_scan)
    app.router.add_post("/api/connect", handle_connect)
    app.router.add_post("/api/disconnect", handle_disconnect)
    app.router.add_post("/api/session/start", handle_session_start)
    app.router.add_post("/api/session/stop", handle_session_stop)
    app.router.add_post("/api/session/boost", handle_session_boost)
    app.router.add_post("/api/profile/select", handle_profile_select)
    app.router.add_post("/api/temperature", handle_temperature)
    app.router.add_post("/api/stealth", handle_stealth)
    app.router.add_post("/api/lantern", handle_lantern)
    app.router.add_post("/api/power/sleep", handle_sleep)
    app.router.add_post("/api/power/off", handle_power_off)
    app.router.add_post("/api/demo", handle_demo_toggle)

    # Curve Routes
    app.router.add_get("/api/curves", handle_curves_list)
    app.router.add_post("/api/curves", handle_curves_save)
    app.router.add_delete("/api/curves/{id}", handle_curves_delete)
    app.router.add_post("/api/curves/run", handle_curves_run)
    app.router.add_post("/api/curves/stop", handle_curves_stop)

    # WebSocket Route
    app.router.add_get("/ws", handle_ws)

    # Static Files
    static_dir = os.path.join(BASE_DIR, "static")
    os.makedirs(static_dir, exist_ok=True)

    async def index_handler(request):
        return web.FileResponse(os.path.join(static_dir, "index.html"))

    app.router.add_get("/", index_handler)
    app.router.add_static("/static/", path=static_dir, name="static")

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "127.0.0.1")
    logger.info(f"Starting Puff Studio on http://{host}:{port}")
    logger.info(f"Powered by puffco-py v{getattr(puffco_py, '__version__', 'unknown')}")
    app = create_app()
    web.run_app(app, host=host, port=port)
