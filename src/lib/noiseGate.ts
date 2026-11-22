/**
 * The speech gate behind vad.ts, pulled out as pure logic so it can be tested
 * with synthetic energy traces (test/noise-gate.test.mjs) instead of a room.
 *
 * Why the floor changed (2026-11-22, CEO P0 "hear me with the TV on"):
 * the old floor was an EMA that only adapted while the gate was closed. A
 * television is continuous, speech-like sound, so it keeps opening the gate,
 * the floor never gets a chance to learn it, and JARVIS keeps "hearing" the TV
 * indefinitely. The 'percentile' floor is the median of the last few seconds
 * of energy, sampled whether or not the gate is open, so steady background
 * (TV, train, traffic) raises the bar within seconds while the person close
 * to the microphone, who is much louder than the room, still clears it.
 * Sampling pauses for the first few seconds of a confirmed segment so the
 * user's own sentence cannot raise the bar under itself, then resumes so a TV
 * that "talks" non-stop is still absorbed.
 *
 * 'ema' keeps the previous behaviour for comparison in tests.
 */

export type GateEvent = 'arm' | 'discard' | 'start' | 'end' | null

export type GateOptions = {
  floorMode?: 'percentile' | 'ema'
  triggerOverFloor?: number
  guardBoost?: number
  releaseRatio?: number
  startMs?: number
  silenceMs?: number
  maxMs?: number
  minFloor?: number
  /** percentile mode */
  windowMs?: number
  sampleMs?: number
  percentile?: number
  freezeMs?: number
  /** ema mode */
  floorUp?: number
  floorDown?: number
}

const DEFAULTS: Required<GateOptions> = {
  floorMode: 'percentile',
  triggerOverFloor: 2.6,
  guardBoost: 2.4,
  releaseRatio: 0.6,
  startMs: 110,
  silenceMs: 650,
  maxMs: 20000,
  minFloor: 0.0015,
  windowMs: 6000,
  sampleMs: 100,
  percentile: 0.5,
  freezeMs: 3000,
  floorUp: 0.0008,
  floorDown: 0.02,
}

export type GateStep = { event: GateEvent; floor: number; threshold: number; speaking: boolean; startedAt: number }

export function percentileOf(values: number[], p: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]
}

export function createNoiseGate(options: GateOptions = {}) {
  const o = { ...DEFAULTS, ...options }
  let floor = 0.01
  let threshold = 0
  let armedAt = 0
  let speaking = false
  let speechStartedAt = 0
  let lastLoud = 0
  let lastSample = -Infinity
  const samples: number[] = []
  const maxSamples = Math.max(1, Math.round(o.windowMs / o.sampleMs))

  const updateFloor = (energy: number, now: number) => {
    if (o.floorMode === 'ema') {
      if (!speaking && armedAt === 0) {
        const rate = energy > floor ? o.floorUp : o.floorDown
        floor += (energy - floor) * rate
      }
    } else {
      const frozen = speaking && now - speechStartedAt < o.freezeMs
      if (!frozen && now - lastSample >= o.sampleMs) {
        lastSample = now
        samples.push(energy)
        if (samples.length > maxSamples) samples.shift()
        // Until there is a second of history, keep the starting guess.
        if (samples.length >= Math.min(10, maxSamples)) floor = percentileOf(samples, o.percentile)
      }
    }
    floor = Math.max(floor, o.minFloor)
  }

  /** Feed one frame of smoothed RMS energy at time `now` (ms). */
  function step(energy: number, now: number, guard = false): GateStep {
    updateFloor(energy, now)
    threshold = floor * o.triggerOverFloor * (guard ? o.guardBoost : 1)
    const release = threshold * o.releaseRatio
    let event: GateEvent = null
    let startedAt = 0

    if (!speaking) {
      if (energy > threshold) {
        if (armedAt === 0) {
          armedAt = now
          event = 'arm'
        } else if (now - armedAt >= o.startMs) {
          speaking = true
          speechStartedAt = armedAt
          lastLoud = now
          event = 'start'
        }
      } else if (armedAt !== 0) {
        armedAt = 0
        event = 'discard'
      }
    } else {
      if (energy > release) lastLoud = now
      if (now - lastLoud >= o.silenceMs || now - speechStartedAt >= o.maxMs) {
        startedAt = speechStartedAt
        armedAt = 0
        speaking = false
        speechStartedAt = 0
        event = 'end'
      }
    }
    return { event, floor, threshold, speaking, startedAt }
  }

  return { step, meter: () => ({ floor, threshold, speaking }) }
}
