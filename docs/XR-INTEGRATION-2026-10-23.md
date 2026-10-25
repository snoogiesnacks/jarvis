# JARVIS office XR continuation — October 23, 2026 (America/New_York)

**Later execution update:** [Tracking probe results](XR-PROBE-RESULTS-2026-10-23.md) supersede the initial NOT RUN entries for SDK runtime, standalone tracking and initial SpaceWalker coexistence. Runtime 2.4.1 and live Gen1 Luma Pro tracking now verified. Standalone 60-second test passed; repeated concurrent SpaceWalker acquisition failed with USB unavailable. Shared tracking is not certified; keep one owner at a time. The sections below preserve the initial documentation-pass findings.

## Conversation incorporated

Source: [XR Glasses Arrive](chatgpt-conversation://6ad8f893-7b04-83e9-8224-2cb2264b05d9), retrieved in this session, plus the user's continuation request.

User reports SDK 2.4.1 installed, demo detects Luma Pro and produces 3DOF tracking, SpaceWalker triple side-by-side displays work, and ChatGPT voice works through the glasses. Desired progression: speak to the assistant and see responses, then head-controlled panels and glasses controls. Camera is optional and needs support verification and explicit authorization. The user authorizes asking Claude to execute work if needed; no new Claude session was necessary for this documentation pass.

These are reported successes, not independently reproduced end-to-end results. ChatGPT voice working does not establish that JARVIS voice or an OpenAI API connection works. Tests cannot establish 100 percent real-world accuracy.

## Verified local state

- Checkout: `C:\Users\boogi\jarvis`, branch `dev/cto-007-jarvis`, HEAD `41e8ef0`.
- Original office project directory appeared empty. Both patch and PowerShell attempts to create a continuation pointer there failed with a file-not-found write error; the report is saved in this repository instead.
- Pre-existing modified `.claude/launch.json` preserved; no credentials or personal config read into this report.
- SDK folder: `C:\Users\boogi\Downloads\VITURE_XR_Glasses_SDK_for_Windows_x86_64`. Contains demo EXE, glasses DLL/import library, support DLLs and headers. `include/viture_version.h` declares 2.4.1. DLL runtime version and downloaded-package authenticity were not independently verified.
- Present Windows devices with vendor ID 35CA report OK. This establishes vendor-device presence, not exact model or live pose delivery.
- Node 24.20.0, npm 11.19.0, Chrome 156.0.8078.47 and Edge 157.0.4341.10 found. Existing dependencies suffice for the checks below.
- `cmake` and `cl` were not found on PATH; this does not prove build tools are absent from the machine. No SpaceWalker-named process was observed during the snapshot; installation and earlier success remain unverified.
- No VITURE adapter found in the repository search. Current `src/lib/brain.ts` selects Claude bridge or direct Anthropic; OpenAI-first remains planned.

## Claude updates incorporated

Latest local commits include the Fish voice check script (41e8ef0), provider/wake-word handoff (90c5892), Fish configuration tests (6d62dda), and cross-platform write launcher/test suite (2aaab62). Attribution here is to the local handoff requested as Claude updates, not an independently checked conversation with Claude.

- [CTO handoff](CTO-007-handoff.md): previous 22 pass / 1 TODO; Fish config extraction; security follow-ups. The earlier Linux build/lint blockers are superseded by this Windows run below.
- [Provider architecture](provider-architecture.md): reuse the permission gate, keep keys server-side, no silent provider fallback, OpenAI default only after acceptance.
- [Wake-word investigation](picovoice-wake-word.md): Porcupine dependencies/config exist but integration is not wired; current speech wake path remains. Do not create another account merely to proceed.

## Official compatibility research

[VITURE official Glasses SDK documentation](https://www.viture.com/en-SG/developer/glasses-sdk/glasses), consulted this session: Windows x86_64 is supported; Luma Pro uses Gen1 3DOF IMU callbacks. Current docs list Luma Pro UVC pass-through camera support, which is not proof the connected unit exposes it. Gen1 orientation uses NWU coordinates; callbacks must precede IMU start. Lifecycle cleanup is stop, shutdown, destroy. Device controls include brightness, volume, display mode and tint. Current browser SDK documentation also describes Chromium/WebHID; availability in the installed 2.4.1 package has not been established. Current website documentation is not a pinned 2.4.1 specification; check local headers for the implementation.

[Official OpenAI WebRTC guidance](https://developers.openai.com/api/docs/guides/voice-webrtc): a future browser voice connection can use WebRTC with short-lived client credentials issued by a backend. Keep permanent API keys off the frontend. This is a proposed separate integration, not access through the working ChatGPT voice session. No paid calls were made.

## Integration plan and essential tools

1. Baseline: retain the working SpaceWalker desktop arrangement. Put JARVIS in a normal Chrome/Edge window when manually testing; first use text and then explicit microphone permission. Do not assume SpaceWalker and another IMU consumer coexist.
2. Tracking adapter: use the existing native SDK with a small Windows C++ helper after confirming compiler availability and reviewing the demo source. Bind any local transport to loopback, restrict origins and authenticate it. Publish only timestamped orientation/status; exclude camera APIs and firmware APIs. Do not load unverified native binaries merely to obtain a version string.
3. Renderer: add an opt-in tracking mode; convert SDK coordinates to the Three.js scene, validate finite normalized quaternions, handle stale samples/disconnection, and provide recenter plus a stable desktop fallback. Implement smoothing with measured latency. Do not apply a second head transform to a SpaceWalker-managed view without a coexistence test.
4. Controls: start with read-only status, then deliberate brightness/volume actions with range checks and restore behavior. Keep display/tint changes behind explicit user actions; no firmware updates.
5. OpenAI-first: implement the existing provider design with offline fake transports first. Reuse the same tool gate; explicitly gate camera separately because the present vision tools are not blocked by the general writes flag. Do not launch the existing bridge as a safety test: it loads configured integrations and listens without an explicit loopback host. Review startup, binding and warm-up behavior first.
6. Voice: baseline current browser speech with push-to-talk and visible listening state; do not assume it is offline. Add optional OpenAI Realtime only after API use, model and spending limit approval. No key creation, extraction, account setup or paid service use is required now.
7. Optional camera: disabled throughout this work. Before any future capture, independently confirm the exact model/device capability, obtain explicit approval, choose the intended camera and show an active indicator plus stop control. Existing laptop vision code is not proof of glasses-camera integration.

No downloads/installations were necessary for this pass. Unity, new drivers, firmware, third-party wrappers and additional voice services are not baseline requirements. Native compiler installation is deferred until the helper route and existing tools are verified.

## Executed scenarios and acceptance results

| Scenario | Pass criterion | Result |
|---|---|---|
| Regression suite: voice config, SSRF, launcher, scripts | Every non-TODO test passes; disclose TODO | PASS with limitation: 22 pass, 0 ordinary fail, 1 failing TODO, 23 total. TODO: empty/missing address input fails open; suite exits 0. Not an all-green security result. |
| Production compile/bundle | `npm run build` exits 0 | PASS. Browser-externalized Node module warnings from Anthropic SDK and large chunk warnings remain; browser runtime not certified. |
| Static lint | `npm run lint` exits 0 | PASS with 2 warnings: unused probeUrl import in bridge/server.mjs and err catch variable in bridge/chrome.mjs. |
| SDK version files | Local version macros equal reported 2.4.1 | PASS for headers only; DLL runtime NOT RUN. |
| VITURE vendor presence | Present 35CA devices report OK | PASS for vendor presence only; model/IMU NOT RUN. |
| Live SDK tracking | Exact model + runtime version logged; yaw/pitch/roll respond correctly and remain finite for 60 seconds | NOT RUN: needs reviewed tracking-only executable; demo may expose controls/camera. |
| Disconnect/reconnect | No crash; stale pose rejected within proposed 500 ms; desktop fallback; explicit reconnection | NOT RUN: adapter not implemented. |
| SpaceWalker coexistence | Triple displays persist; no duplicate head movement or device contention for 10 minutes | USER-REPORTED baseline only; joint SDK test NOT RUN. |
| Glasses voice | Five spoken prompts transcribed correctly, audible replies, stop/cancel and interruption work; denied microphone gives clear status | ChatGPT voice USER-REPORTED; JARVIS test NOT RUN. |
| OpenAI provider + permissions | Offline provider contract tests pass; no call on boot; write/camera gates deny; no silent provider switch | NOT RUN: provider not implemented. Live calls blocked pending spending authorization. |
| Camera | No capture in baseline; future explicitly approved test verifies selected device/indicator/stop | No camera enabled here; end-to-end gate enforcement NOT VERIFIED. |

## Resume checklist

First review the native demo source and inspect compiler discovery without installing. Build a tracking-only probe, confirm runtime SDK version/model and execute the live tracking scenario. Then test SpaceWalker contention and disconnect behavior before choosing native helper versus official WebHID. Implement offline provider contracts and shared permission/camera gates before paid OpenAI validation. Preserve the existing working setup throughout. This report records readiness and blockers; XR integration has not been implemented or certified.
