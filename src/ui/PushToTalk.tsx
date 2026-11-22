import { useEffect, useState } from 'react'
import { installPttKeys, onPtt, pttOnly, setPtt } from '../lib/ptt'

/**
 * Hold Space, or hold this button, to talk. No wake word is needed while held.
 * The indicator makes it obvious that he is listening only because the key is
 * down. "Push-to-talk only" is switched in Diagnostics (press D).
 */
export function PushToTalk() {
  const [held, setHeld] = useState(false)
  const [only, setOnly] = useState(pttOnly())

  useEffect(() => installPttKeys(), [])
  useEffect(() => onPtt(setHeld), [])
  useEffect(() => {
    const id = setInterval(() => setOnly(pttOnly()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <button
      type="button"
      className={held ? 'ptt ptt-held' : 'ptt'}
      aria-pressed={held}
      aria-label="Hold to talk to JARVIS"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setPtt(true)
      }}
      onPointerUp={() => setPtt(false)}
      onPointerCancel={() => setPtt(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {held ? '● LISTENING — release to send' : `HOLD SPACE TO TALK${only ? ' · PTT ONLY' : ''}`}
    </button>
  )
}
