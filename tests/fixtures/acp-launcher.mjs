import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const child = spawn(
  process.execPath,
  [new URL('./acp-agent.mjs', import.meta.url).pathname, 'hang-prompt', process.argv[2]],
  { stdio: 'inherit' },
)
writeFileSync(`${process.argv[2]}.pids`, JSON.stringify([process.pid, child.pid]))
// Exercise forced cleanup of a launcher that ignores graceful termination.
process.on('SIGTERM', () => {})
