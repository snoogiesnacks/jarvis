# Tracking probe execution — October 23, 2026

## Delivered

`scripts/xr-tracking-probe.py` is a Windows x64 Python/ctypes probe using only standard-library dependencies. No C++ compiler was found on PATH or in the checked Visual Studio location, so no compiler or package was installed. The script binds 14 SDK information/lifecycle/IMU exports, follows the reviewed demo lifecycle, and never calls camera, display, brightness, volume, firmware or reporting APIs. It has no web server or network client. This is a diagnostic tool, not a JARVIS rendering adapter.

The installed 2.4.1 demo source ZIP and local headers were reviewed directly. DLL SHA256: `60b418f9126169017ce66724aee9d25ddb6ae332047faa657537411b0942df4f`. Downloaded/extracted/installed copies match. The archive's Windows download metadata names the VITURE SDK server as origin; the DLL is unsigned. These checks establish local consistency and recorded provenance, not a cryptographic publisher guarantee. The prior report's unverified-runtime restriction was resolved sufficiently for this approved bounded probe using the existing SDK, not by installing a different binary.

Runtime `GetVersionString()` returns **2.4.1**. Present vendor/product ID: **35CA:1141**. SDK product lookup maps 1141 to **Luma Pro**, device family Gen1. SpaceWalker independently identifies **VITURE Luma Pro XR Glasses**.

## Actual scenarios

| Scenario | Criterion | Result |
|---|---|---|
| Syntax / command help / native-call review | Parse; help exits successfully; no camera/control/firmware exports bound | PASS |
| Probe with VITURE demo open | Initialize and deliver samples or fail explicitly | Live acquisition FAIL: initialize -2, USB unavailable. Clear error, no samples. |
| Close demo | User approves closure; demo process gone | PASS. Normal window close did not exit it; process ended after explicit user authorization. |
| Tracking without demo, 10 seconds | Samples >0, finite values, quaternion norm 0.9–1.1, gaps and final age <500 ms, cleanup codes zero | PASS: 254 samples, 0 invalid, max gap about 47 ms, no cleanup errors. |
| Tracking without demo, 60 seconds | Same criteria for full requested window | PASS: 1,507 samples, 0 invalid, max gap about 47 ms, final age about 15 ms, no cleanup errors. Evidence: xr-probe-baseline.jsonl. |
| SpaceWalker startup | Identifies glasses, connected, selected layout active | PASS for application state: SpaceWalker 2.0.0.187 connected; saved 3 Displays Side by Side / Mirror Displays / 120Hz layout launched. No layout/rate/brightness/volume values edited. |
| First concurrent probe, 10 seconds | Pose delivery and SpaceWalker remains Connected | LIMITED PASS: 251 samples, 0 invalid, max gap about 47 ms, no cleanup errors; Connected afterward. Evidence: xr-probe-spacewalker.jsonl. |
| Repeat concurrent probe, requested 60 seconds | Reinitialize and sustain same criteria | FAIL at initialize: -2 USB unavailable; no pose samples. Evidence: xr-probe-spacewalker-60s.jsonl. SpaceWalker remained Connected. |
| Ten-minute coexistence / human visual checks | Stable displays and correct head response throughout, including after probe cleanup | NOT RUN: repeat initialization already failed. Connected UI is insufficient to establish physical tracking or absence of visual disruption. |
| Disconnect/reconnect / axis mapping | Physical unplug/replug recovery; deliberate yaw/pitch/roll agree with expectations | NOT RUN: requires user participation; do not claim verified. |

The requested stream setting is SDK pose frequency LOW (header says 60Hz), but observed callback delivery is approximately 25 samples/second in these runs. Do not claim measured 60Hz, latency or axis accuracy. Values changed during acquisition but intended user head motion was not controlled. Max callback gap is not end-to-end display latency.

## Compatibility conclusion

Standalone SDK tracking works. **Repeated shared SDK/SpaceWalker access is not reliable in this session.** Demo contention is demonstrated; SpaceWalker contention is consistent with the repeat failure but underlying locking/race behavior is not proven. A successful first concurrent run does not certify coexistence, and clean API return codes do not prove the other app's stream was unaffected.

Do not automatically run this probe alongside SpaceWalker. Probe cleanup closes its IMU stream; shared device semantics may affect another consumer. Use one owner at a time until vendor-supported sharing is confirmed. Leave SpaceWalker as the display/tracking owner for the office workflow; the future JARVIS UI can remain an ordinary window without opening the IMU itself. For a custom head-controlled renderer, use a separate explicit native-tracking mode with SpaceWalker stopped, or a verified official way to obtain tracking from its owner. Do not invent a SpaceWalker tracking API.

## Run later

With the demo and SpaceWalker closed, glasses connected, and the existing SDK path available:

```powershell
python scripts\xr-tracking-probe.py --sdk C:\Users\boogi\Downloads\VITURE_XR_Glasses_SDK_for_Windows_x86_64 --pid 0x1141 --seconds 60
```

The script accepts 1–60 seconds and prints JSON status; exit 0 means only its limited delivery checks passed. SDK failures print a FAIL record and exit 1. Use the main thread rather than SDK callbacks for lifecycle calls. It does not reconnect automatically or expose a persistent pose service. Native-library faults/hangs cannot be contained by Python exception handling; it is intentionally a separate diagnostic process.

## Final state and next work

VITURE demo closed with approval; probe processes exited; SpaceWalker left open and Connected in its saved triple-display mode. No camera enabled, firmware changed, credentials accessed, paid API used or dependency installed. Existing `.claude/launch.json` preserved. No commit/push performed.

Next: user verifies the physical displays/head response after these tests, then confirms stop/restart recovery with one tracking owner at a time. Keep a desktop JARVIS view compatible with SpaceWalker; reserve custom tracking/rendering integration for a separate mode. OpenAI-first work remains the offline provider-contract plan in provider-architecture.md; this probe does not implement it.
