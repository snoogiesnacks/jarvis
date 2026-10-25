# CTO Directive 007: handoff (JARVIS)

Branch: `dev/cto-007-jarvis`, created from `feat/fish-audio-voice` (recovery path: `git checkout feat/fish-audio-voice`).
Untracked `scripts/test-fish-voice.ps1` was present before the session and was left untouched.
Nothing was merged, pushed, deployed or installed. No paid APIs or credentials were used.

## Delivery status
This file lives in the repo. `C:\J.A.R.V.I.S\02_AI_AGENTS\shared-context` was not reachable from the session (only `C:\Users\boogi\jarvis` was granted). Gemini and Halle have not received this: delivery is unverified. Copy this file there or paste it to them.

## Priority results
1. Tests: `npm test` (`node --test`, no new dependency). 23 tests: SSRF gate (`bridge/net.mjs`), `with-env` launcher, npm-script guard, Fish config. 22 pass, 0 fail, 1 todo.
2. `bridge:writes`: now `node scripts/with-env.mjs JARVIS_ALLOW_WRITES=1 -- node bridge/server.mjs`. Verified on Linux that the bridge reports "writes ENABLED" through the launcher. NOT verified on Windows `cmd.exe` (no Windows shell was available); please run `npm run bridge:writes` once there.
3. Picovoice: see `docs/picovoice-wake-word.md`. Not wired; root cause confirmed.
4. Provider architecture: `docs/provider-architecture.md`. Design only.
5. Fish Audio: config logic extracted to `bridge/fish.mjs` with 6 tests; behaviour unchanged. Review notes below.
6. Lint: blocked. `oxlint` has no native binding for this Linux VM. The two warnings could not be reproduced or identified. `tsc -b --noEmit` printed no errors.
7. Docs: this file plus the two above.

## Fish Audio review notes
- Free model is the default; blank or unknown `FISH_MODEL` falls back to free with a warning. Good.
- `/tts` caps the body at 64 KB but sets no limit on spoken text length, so one request can bill up to that much text. Suggest a lower cap (a few thousand characters).
- On upstream errors the handler returns Fish's response body to the browser. The key is not in it, but it reveals upstream detail; consider returning a generic message.
- The `model` header and request fields are as written in the code; they were not checked against Fish's current API docs or exercised live (would use a paid/keyed API).
- `scripts/test-fish-voice.ps1` and `scripts/set-fish-key.ps1` were not reviewed or run this session.

## Security findings
- Low: `blockedAddress('' | undefined | null)` returns false (fails open). Unreachable from current callers (DNS answers and `isIP()`-validated literals). Recorded as a `todo` test; fix is one line.
- Low: unbounded `/tts` text length (cost, above).
- Info: browser-direct Anthropic mode puts an API key in the browser by design.

## Environment notes
- The working tree on this mount has CRLF line endings; `HEAD` stores LF. Edited files were normalised to LF before committing. If git on Windows reports whole-file changes, check `core.autocrlf`.
- The VM cannot delete inside `.git`, so each commit left `HEAD.lock`/`maintenance.lock`. They were renamed to `.git/stale-*` (harmless; safe to delete) and `git fsck` was clean.
