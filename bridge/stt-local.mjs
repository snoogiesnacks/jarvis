/**
 * Local, offline speech-to-text for the bridge's /stt route.
 *
 * Whisper tiny.en (int8) through sherpa-onnx, in this process, on the CPU.
 * Chosen by the 2026-11-22 benchmark (docs/STT-LOCAL-EVALUATION-2026-11-22.md):
 * 18.6% WER with a TV at -6 dB, about 0.35 s per command on 2 threads, +271 MB.
 * No network access: audio never leaves the machine.
 *
 * When it is used:
 *   JARVIS_STT=local  always (fails loudly if the model or runtime is missing)
 *   JARVIS_STT=off    never
 *   unset             in local mode (JARVIS_PROVIDER=ollama), if the model and runtime are present
 * Locations:
 *   JARVIS_STT_MODEL_DIR    folder with tiny.en-encoder.int8.onnx, tiny.en-decoder.int8.onnx, tiny.en-tokens.txt
 *   JARVIS_STT_RUNTIME_DIR  a node_modules folder containing sherpa-onnx-node, if it is not
 *                           installed in this project (default: %USERPROFILE%\jarvis-models\stt-bench\node_modules)
 *   JARVIS_STT_THREADS      default 2, leaving CPU for Ollama and the interface
 *
 * The browser sends 16 kHz mono 16-bit WAV (src/lib/wav.ts), so no ffmpeg is needed here.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const home = os.homedir()
export const MODEL_DIR = process.env.JARVIS_STT_MODEL_DIR
  ?? path.join(home, 'jarvis-models', 'sherpa-onnx-whisper-tiny.en-x', 'sherpa-onnx-whisper-tiny.en')
const RUNTIME_DIR = process.env.JARVIS_STT_RUNTIME_DIR ?? path.join(home, 'jarvis-models', 'stt-bench', 'node_modules')
const THREADS = Math.max(1, Math.min(8, Number(process.env.JARVIS_STT_THREADS ?? 2) || 2))
const FILES = { encoder: 'tiny.en-encoder.int8.onnx', decoder: 'tiny.en-decoder.int8.onnx', tokens: 'tiny.en-tokens.txt' }

/** Collapse Whisper's known failure of repeating a whole sentence ("Open the Q status. Open the Q status."). */
export function dedupeSentences(text) {
  const parts = String(text ?? '').trim().split(/(?<=[.!?])\s+/).filter(Boolean)
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
  const out = []
  for (const p of parts) if (!out.length || key(out[out.length - 1]) !== key(p)) out.push(p)
  return out.join(' ')
}

/** Whisper emits these for silence or noise; they are not speech. */
export function isNonSpeech(text) {
  return /^\s*[([]?\s*(blank_audio|music|silence|noise|inaudible|applause|laughter)\s*[)\]]?\s*\.?\s*$/i.test(text ?? '')
}

/**
 * Parse a 16 kHz mono 16-bit PCM WAV into Float32 samples. Anything else throws
 * with status 415. (sherpa-onnx-node documents readWaveFromBinary but does not
 * export it, so the bridge reads the format it asked the browser for.)
 */
export function parseWav16k(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  const bad = (why) => Object.assign(new Error(`expected 16 kHz mono 16-bit WAV: ${why}`), { status: 415 })
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw bad('not a WAV file')
  let fmt = null
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4), body = o + 8
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) }
    if (id === 'data') {
      if (!fmt) throw bad('data before fmt')
      if (fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16) throw bad(`format ${fmt.format}, ${fmt.channels} ch, ${fmt.bits} bit`)
      if (fmt.rate !== 16000) throw bad(`${fmt.rate} Hz`)
      const n = Math.floor(Math.min(len, b.length - body) / 2), out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(body + i * 2) / 32768
      return out
    }
    o = body + len + (len % 2)
  }
  throw bad('no data chunk')
}

export function modelPresent(dir = MODEL_DIR) {
  return Object.values(FILES).every((f) => fs.existsSync(path.join(dir, f)))
}

let sherpa
function loadRuntime() {
  if (sherpa !== undefined) return sherpa
  // This project first; then the separate runtime folder (resolving from a file
  // inside it searches that node_modules).
  for (const from of [import.meta.url, path.join(RUNTIME_DIR, 'noop.js')]) {
    try {
      sherpa = createRequire(from)('sherpa-onnx-node')
      return sherpa
    } catch {
      /* try the next location */
    }
  }
  sherpa = null
  return sherpa
}

/** Decide once, at the first question, whether local STT is on. */
let decided
export function localSttEnabled() {
  if (decided !== undefined) return decided
  const mode = (process.env.JARVIS_STT ?? '').toLowerCase()
  if (mode === 'off') return (decided = false)
  const wanted = mode === 'local' || (mode === '' && process.env.JARVIS_PROVIDER === 'ollama')
  if (!wanted) return (decided = false)
  const ok = modelPresent() && Boolean(loadRuntime())
  if (!ok) {
    const why = !modelPresent() ? `model not found in ${MODEL_DIR}` : `sherpa-onnx-node not found (set JARVIS_STT_RUNTIME_DIR)`
    console.warn(`[jarvis] local speech-to-text unavailable: ${why}`)
    if (mode === 'local') console.warn('[jarvis] JARVIS_STT=local was requested; /stt will answer 503')
  } else {
    console.log(`[jarvis] local speech-to-text: Whisper tiny.en, ${THREADS} threads, offline`)
  }
  return (decided = ok)
}

let recognizer = null
function getRecognizer() {
  if (recognizer) return recognizer
  const p = (f) => path.join(MODEL_DIR, f)
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: p(FILES.encoder), decoder: p(FILES.decoder), language: 'en', task: 'transcribe' },
      tokens: p(FILES.tokens),
      numThreads: THREADS,
      provider: 'cpu',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
  })
  return recognizer
}

// One decode at a time, in arrival order: the CPU is shared with Ollama.
let chain = Promise.resolve()

/**
 * Transcribe one WAV file (bytes). Resolves to { text, ms }.
 * Throws an Error with .status 415 for audio that is not 16 kHz mono WAV.
 */
export function transcribeWav(bytes) {
  const job = chain.then(async () => {
    if (!localSttEnabled()) throw Object.assign(new Error('local speech-to-text unavailable'), { status: 503 })
    const samples = parseWav16k(bytes)
    const rec = getRecognizer()
    const t0 = performance.now()
    const stream = rec.createStream()
    stream.acceptWaveform({ sampleRate: 16000, samples })
    await rec.decodeAsync(stream)
    const raw = rec.getResult(stream).text ?? ''
    const text = isNonSpeech(raw) ? '' : dedupeSentences(raw)
    return { text, ms: Math.round(performance.now() - t0) }
  })
  chain = job.catch(() => {})
  return job
}
