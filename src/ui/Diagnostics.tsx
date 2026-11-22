import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { chooseMic, chosenMic, listMics } from '../lib/audio'
import { pttOnly, setPttOnly } from '../lib/ptt'
import type { MicReport } from '../lib/micSettings'

/**
 * The "why can't he hear me / why can't I hear him" panel.
 *
 * Both halves of the voice loop fail silently by nature. Speech recognition
 * that ignores you and speech synthesis that produces no sound look identical
 * from the outside — nothing throws, nothing logs, the interface carries on as
 * though it were working. Every bug in this loop has therefore cost a round
 * trip of guesswork, and that is the actual problem this fixes: it is not a
 * developer toy, it is the instrument that turns "it doesn't work" into a
 * specific, answerable fact.
 *
 * Press D to show it. It polls rather than subscribing, because the two
 * diagnostic records are plain mutable objects written from outside React —
 * that is deliberate, since the whole point is to observe the loop without
 * changing its timing.
 */

type VoiceDiag = {
  running: boolean
  sessions: number
  heard: string
  heardAt: number
  lastError: string
  wakes: number
  mode: string
  dropped: string
  accepted: number
  restarts: number
  idleMs: number
}

type TtsDiag = {
  engine: string
  spoken: number
  started: number
  failures: number
  lastError: string
  nativeBroken: boolean
  rescued: number
  voice: string
  lastText: string
}

const ago = (t: number) => (t ? `${((Date.now() - t) / 1000).toFixed(1)}s ago` : '—')

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="diag-row">
      <span className="diag-k">{k}</span>
      <span className={bad ? 'diag-v diag-bad' : 'diag-v'}>{v}</span>
    </div>
  )
}

export function Diagnostics() {
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const phase = useStore((s) => s.phase)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'd' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [open])

  const [mics, setMics] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    if (open) listMics().then(setMics).catch(() => setMics([]))
  }, [open])

  if (!open) return null

  const w = window as unknown as Record<string, unknown>
  const v = (w.__voice ?? {}) as Partial<VoiceDiag>
  const t = (w.__tts ?? {}) as Partial<TtsDiag>
  const m = w.__mic as MicReport | undefined
  const meter = (w.__vadMeter as (() => { energy: number; floor: number; threshold: number; speaking: boolean }) | undefined)?.()
  const yn = (x: boolean | 'unknown' | undefined) => (x === true ? 'on' : x === false ? 'OFF' : 'unknown')

  // The two verdicts worth stating outright, rather than making you infer them
  // from the numbers underneath.
  const earsOk = Boolean(v.running) && (v.accepted ?? 0) > 0
  const mouthOk = (t.started ?? 0) > 0 || (t.rescued ?? 0) > 0

  return (
    <div className="diag" aria-live="polite">
      <div className="diag-head">DIAGNOSTICS · D to close</div>

      <div className="diag-verdict">
        <span className={earsOk ? 'diag-ok' : 'diag-bad'}>
          {earsOk ? '● hearing you' : '● not hearing you'}
        </span>
        <span className={mouthOk ? 'diag-ok' : 'diag-bad'}>
          {mouthOk ? '● speaking' : '● no sound produced'}
        </span>
      </div>

      <div className="diag-sec">LISTENING</div>
      <Row k="speech engine" v={String((v as Record<string, unknown>).engine ?? '—')} bad={!String((v as Record<string, unknown>).engine ?? '').includes('offline')} />
      <Row k="bridge check" v={String(w.__capsProbe ?? '—')} bad={!String(w.__capsProbe ?? '').includes('stt via')} />
      <Row k="recogniser" v={v.running ? 'running' : 'STOPPED'} bad={!v.running} />
      <Row k="sessions" v={String(v.sessions ?? 0)} />
      <Row
        k="silent for"
        v={`${((v.idleMs ?? 0) / 1000).toFixed(1)}s`}
        bad={(v.idleMs ?? 0) > 15000}
      />
      <Row k="forced restarts" v={String(v.restarts ?? 0)} bad={(v.restarts ?? 0) > 0} />
      <Row k="mode" v={`${v.mode ?? '—'} (phase ${phase})`} />
      <Row k="accepted" v={String(v.accepted ?? 0)} bad={(v.accepted ?? 0) === 0} />
      <Row k="wakes" v={String(v.wakes ?? 0)} />
      <Row k="last heard" v={v.heard ? `"${v.heard}" ${ago(v.heardAt ?? 0)}` : '— nothing yet'} bad={!v.heard} />
      <Row k="last drop" v={v.dropped || '—'} bad={Boolean(v.dropped)} />
      <Row k="error" v={v.lastError || '—'} bad={Boolean(v.lastError)} />

      <div className="diag-sec">MICROPHONE · applied by the browser</div>
      <Row k="device" v={m ? `${m.device}${m.fellBack ? ' (saved mic missing, using default)' : ''}` : 'not open yet'} bad={!m || m.fellBack} />
      <Row k="echo cancel" v={yn(m?.echoCancellation)} bad={m?.echoCancellation !== true} />
      <Row k="noise suppress" v={yn(m?.noiseSuppression)} bad={m?.noiseSuppression !== true} />
      <Row k="auto gain" v={yn(m?.autoGainControl)} bad={m?.autoGainControl !== true} />
      <Row
        k="room / trigger"
        v={meter ? `${meter.energy.toFixed(3)} now · floor ${meter.floor.toFixed(3)} · trigger ${meter.threshold.toFixed(3)}${meter.speaking ? ' · SPEECH' : ''}` : '—'}
      />
      <div className="diag-row">
        <span className="diag-k">use mic</span>
        <select
          className="diag-v"
          value={chosenMic()}
          onChange={(e) => {
            chooseMic(e.target.value)
            location.reload()
          }}
        >
          <option value="">system default</option>
          {mics.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </div>

      <div className="diag-row">
        <span className="diag-k">push-to-talk only</span>
        <label className="diag-v">
          <input type="checkbox" checked={pttOnly()} onChange={(e) => setPttOnly(e.target.checked)} />{' '}
          {pttOnly() ? 'ON: only heard while Space is held' : 'off: wake word or Space'}
        </label>
      </div>

      <div className="diag-sec">SPEAKING · press T to test</div>
      <Row k="engine" v={String(t.engine ?? 'system')} />
      <Row k="voice" v={String(t.voice || '—')} />
      <Row k="handed to OS" v={String(t.spoken ?? 0)} />
      <Row k="actually spoke" v={String(t.started ?? 0)} bad={(t.started ?? 0) === 0} />
      <Row k="failures" v={String(t.failures ?? 0)} bad={(t.failures ?? 0) > 0} />
      <Row k="cloud rescues" v={String(t.rescued ?? 0)} />
      <Row k="error" v={t.lastError || '—'} bad={Boolean(t.lastError)} />
    </div>
  )
}
