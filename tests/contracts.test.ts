import { describe, expect, it } from 'vitest'
import { validateCreateAgentInput } from '../src/shared/types'

describe('Contracts and Validation', () => {
  it('valida entrada correta para criação de agente', () => {
    const valid = validateCreateAgentInput({
      name: ' Dev Bot ',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: ' /home/user/project ',
      instructions: ' Ajude no código ',
    })

    expect(valid).toEqual({
      name: 'Dev Bot',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/home/user/project',
      instructions: 'Ajude no código',
    })
  })

  it('rejeita nome vazio', () => {
    expect(() =>
      validateCreateAgentInput({
        name: '   ',
        provider: 'codex',
        model: 'gpt-4o',
        workspacePath: '/home',
      }),
    ).toThrow('O nome do agente é obrigatório')
  })

  it('rejeita provedor desconhecido', () => {
    expect(() =>
      validateCreateAgentInput({
        name: 'Bot',
        provider: 'invalid-provider',
        model: 'model',
        workspacePath: '/home',
      }),
    ).toThrow('Provedor inválido')
  })

  it('rejeita workspace vazio', () => {
    expect(() =>
      validateCreateAgentInput({
        name: 'Bot',
        provider: 'codex',
        model: 'gpt-4o',
        workspacePath: '',
      }),
    ).toThrow('O caminho do workspace é obrigatório')
  })
})
