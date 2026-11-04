import { expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { MAX_AGENT_INSTRUCTIONS } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

const agentInput = (instructions: string) => ({
  name: 'Limite',
  provider: 'codex' as const,
  model: 'gpt-4o',
  workspacePath: '/tmp/limit-test',
  instructions,
})

it('instruções do robô: até 2000 caracteres passam; acima, criar e editar recusam', () => {
  const db = new OrchbotDatabase(':memory:', testSecretStorage)
  const ok = 'a'.repeat(MAX_AGENT_INSTRUCTIONS)
  const tooLong = `${ok}b`

  const agent = db.createAgent(agentInput(ok))
  expect(agent.instructions).toBe(ok)
  expect(() => db.createAgent(agentInput(tooLong))).toThrow('2000')
  expect(() => db.updateAgent({ id: agent.id, instructions: tooLong })).toThrow('2000')
  // Mudar outro campo não esbarra no limite.
  expect(db.updateAgent({ id: agent.id, name: 'Outro' }).instructions).toBe(ok)
  db.close()
})
