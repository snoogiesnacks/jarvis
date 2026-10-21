# Picovoice wake word: investigation (CTO Directive 007, priority 3)

Status: investigated, not wired. No code changed for this item.

## Finding

The Picovoice/Porcupine wake-word engine is configured but never connected.

| Piece | State | Evidence |
|---|---|---|
| `@picovoice/porcupine-web` ^4.0.1, `@picovoice/web-voice-processor` ^4.0.10 | Installed as dependencies | `package.json` lines 26-27 |
| `VITE_PICOVOICE_ACCESS_KEY` | Read into `env.porcupineKey` | `src/config.ts:136` |
| `WAKE_ENGINE: 'speech' \| 'porcupine'` | Computed from whether the key is set | `src/config.ts:158` |
| Any import of `@picovoice/*` in `src/` | None | `grep` over `src/` |
| Any read of `WAKE_ENGINE` | None (defined, never referenced) | `grep` over `src/` |
| Actual wake detection | Browser speech recognition plus a `WAKE` regex, 1500 ms debounce | `src/lib/voice.ts` (lines ~485, 662, 710) |

Consequence: setting `VITE_PICOVOICE_ACCESS_KEY` changes a constant nothing reads. "Hey Jarvis" always goes through browser speech recognition. The README and `config.ts` comment describe Porcupine as the recommended offline option, so the docs overstate what ships.

## Why it matters

`voice.ts` documents that the speech-recognition path loses wake words during recogniser restarts and "dies silently under always-on use". An offline engine is the intended fix.

## Proposed wiring (not done)

1. Add `src/lib/wake.ts` exposing `startWake(onWake): () => void`.
2. Porcupine implementation: `PorcupineWorker.create(accessKey, BuiltInKeyword.Jarvis, onWake)` plus `WebVoiceProcessor.subscribe(worker)`; unsubscribe and `worker.terminate()` on stop.
3. Select by `WAKE_ENGINE`; fall back to the existing speech path if Porcupine fails to initialise (bad key, no mic, WASM blocked).
4. Keep the shared 1500 ms debounce and the `dormant -> waking` store transition so both engines behave the same.
5. Both engines need the microphone. Porcupine through `WebVoiceProcessor` and the VAD/segment capture in `voice.ts` must not fight over the stream; this is the main design risk and needs a hands-on test with a real microphone.

## Blockers for implementing now

- Verifying it needs a browser, a microphone, and a Picovoice AccessKey. None exist in the build VM.
- A Picovoice key is an account credential created by the CEO at console.picovoice.ai (the free tier exists; confirm current terms before signing up). Not created or used in this session.
- The Vite build cannot run in the build VM (Windows-only native binaries), so a change could not even be built here.

Interim doc fix worth making: say in `README.md` and the `config.ts` comment that Porcupine is not yet active.
