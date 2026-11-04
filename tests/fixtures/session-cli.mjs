#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const provider = args[0] === 'exec' ? 'codex' : 'claude'
const modelFlag = provider === 'codex' ? '-m' : '--model'
const mode = args[args.indexOf(modelFlag) + 1] || 'normal'
const positional = args.slice(args.indexOf('--') + 1)
const resume =
  provider === 'codex'
    ? args[1] === 'resume'
      ? positional[0]
      : undefined
    : args.includes('--resume')
      ? args[args.indexOf('--resume') + 1]
      : undefined
// O prompt chega por stdin; as instruções do Claude, em arquivo.
const prompt = readFileSync(0, 'utf8')
const systemFile = args.includes('--append-system-prompt-file')
  ? args[args.indexOf('--append-system-prompt-file') + 1]
  : undefined
const system = systemFile ? readFileSync(systemFile, 'utf8') : undefined
const file = path.join(process.cwd(), 'cli-sessions.json')
const log = path.join(process.cwd(), 'cli-calls.jsonl')
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const id = mode === 'mismatch' || !resume ? randomUUID() : resume
const send = (event, newline = true) =>
  process.stdout.write(JSON.stringify(event) + (newline ? '\n' : ''))
const error = (message) => {
  if (provider === 'codex') send({ type: 'turn.failed', error: { message } })
  else
    send({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: id,
      errors: [message],
    })
}
appendFileSync(
  log,
  `${JSON.stringify({ provider, args, resume, id, prompt, system, cwd: process.cwd() })}\n`,
)
if (resume && !state[resume]) {
  error('Session not found')
  process.exitCode = 1
} else {
  if (mode !== 'missing-id') {
    if (provider === 'codex')
      send({ type: 'thread.started', thread_id: mode === 'bad-id' ? '/tmp/other-session' : id })
    else
      send({
        type: 'system',
        subtype: 'init',
        session_id: mode === 'bad-id' ? '/tmp/other-session' : id,
      })
  }
  state[id] = [...(state[resume] ?? []), prompt]
  writeFileSync(file, JSON.stringify(state))
  const text = `Turn ${state[id].length}: Olá 🌍`
  if (provider === 'codex') {
    send({ type: 'item.updated', item: { id: 'answer', type: 'agent_message', text: 'Turn' } })
    send({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text } })
  } else
    send({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    })
  if (mode === 'hang' || mode === 'hang-ignore') {
    if (mode === 'hang-ignore') {
      setInterval(() => {}, 1000)
      process.on('SIGTERM', () => {})
    } else {
      const hold = setInterval(() => {}, 1000)
      process.on('SIGTERM', () =>
        setTimeout(() => {
          appendFileSync(log, `${JSON.stringify({ event: 'closed', id })}\n`)
          clearInterval(hold)
          process.exit(0)
        }, 80),
      )
    }
  } else if (mode === 'failure') error('Failure after partial output')
  else if (mode === 'exit-error') {
    process.stderr.write('CLI process failed')
    process.exitCode = 2
  } else {
    if (provider === 'codex') send({ type: 'turn.completed' }, false)
    else
      send(
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          ...(mode === 'missing-id' ? {} : { session_id: id }),
          result: text,
        },
        false,
      )
  }
}
