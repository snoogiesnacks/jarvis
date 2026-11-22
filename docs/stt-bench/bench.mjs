// Offline STT benchmark: node bench.mjs <moonshine|whisper> [threads]
// Synthetic speech from Windows SAPI voices; "TV" = a second voice mixed at 0/-6/-12 dB relative to the command.
import fs from 'node:fs'
import path from 'node:path'
import sherpa from 'sherpa-onnx-node'

const M = path.join(process.env.USERPROFILE, 'jarvis-models')
const which = process.argv[2] ?? 'moonshine', threads = Number(process.argv[3] ?? 4)
const cfg = which === 'moonshine'
  ? { moonshine: { encoder: 'encoder_model.ort', mergedDecoder: 'decoder_model_merged.ort' }, dir: 'sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27-x/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27', tokens: 'tokens.txt' }
  : { whisper: { encoder: 'tiny.en-encoder.int8.onnx', decoder: 'tiny.en-decoder.int8.onnx' }, dir: 'sherpa-onnx-whisper-tiny.en-x/sherpa-onnx-whisper-tiny.en', tokens: 'tiny.en-tokens.txt' }
const dir = path.join(M, cfg.dir), p = f => path.join(dir, f)
const modelConfig = { tokens: p(cfg.tokens), numThreads: threads, provider: 'cpu', debug: 0 }
if (cfg.moonshine) modelConfig.moonshine = { encoder: p(cfg.moonshine.encoder), mergedDecoder: p(cfg.moonshine.mergedDecoder) }
else modelConfig.whisper = { encoder: p(cfg.whisper.encoder), decoder: p(cfg.whisper.decoder), language: 'en', task: 'transcribe' }

const rss0 = process.memoryUsage().rss
const t0 = performance.now()
const rec = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig, decodingMethod: 'greedy_search' })
const loadMs = performance.now() - t0

const A = path.join(process.cwd(), 'audio')
const refs = fs.readFileSync(path.join(A, 'reference.txt'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
const tv = sherpa.readWave(path.join(A, 'tv.wav')).samples
const rms = a => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
const NUM = { 10: 'ten', 3: 'three', 6: 'six' }
const norm = s => s.toLowerCase().replace(/\d+/g, d => NUM[d] ?? d).replace(/[^a-z' ]+/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean)
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp), d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return { errors: d[r.length][h.length], words: r.length }
}

const conditions = [['clean', null], ['tv -12dB', -12], ['tv -6dB', -6], ['tv 0dB', 0]]
const out = { model: which, threads, loadMs: Math.round(loadMs), rows: [] }
let peak = process.memoryUsage().rss
for (const [name, db] of conditions) {
  let errors = 0, words = 0; const lat = []; const samples = []
  refs.forEach((ref, i) => {
    const cmd = sherpa.readWave(path.join(A, `cmd${i}.wav`)).samples
    let mix = cmd
    if (db !== null) {
      const g = rms(cmd) / rms(tv) * 10 ** (db / 20), off = (i * 37301) % (tv.length - cmd.length)
      mix = new Float32Array(cmd.length)
      for (let k = 0; k < cmd.length; k++) mix[k] = Math.max(-1, Math.min(1, cmd[k] + tv[off + k] * g))
    }
    const s = rec.createStream()
    const t = performance.now()
    s.acceptWaveform({ sampleRate: 16000, samples: mix })
    rec.decode(s)
    const text = rec.getResult(s).text.trim()
    lat.push({ ms: performance.now() - t, audioMs: cmd.length / 16 })
    const w = wer(ref, text); errors += w.errors; words += w.words
    samples.push({ ref, text, errors: w.errors })
    peak = Math.max(peak, process.memoryUsage().rss)
  })
  lat.sort((a, b) => a.ms - b.ms)
  const median = lat[Math.floor(lat.length / 2)]
  out.rows.push({ condition: name, wer: +(100 * errors / words).toFixed(1), medianMs: Math.round(median.ms), rtf: +(median.ms / median.audioMs).toFixed(3), samples })
}
out.rssLoadedMB = Math.round((peak - rss0) / 1048576)
fs.writeFileSync(path.join(process.cwd(), `result-${which}-t${threads}.json`), JSON.stringify(out, null, 2))
console.log(`${which} (threads ${threads}) load ${out.loadMs} ms, RAM +${out.rssLoadedMB} MB`)
for (const r of out.rows) console.log(`  ${r.condition.padEnd(9)} WER ${String(r.wer).padStart(5)}%  median ${r.medianMs} ms  RTF ${r.rtf}`)
