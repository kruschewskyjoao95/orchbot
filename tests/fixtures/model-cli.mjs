#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
const models = JSON.parse(
  readFileSync(
    path.join(
      process.argv.includes('app-server') ? process.env.CODEX_HOME : process.env.CLAUDE_CONFIG_DIR,
      'catalog.json',
    ),
    'utf8',
  ),
)
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: {} })
  else if (message.method === 'model/list')
    send({
      id: message.id,
      result: {
        data: message.params.cursor ? models.slice(1) : models.slice(0, 1),
        nextCursor: message.params.cursor ? null : 'page-2',
      },
    })
  else if (message.type === 'control_request')
    send({
      type: 'control_response',
      response: { subtype: 'success', request_id: message.request_id, response: { models } },
    })
})
