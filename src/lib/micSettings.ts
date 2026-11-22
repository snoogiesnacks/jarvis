/**
 * Microphone constraints and a plain report of what the browser actually
 * applied. Asking for echo cancellation, noise suppression and auto gain is
 * only a request: browsers and drivers may ignore any of them, so the applied
 * values come from track.getSettings() and are shown in Diagnostics (press D).
 * Pure functions, tested in test/mic-settings.test.mjs.
 */

export const MIC_DEVICE_KEY = 'jarvis.micDeviceId'

export function buildAudioConstraints(deviceId?: string | null): MediaTrackConstraints {
  const c: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
}

export type MicReport = {
  device: string
  deviceId: string
  echoCancellation: boolean | 'unknown'
  noiseSuppression: boolean | 'unknown'
  autoGainControl: boolean | 'unknown'
  sampleRate: number | null
  /** Requested features the browser did not confirm applying. */
  missing: string[]
  /** A saved device could not be opened, so the system default is in use. */
  fellBack: boolean
}

type Settings = Partial<Record<'deviceId' | 'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'sampleRate', unknown>>

export function summariseTrack(settings: Settings, label: string, fellBack = false): MicReport {
  const flag = (v: unknown): boolean | 'unknown' => (typeof v === 'boolean' ? v : 'unknown')
  const r: MicReport = {
    device: label || 'default microphone',
    deviceId: typeof settings.deviceId === 'string' ? settings.deviceId : '',
    echoCancellation: flag(settings.echoCancellation),
    noiseSuppression: flag(settings.noiseSuppression),
    autoGainControl: flag(settings.autoGainControl),
    sampleRate: typeof settings.sampleRate === 'number' ? settings.sampleRate : null,
    missing: [],
    fellBack,
  }
  for (const k of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const) {
    if (r[k] !== true) r.missing.push(k)
  }
  return r
}

/** Errors that mean "that particular device is gone or unusable": retry on the default. */
export function isDeviceUnavailable(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? ''
  return name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError'
}
