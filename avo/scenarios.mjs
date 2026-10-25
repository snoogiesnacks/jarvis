// Situations the staff work through. Facts marked VERIFIED come from the repo
// as of 2026-10-25; everything else is a rehearsal premise, not a real event.
export const SCENARIOS = [
  {
    id: 'fish-live-test',
    title: 'Go-live check for the Fish Audio voice',
    opener: 'Claude',
    brief: [
      'VERIFIED: JARVIS on the CEO\'s Windows PC already has Fish Audio text-to-speech (bridge/fish.mjs, scripts/test-fish-voice.ps1, node:test suite).',
      'VERIFIED: it has never been heard live with the CEO\'s selected voice; the API key is entered privately by the CEO.',
      'VERIFIED: the key is saved into .env.local by scripts/set-fish-key.ps1, which never echoes it. It is not stored in bridge/fish.mjs.',
      'VERIFIED: scripts/test-fish-voice.ps1 needs JARVIS already running (npm start). It checks the bridge reports voice=fish, asks the bridge for one spoken line, and times it. It proves the request path, not that the CEO heard audio.',
      'VERIFIED: if Fish Audio fails, JARVIS falls back to the browser\'s own voice. The existing tests do NOT cover this fallback.',
      'Goal: agree a 15-minute live test the CEO can run today: spoken reply, interruption, failure fallback, and how results get reported back to all three of you.',
    ],
  },
  {
    id: 'clean-pro-double-charge',
    title: 'Legend Clean Pro: customer reports a double charge (rehearsal)',
    opener: 'Halle',
    brief: [
      'PREMISE (not real): a customer emails that their card was charged twice for one booking.',
      'VERIFIED: Legend Clean Pro is a Next.js / Supabase / Stripe / Vercel platform.',
      'Goal: agree triage steps, what can be checked read-only, a holding reply to the customer for the CEO to approve, and what only the CEO may do (refunds, account changes).',
    ],
  },
  {
    id: 'meeting-mode-guest',
    title: 'Guest in 30 minutes: show the roadmap without leaking private data',
    opener: 'Gemini',
    brief: [
      'PREMISE: a guest arrives in 30 minutes. The CEO wants the Legend Clean Pro roadmap on the shared display.',
      'VERIFIED: private content belongs in the CEO\'s private view (VITURE glasses); guests must see shared content without glasses. Meeting mode is planned, not built.',
      'Goal: agree how to prepare a guest-safe version today with what exists, and what Meeting mode must guarantee once built.',
    ],
  },
]
