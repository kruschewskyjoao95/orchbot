#!/usr/bin/env node
// Claude falso no modo --permission-prompt-tool stdio: pede permissão para um Bash e
// responde com o que o host decidiu. Grava os argumentos em args.json.
import fs from 'node:fs'
import { createInterface } from 'node:readline'
fs.writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))
const session = '11111111-2222-4333-8444-555555555555'
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`)
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.type === 'user') {
    out({ type: 'system', subtype: 'init', session_id: session })
    out({
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'tool-1',
        description: 'Apagar a pasta build',
        input: { command: 'rm -rf build' },
      },
    })
  } else if (m.type === 'control_response') {
    const r = m.response.response
    out({
      type: 'result',
      subtype: 'success',
      session_id: session,
      result: `${r.behavior}:${r.message ?? r.updatedInput.command}`,
    })
  }
})
