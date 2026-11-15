// Fish Audio configuration and request shape, kept free of server state so it
// can be tested. bridge/server.mjs owns the HTTP handler; this owns the rules.

export const DEFAULT_FISH_VOICE_ID = '14129c3e320149449d6bada6862f7338'
export const FREE_FISH_MODEL = 's2.1-pro-free'
export const FISH_MODELS = [FREE_FISH_MODEL, 's2.1-pro', 's2-pro', 's1', 'drama-3']

/** Blank counts as unset: an empty reference_id would not pick the default. */
export function resolveFishVoiceId(raw) {
  return raw?.trim() || DEFAULT_FISH_VOICE_ID
}

/**
 * The free tier by default: a paid model has to be chosen on purpose. Fish
 * bills an empty or unknown model name as s2.1-pro, so anything that is not a
 * known id (blank, whitespace, a typo) falls back to free. `warn` is called
 * with a message only when a non-blank value was rejected.
 */
export function resolveFishModel(raw, warn = () => {}) {
  const want = (raw ?? '').trim()
  if (FISH_MODELS.includes(want)) return want
  if (want) warn(`unknown FISH_MODEL "${want}" — using ${FREE_FISH_MODEL}`)
  return FREE_FISH_MODEL
}

/** The fetch() arguments for one line of speech. Does not perform the request. */
export function fishRequest({ key, model, voiceId, text }) {
  return [
    'https://api.fish.audio/v1/tts',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        model,
      },
      body: JSON.stringify({
        text,
        reference_id: voiceId,
        format: 'mp3',
        mp3_bitrate: 64,
        // 'balanced' is Fish's low-latency mode — the same trade the
        // ElevenLabs path makes with Flash.
        latency: 'balanced',
      }),
    },
  ]
}
