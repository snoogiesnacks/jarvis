/**
 * Push-to-talk: hold Space (or the on-screen button) to talk.
 *
 * The fallback for rooms too loud for any gate (a soft voice under a loud TV).
 * Holding the key is the intent, so no wake word is needed; while JARVIS is
 * speaking it is also a barge-in. "Push-to-talk only" makes it the only way
 * in: nothing said without the key held is acted on, so a TV can never trigger
 * him. Both voice engines in voice.ts use this module.
 *
 * Routing and settings are pure functions, tested in test/ptt.test.mjs.
 */

export const PTT_ONLY_KEY = 'jarvis.pttOnly'
/** How long after release to keep collecting: the browser recogniser delivers
 *  its last words a moment after the speaker stops. */
export const PTT_TAIL_MS = 700

let held = false
const subs = new Set<(held: boolean) => void>()

export const pttHeld = (): boolean => held

export function setPtt(on: boolean): void {
  if (on === held) return
  held = on
  for (const f of subs) f(on)
}

export function onPtt(f: (held: boolean) => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}

export function pttOnly(): boolean {
  try { return localStorage.getItem(PTT_ONLY_KEY) === '1' } catch { return false }
}

export function setPttOnly(on: boolean): void {
  try {
    if (on) localStorage.setItem(PTT_ONLY_KEY, '1')
    else localStorage.removeItem(PTT_ONLY_KEY)
  } catch {
    /* storage blocked: the setting lasts for this page only */
  }
}

export type VoiceModeLike = 'deaf' | 'wake' | 'command' | 'guard' | string

/** What to do with words captured while the key was held. */
export function routePtt(text: string, mode: VoiceModeLike): { action: 'wake' | 'utterance' | 'drop'; text: string; why?: string } {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return { action: 'drop', text: '', why: 'push-to-talk: nothing heard while held' }
  if (mode === 'deaf') return { action: 'drop', text: t, why: 'push-to-talk: voice is off' }
  // Dormant: the held key stands in for his name, and the words are the command.
  if (mode === 'wake') return { action: 'wake', text: t }
  return { action: 'utterance', text: t }
}

/** Whether speech captured WITHOUT the key held may be acted on. */
export const acceptsUnheld = (only: boolean): boolean => !only

/** Typing in a field must never trigger push-to-talk. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null
  if (!e || typeof e !== 'object') return false
  const tag = (e.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(e.isContentEditable)
}

/** Space down/up drives push-to-talk. Losing focus releases it, so the key can never stick. */
export function installPttKeys(): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
    e.preventDefault()
    if (!e.repeat) setPtt(true)
  }
  const up = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return
    if (held) e.preventDefault()
    setPtt(false)
  }
  const release = () => setPtt(false)
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', release)
  document.addEventListener('visibilitychange', release)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', release)
    document.removeEventListener('visibilitychange', release)
    setPtt(false)
  }
}
