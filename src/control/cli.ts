import { controlInput } from '../backend/control/contract'
import { callControl } from './client'
import { createMcpHandler } from './mcp'

async function main() {
  const [command, file = process.env.ORCHBOT_CONTROL_FILE, json = '{}'] = process.argv.slice(2)
  if (!command || !file)
    throw new Error(
      'Uso: control.js <list_agents|send_task|get_task|cancel_task|mcp> <control.json> [argumentos JSON]',
    )
  const call = (method: string, args: unknown) => callControl(file, method, args)
  if (command !== 'mcp') {
    process.stdout.write(
      `${JSON.stringify(await call(command, controlInput(command, JSON.parse(json))))}\n`,
    )
    return
  }
  const handle = createMcpHandler(call)
  // Limite antes de separar linhas: um cliente não pode acumular stdin sem fim.
  process.stdin.setEncoding('utf8')
  let buffered = ''
  for await (const chunk of process.stdin) {
    buffered += chunk.toString('utf8')
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      if (newline > 128000) throw new Error('Mensagem MCP muito grande.')
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      let reply: unknown
      try {
        reply = await handle(JSON.parse(line))
      } catch {
        reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
      }
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
      newline = buffered.indexOf('\n')
    }
    if (buffered.length > 128000) throw new Error('Mensagem MCP muito grande.')
  }
}
void main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
