# Local (offline) speech-to-text for JARVIS: evaluation

2026-11-22 · Claude (CTO) · Status: **recommendation, nothing installed yet**

## Why this matters
On the CEO's laptop the bridge reports `stt:false`, so JARVIS uses the browser's built-in `SpeechRecognition`. That has two problems:
- In Chrome and Edge it sends microphone audio to the browser vendor's cloud. Voice input is therefore not offline.
- It bypasses JARVIS's own VAD, so the noise-floor fix in PR #2 never runs.

A local STT behind the bridge's existing `/stt` route fixes both. The frontend already switches to the VAD engine whenever `/health` reports `stt:true`.

## Machine (measured today)
| Item | Value |
| --- | --- |
| CPU | AMD Ryzen 5 7520U (4 cores, 8 threads); CPU inference only, since the GPU driver is too old for Ollama |
| RAM | 7.2 GB total, 1.4 GB free at the time of the check. Ollama 1B models use about 1.3 GB while loaded |
| Disk | 285 GB free |
| Tools | Node 24, Python 3.12, git. No ffmpeg, no cmake (no C++ build toolchain) |

## Candidates
| Option | Runs as | Windows install | Model size (download) | License | Verdict |
| --- | --- | --- | --- | --- | --- |
| **sherpa-onnx-node + Moonshine tiny (en, quantized, 2026-02-27)** | Inside the existing Node bridge; no extra server | npm prebuilt `sherpa-onnx-win-x64` 2.0.3, about 23 MB; no compiler | **28.4 MB** | Apache-2.0 (runtime); MIT (Moonshine upstream; confirm the bundled licence file) | **Recommended** |
| sherpa-onnx-node + Moonshine base (en, quantized) | same | same | 106.1 MB | same | Fallback if tiny is too inaccurate |
| sherpa-onnx-node + Whisper tiny.en | same | same | 112.6 MB | MIT | Comparison baseline |
| whisper.cpp `whisper-server` | Separate process plus HTTP | No official Windows binary found; building needs cmake and a C++ toolchain (absent), or an unofficial .exe (not acceptable) | 75 MB (tiny.en) and up | MIT | Rejected: build or trust problem |
| faster-whisper (Python, CTranslate2) | Separate Python service | Several pip packages | 75 MB and up | MIT | Rejected: second runtime, more RAM, more moving parts |
| Vosk | Node or Python | Prebuilt | 40 MB and up | Apache-2.0 | Rejected: weaker accuracy in noise than Whisper or Moonshine-class models |

Why Moonshine tiny: it is built for short, live commands on CPU, which matches JARVIS's segments. It is the smallest download (28 MB) and fits the RAM headroom. It is English-only, like the current `en-GB` recogniser setting. sherpa-onnx loads it in-process through a prebuilt Node addon, so there is no Python, no compiler and no ffmpeg. sherpa-onnx states that recognition needs no internet access.

## Integration design (about 1 day of work after approval)
1. **Bridge:** new `bridge/stt-local.mjs`. It lazy-loads `sherpa-onnx-node` and the model from `JARVIS_STT_MODEL_DIR` (default `%USERPROFILE%\jarvis-models\moonshine-tiny-en`). `/stt` uses it when `JARVIS_STT=local`, or when no ElevenLabs key is set and the model folder exists. `/health` then reports `stt:true, stt_provider:"local"`. The listener stays loopback-only and makes no network calls.
2. **Client:** before upload, decode the recorded Opus segment in the browser (`OfflineAudioContext`) into 16 kHz mono WAV, so the bridge never needs ffmpeg. This runs only for the local provider; Scribe keeps receiving Opus.
3. **Effect:** the frontend automatically switches to the VAD engine. The PR #2 noise floor, mic settings and push-to-talk forcing all become active, and audio never leaves the laptop.
4. **Coordination:** the main `jarvis` checkout has someone's uncommitted bridge work (`bridge/server.mjs`, new `bridge/providers.mjs`). The STT change touches the same file, so it must be sequenced with that owner to avoid a conflict.

## Acceptance benchmark (no microphone needed for the first pass)
- **Speech:** Windows' built-in SAPI voices render the 10 fixed command phrases to WAV, so no download is needed. "TV" is a second SAPI voice reading other text, mixed in at 0, −6 and −12 dB relative to the command.
- **Measure:** word error rate per condition, latency per segment, peak RAM of the bridge, and model load time. Compare Moonshine tiny against Whisper tiny.en, plus Moonshine base if tiny's WER is poor.
- **Pass:** WER ≤ 15% with no TV and ≤ 30% at −6 dB TV for tiny; median latency ≤ 1.5 s for a 3 s command; bridge RAM increase ≤ 300 MB.
- **Then:** a 10-minute real-room check with the CEO (TV off and on), comparing push-to-talk and hands-free.

## Downloads that need CEO approval
| What | Source | Size |
| --- | --- | --- |
| `sherpa-onnx-node@2.0.3` + `sherpa-onnx-win-x64@2.0.3` | npm registry | about 23 MB unpacked |
| `sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2` | github.com/k2-fsa/sherpa-onnx releases, `asr-models` | 28.4 MB |
| *(benchmark comparison only)* `sherpa-onnx-whisper-tiny.en.tar.bz2` | same | 112.6 MB |

Cost: $0. No account, key or subscription.

## Sources
- sherpa-onnx docs (offline, Node addon vs WASM): https://k2-fsa.github.io/sherpa/onnx/ and https://k2-fsa.github.io/sherpa/onnx/moonshine/javascript.html
- Moonshine (MIT; tiny and base, English): https://github.com/usefulsensors/moonshine and https://huggingface.co/UsefulSensors/moonshine
- whisper.cpp server example (WAV over HTTP): https://sources.debian.org/src/whisper.cpp/1.8.3%2Bdfsg-2/examples/server/README.md
- Package and asset sizes: `npm view sherpa-onnx-node`, `npm view sherpa-onnx-win-x64`, GitHub release `k2-fsa/sherpa-onnx@asr-models` (metadata only)
