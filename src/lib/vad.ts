import { getMic } from './audio'
import { createNoiseGate } from './noiseGate'

/**
 * Voice-activity detection and segment capture.
 *
 * This is the piece that makes the assistant reliable, and it exists because
 * the browser's SpeechRecognition does not. That API dies silently under
 * always-on use — Chrome throttles it, it stops firing events, and nothing you
 * can catch tells you it has gone deaf. Detecting that a human is speaking is
 * not a language problem, though; it is an energy problem, and energy on the
 * microphone signal is something we can measure ourselves, every frame, with no
 * black box that can quietly stop answering.
 *
 * So: a running-mean noise floor, a threshold above it, and a hysteresis gate.
 * When the signal crosses the threshold a fresh recorder starts; when it falls
 * quiet for long enough the recorder stops and hands back one self-contained
 * audio blob for the bridge to transcribe. The detection is instant and local
 * — that is what makes barge-in feel natural — and the words come back a moment
 * later from a real transcriber that cannot silently fail the way the browser
 * one did.
 *
 * Hearing himself is the one hard part. The microphone picks up JARVIS's own
 * voice through the speakers, and raw energy cannot tell that from the user.
 * Two things handle it: getUserMedia is asked for echo cancellation, which
 * removes most of the playback, and while he is speaking the trigger threshold
 * is raised so the residue that leaks through does not cross it. A text check
 * after transcription is the final backstop, in voice.ts.
 */

export type VadHandlers = {
  /** The signal crossed into speech. Instant; this is the barge-in trigger. */
  onStart: () => void
  /** Speech ended. The blob is one complete, decodable audio file. */
  onEnd: (audio: Blob, ms: number) => void
  /** 0..1 smoothed input level, for the caption/orb while capturing. */
  onLevel: (v: number) => void
  /** Capture is impossible — no microphone, or no MediaRecorder support. */
  onError: (message: string) => void
}

export type Vad = {
  stop: () => void
  /** Raise the trigger bar while JARVIS speaks, so his own playback leaking
   *  past echo cancellation does not register as the user talking. */
  setGuard: (on: boolean) => void
  /** Push-to-talk: while on, the gate is open regardless of level. */
  setForce: (on: boolean) => void
  live: () => boolean
  /** Live internals, for the diagnostics panel. */
  meter: () => { energy: number; floor: number; threshold: number; speaking: boolean }
}

// Gate tuning (trigger ratio, guard boost, hysteresis, 110 ms onset, 650 ms silence, 20 s cap) and the
// noise floor now live in noiseGate.ts, which is unit-tested with synthetic TV-on/TV-off traces.

function pickMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) {
      return m
    }
  }
  return ''
}

export async function startVad(h: VadHandlers): Promise<Vad> {
  let stream: MediaStream
  try {
    stream = await getMic()
  } catch (err) {
    h.onError(
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access denied — voice input is unavailable.'
        : 'No microphone available.',
    )
    return { stop: () => {}, setGuard: () => {}, setForce: () => {}, live: () => false, meter: () => ({ energy: 0, floor: 0, threshold: 0, speaking: false }) }
  }

  if (typeof MediaRecorder === 'undefined') {
    h.onError('This browser cannot record audio — voice input is unavailable.')
    return { stop: () => {}, setGuard: () => {}, setForce: () => {}, live: () => false, meter: () => ({ energy: 0, floor: 0, threshold: 0, speaking: false }) }
  }

  const mime = pickMime()
  const ctx = new AudioContext()
  // Some browsers start an AudioContext suspended even after a gesture; resume
  // is a no-op when it is already running.
  void ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.35
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  let stopped = false
  let guard = false
  let force = false
  let smoothEnergy = 0
  const gate = createNoiseGate()
  let floor = 0
  let threshold = 0
  let speaking = false

  // Segment state.
  let recorder: MediaRecorder | null = null
  let parts: Blob[] = []
  let raf = 0

  const rms = (): number => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.sqrt(sum / buf.length)
  }

  const startRecorder = () => {
    parts = []
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch {
      recorder = new MediaRecorder(stream)
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) parts.push(e.data)
    }
    recorder.start()
  }

  const discardRecorder = () => {
    if (!recorder) return
    try {
      recorder.ondataavailable = null
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      /* already gone */
    }
    recorder = null
    parts = []
  }

  const endSegment = (startedAt: number) => {
    const rec = recorder
    if (!rec) return
    recorder = null

    const finalise = () => {
      const type = rec.mimeType || mime || 'audio/webm'
      const blob = new Blob(parts, { type })
      parts = []
      const ms = startedAt ? performance.now() - startedAt : 0
      h.onEnd(blob, ms)
    }
    rec.onstop = finalise
    try {
      if (rec.state !== 'inactive') rec.stop()
      else finalise()
    } catch {
      finalise()
    }
  }

  const tick = () => {
    if (stopped) return
    raf = requestAnimationFrame(tick)

    const energy = rms()
    smoothEnergy += (energy - smoothEnergy) * 0.5
    h.onLevel(Math.min(1, smoothEnergy * 12))

    const s = gate.step(smoothEnergy, performance.now(), guard, force)
    floor = s.floor
    threshold = s.threshold
    speaking = s.speaking
    // Onset: start recording immediately so the first phoneme is captured,
    // before it is confirmed as speech; a blip just discards the recorder.
    if (s.event === 'arm') startRecorder()
    else if (s.event === 'discard') discardRecorder()
    else if (s.event === 'start') h.onStart() // confirmed: the barge-in moment
    else if (s.event === 'end') endSegment(s.startedAt)
  }

  tick()

  return {
    stop: () => {
      stopped = true
      cancelAnimationFrame(raf)
      discardRecorder()
      try {
        source.disconnect()
        void ctx.close()
      } catch {
        /* noop */
      }
    },
    setGuard: (on) => {
      guard = on
    },
    setForce: (on) => {
      force = on
    },
    live: () => !stopped,
    meter: () => ({ energy: smoothEnergy, floor, threshold, speaking }),
  }
}
