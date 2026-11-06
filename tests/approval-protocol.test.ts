import { describe, expect, it } from 'vitest'
import {
  approvalAnswerPrompt,
  parseApprovalRequests,
  parseQuestionRequests,
  stripApprovalRequests,
  stripQuestionRequests,
} from '../src/backend/approvals/approval-protocol'
import type { Approval } from '../src/shared/types'

const permission = (over: Partial<Approval> = {}): Approval => ({
  id: 'a1',
  agentId: 'ag',
  threadId: 'th',
  text: 'Enviar e-mail para ana@ex.com',
  status: 'pending',
  kind: 'permission',
  createdAt: '2026-11-06T12:00:00.000Z',
  ...over,
})

describe('blocos [[APROVAR]] e [[PERGUNTAR]]', () => {
  it('lê o pedido de aprovação e tira o bloco do texto visível', () => {
    const text = 'Rascunho pronto.\n[[APROVAR]]Enviar e-mail para ana@ex.com[[/APROVAR]]'
    expect(parseApprovalRequests(text)).toEqual(['Enviar e-mail para ana@ex.com'])
    expect(stripApprovalRequests(text)).toBe('Rascunho pronto.')
  })

  it('lê a pergunta, as opções e tira o bloco do texto visível', () => {
    const text = [
      'Preciso de uma escolha.',
      '[[PERGUNTAR]]',
      'Qual ambiente?',
      '- produção',
      '- staging',
      '* local',
      '[[/PERGUNTAR]]',
    ].join('\n')
    expect(parseQuestionRequests(text)).toEqual([
      { text: 'Qual ambiente?', options: ['produção', 'staging', 'local'] },
    ])
    expect(stripQuestionRequests(text)).toBe('Preciso de uma escolha.')
  })

  it('aceita pergunta só com texto livre e ignora bloco vazio', () => {
    const text = '[[PERGUNTAR]]Qual o prazo?[[/PERGUNTAR]]\n[[PERGUNTAR]]  [[/PERGUNTAR]]'
    expect(parseQuestionRequests(text)).toEqual([{ text: 'Qual o prazo?', options: [] }])
  })

  it('guarda no máximo seis opções', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `- o${i + 1}`)
    const [question] = parseQuestionRequests(
      `[[PERGUNTAR]]Escolha\n${lines.join('\n')}[[/PERGUNTAR]]`,
    )
    expect(question.options).toEqual(['o1', 'o2', 'o3', 'o4', 'o5', 'o6'])
  })
})

describe('prompt depois da resposta da pessoa', () => {
  it('aprovação continua com APROVADO ou RECUSADO', () => {
    expect(approvalAnswerPrompt(permission({ status: 'approved' }))).toContain('APROVADO')
    expect(approvalAnswerPrompt(permission({ status: 'declined' }))).toContain('RECUSADO')
  })

  it('pergunta continua com a escolha, não com APROVADO', () => {
    const answered = permission({
      kind: 'question',
      text: 'Qual ambiente?',
      status: 'approved',
      note: 'staging',
      options: ['produção', 'staging'],
    })
    const prompt = approvalAnswerPrompt(answered)
    expect(prompt).toContain('[RESPOSTA DA PERGUNTA]')
    expect(prompt).toContain('staging')
    expect(prompt).not.toContain('APROVADO')
  })
})
