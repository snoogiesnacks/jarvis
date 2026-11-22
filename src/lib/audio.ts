/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 */

import { buildAudioConstraints, isDeviceUnavailable, MIC_DEVICE_KEY, summariseTrack, type MicReport } from './micSettings'

let stream: MediaStream | null = null
let opening: Promise<MediaStream> | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Uint8Array | null = null

const savedDevice = (): string | null => {
  try { return localStorage.getItem(MIC_DEVICE_KEY) } catch { return null }
}

/** What the browser actually applied, for Diagnostics (press D). Null until the mic opens. */
export let micReport: MicReport | null = null

/**
 * One shared stream. Concurrent callers share a single pending open, so a
 * startup race cannot open two streams. A saved microphone is used when it
 * still exists; otherwise the system default, and the report says so.
 */
export function getMic(): Promise<MediaStream> {
  if (stream) return Promise.resolve(stream)
  if (opening) return opening
  const p = (async () => {
    const wanted = savedDevice()
    let fellBack = false
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(wanted) })
    } catch (err) {
      if (!wanted || !isDeviceUnavailable(err)) throw err
      fellBack = true
      s = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(null) })
    }
    const track = s.getAudioTracks()[0]
    micReport = summariseTrack(track?.getSettings?.() ?? {}, track?.label ?? '', fellBack)
    ;(window as unknown as Record<string, unknown>).__mic = micReport
    if (micReport.missing.length) console.warn('[mic] browser did not confirm:', micReport.missing.join(', '))
    stream = s
    return s
  })()
  opening = p
  // Clear the pending open either way, so a denied permission can be retried.
  p.then(() => { opening = null }, () => { opening = null })
  return p
}

/** Microphones the user can pick. Labels appear only after mic permission is granted. */
export async function listMics(): Promise<{ id: string; label: string }[]> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
}

/** Save the chosen microphone. It takes effect on the next page load, because
 *  the open stream is shared by voice, clap detection and the reactor. */
export function chooseMic(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(MIC_DEVICE_KEY, deviceId)
    else localStorage.removeItem(MIC_DEVICE_KEY)
  } catch {
    /* storage blocked: the default microphone stays in use */
  }
}

export function chosenMic(): string {
  return savedDevice() ?? ''
}

export async function startAnalyser(): Promise<void> {
  if (analyser) return
  const s = await getMic()
  ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Uint8Array(analyser.frequencyBinCount)
}

/** 0..1 loudness. Returns 0 before the analyser is up. */
export function micLevel(): number {
  if (!analyser || !buf) return 0
  analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
  let sum = 0
  // Skip the lowest bins — they're mostly rumble and mains hum.
  for (let i = 4; i < buf.length; i++) sum += buf[i]
  const avg = sum / (buf.length - 4) / 255
  // Voice sits low in this range; stretch it so the visuals actually move.
  return Math.min(1, avg * 3.2)
}

/** Analyser fed from an <audio> element, so the orb reacts while JARVIS talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, sum / (b.length - 2) / 255 * 3)
  }
}
