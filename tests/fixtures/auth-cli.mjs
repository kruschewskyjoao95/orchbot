#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const mode = path.basename(process.argv[1])
appendFileSync(path.join(path.dirname(process.argv[1]), 'calls.jsonl'), `${JSON.stringify(args)}\n`)
if (args[0] === '--version') {
  if (mode === 'version-error') {
    process.stderr.write('private diagnostic')
    process.exitCode = 1
  } else console.log(`fake-cli 1.2.3 ${mode === 'secret-version' ? process.env.CODEX_API_KEY : ''}`)
} else if (mode === 'timeout') {
  setInterval(() => {}, 1000)
} else if (mode === 'unsupported') {
  process.stderr.write('error: unknown command auth')
  process.exitCode = 2
} else if (mode === 'broken') {
  process.stderr.write(`Configuration failed; private ${process.env.CODEX_API_KEY}`)
  process.exitCode = 1
} else if (mode === 'malformed') {
  console.log('not valid status JSON')
} else if (args[0] === 'login') {
  if (mode === 'logged-out') {
    process.stderr.write('Not logged in')
    process.exitCode = 1
  } else
    process.stderr.write(`Logged in using an API key: ${process.env.CODEX_API_KEY ?? 'not-shown'}`)
} else if (args[0] === 'usage') {
  console.log(
    JSON.stringify(
      mode === 'logged-out'
        ? { schemaVersion: 1, allowance: null, reason: 'not_authenticated' }
        : mode === 'inconclusive'
          ? { schemaVersion: 1, allowance: null, reason: null }
          : { schemaVersion: 1, allowance: { tier: 'test' } },
    ),
  )
} else if (args.includes('list')) {
  console.log(
    JSON.stringify(
      mode === 'logged-out'
        ? []
        : [
            {
              id: 'anthropic',
              connections: [
                { type: 'credential', label: 'private-account', secret: 'private-stored-secret' },
              ],
            },
          ],
    ),
  )
} else if (args.includes('check')) {
  const status = mode === 'logged-out' ? 'not_ready' : mode === 'invalid' ? 'invalid' : 'ready'
  console.log(JSON.stringify({ status, provider: 'test', reason: 'private diagnostic' }))
  process.exitCode = status === 'not_ready' ? 1 : status === 'invalid' ? 2 : 0
} else {
  console.log(
    JSON.stringify({
      loggedIn:
        mode === 'environment'
          ? process.env.ANTHROPIC_API_KEY === 'runtime-secret'
          : mode !== 'logged-out',
      authMethod: 'api_key',
      email: 'private@example.com',
      apiKey: 'private-stored-secret',
    }),
  )
  if (mode === 'logged-out') process.exitCode = 1
}
