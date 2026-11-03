import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createDefaultAgentWorkspace } from '../src/main/agent-workspace'

it('cria uma pasta por agente e não reaproveita a de outro com o mesmo nome', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'))
  const a = createDefaultAgentWorkspace(path.join(root, 'Orchbot'), 'Revisor de Código')
  const b = createDefaultAgentWorkspace(path.join(root, 'Orchbot'), 'Revisor de Código')
  expect(a).toBe(path.join(root, 'Orchbot', 'revisor-de-codigo'))
  expect(b).toBe(path.join(root, 'Orchbot', 'revisor-de-codigo-2'))
  expect(fs.statSync(b).isDirectory()).toBe(true)
  expect(path.basename(createDefaultAgentWorkspace(root, '***'))).toBe('agente')
})
