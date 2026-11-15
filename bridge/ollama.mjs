import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const endpoint = 'http://127.0.0.1:11434/api/chat'
const models = new Set(['gemma3:1b', 'llama3.2:1b'])

/**
 * Where local answers are filed for human review. JARVIS_REVIEW_DIR names the
 * folder; "off" disables it. With nothing set, the Legend Crew AI workforce
 * folder is used when it exists on this machine, so local mode is reviewed by
 * default rather than by remembering to set a variable.
 */
export function reviewDir(env = process.env, home = homedir()) {
  const named = env.JARVIS_REVIEW_DIR?.trim()
  if (named) return named.toLowerCase() === 'off' ? null : named
  const workforce = path.join(home, 'Legend Crew AI', 'divisions', 'jarvis', 'review')
  return existsSync(workforce) ? workforce : null
}

/**
 * Every local answer is also written as a needs_review record, so a person can
 * check it later alongside the queue's results. A failed write never
 * interrupts the chat.
 */
async function recordForReview(model, question, answer) {
  const dir = reviewDir()
  if (!dir) return
  const now = new Date()
  const id = `jarvis-chat-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${Math.random().toString(36).slice(2, 6)}`
  const record = {
    id,
    division: 'jarvis',
    operation: 'chat',
    requested_by: 'jarvis',
    status: 'needs_review',
    model,
    completed: now.toISOString(),
    question,
    text: answer,
  }
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${id}.result.json`), JSON.stringify(record, null, 2), { flag: 'wx' })
  } catch (error) {
    console.warn(`[jarvis] could not write review record: ${error.message}`)
  }
}

export function connectOllama(socket) {
  const model = process.env.JARVIS_OLLAMA_MODEL ?? 'gemma3:1b'
  let history = []
  let active

  function send(frame) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame))
  }

  function cancel() {
    active?.abort()
    active = undefined
  }

  send({ type: 'ready', servers: [] })
  socket.on('close', cancel)
  socket.on('message', async (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (message?.type === 'interrupt') return cancel()
    if (message?.type !== 'ask' || typeof message.text !== 'string') return
    cancel()
    const turn = new AbortController()
    active = turn
    const ask = message.id
    const signal = AbortSignal.any([turn.signal, AbortSignal.timeout(90000)])
    try {
      if (!models.has(model)) throw new Error('Select gemma3:1b or llama3.2:1b for local JARVIS.')
      if (!message.text.trim() || message.text.length > 5000) {
        throw new Error('Enter between 1 and 5,000 characters for local JARVIS.')
      }
      const user = { role: 'user', content: message.text }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are JARVIS in local chat mode. Help draft and summarize text. Preserve supplied facts and pending details. You have no tools.' },
            ...history,
            user,
          ],
          stream: false,
          keep_alive: 0,
          options: { num_ctx: 4096, num_predict: 384 },
        }),
      }).catch((error) => {
        if (signal.aborted) throw error
        throw new Error('Cannot reach Ollama on this PC. Start Ollama and retry.')
      })
      if (response.status === 404) throw new Error(`Install ${model} in Ollama and retry.`)
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`)
      const result = await response.json()
      const answer = result.message?.content?.trim()
      if (!result.done || !answer || result.done_reason === 'length') {
        throw new Error('Ollama returned an incomplete answer. Try a shorter request.')
      }
      if (active !== turn) return
      history = [...history, user, { role: 'assistant', content: answer }].slice(-4)
      await recordForReview(model, message.text, answer)
      send({ type: 'text', ask, delta: answer })
      send({ type: 'done', ask, text: answer })
    } catch (error) {
      if (active === turn) {
        send({ type: 'error', ask, message: signal.aborted ? 'Ollama took too long to answer.' : error.message })
      }
    } finally {
      if (active === turn) active = undefined
    }
  })
}
