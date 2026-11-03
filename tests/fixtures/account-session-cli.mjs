#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const codex = args[0] === 'exec'
const profile = codex ? process.env.CODEX_HOME : process.env.CLAUDE_CONFIG_DIR
// Never touch a real user profile if a test fails to isolate the environment.
if (!profile || !profile.startsWith(process.cwd() + path.sep))
  throw new Error('Profile isolation missing')
const positional = args.slice(args.indexOf('--') + 1)
const resume = codex
  ? args[1] === 'resume'
    ? positional[0]
    : undefined
  : args.includes('--resume')
    ? args[args.indexOf('--resume') + 1]
    : undefined
const token = codex ? process.env.CODEX_API_KEY : process.env.ANTHROPIC_API_KEY
const owner =
  token === 'quota-on-second-A' ? 'A' : token === 'healthy-B' ? 'B' : path.basename(profile)
const file = path.join(profile, 'fixture-sessions.json')
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const id = resume ?? randomUUID()
const count = (state[id] ?? 0) + 1
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
appendFileSync(
  path.join(process.cwd(), 'account-cli-calls.jsonl'),
  `${JSON.stringify({ owner, id, resume, profile, count })}\n`,
)
if (resume && !state[resume]) throw new Error('Attempted to resume another account session')
state[id] = count
writeFileSync(file, JSON.stringify(state))
if (codex) send({ type: 'thread.started', thread_id: id })
else send({ type: 'system', subtype: 'init', session_id: id })
if (token === 'quota-on-second-A' && count === 2) {
  if (codex) send({ type: 'turn.failed', error: { message: '429 quota exhausted' } })
  else
    send({
      type: 'result',
      session_id: id,
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['429 quota exhausted'],
    })
} else {
  const text = `${owner} turn ${count}`
  if (codex) {
    send({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text } })
    send({ type: 'turn.completed' })
  } else send({ type: 'result', session_id: id, subtype: 'success', is_error: false, result: text })
}
