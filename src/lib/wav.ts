/**
 * 16 kHz mono 16-bit WAV for the bridge's offline transcriber (bridge/stt-local.mjs).
 * The recorder produces Opus; the bridge has no ffmpeg, so the browser decodes
 * and resamples here. encodeWav is pure and tested in test/wav.test.mjs.
 */

export const STT_RATE = 16000

export function encodeWav(samples: Float32Array, sampleRate = STT_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

/** Decode a recorded segment and render it as 16 kHz mono WAV (browser only). */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const frames = Math.max(1, Math.ceil(decoded.duration * STT_RATE))
    const off = new OfflineAudioContext(1, frames, STT_RATE)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start()
    const rendered = await off.startRendering()
    return new Blob([encodeWav(rendered.getChannelData(0))], { type: 'audio/wav' })
  } finally {
    void ctx.close()
  }
}
