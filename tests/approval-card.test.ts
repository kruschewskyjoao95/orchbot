import { describe, expect, it } from 'vitest'
import { approvalReceipt, mergeChatItems, waitingOnYou } from '../src/renderer/src/approval-card'
import type { Approval, Message } from '../src/shared/types'

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  threadId: 'th',
  role: 'assistant',
  text: 'Rascunho pronto.',
  createdAt: '2026-11-06T12:00:00.000Z',
  ...over,
})

const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'a1',
  agentId: 'ag',
  threadId: 'th',
  text: 'Enviar e-mail para ana@ex.com',
  status: 'pending',
  kind: 'permission',
  createdAt: '2026-11-06T12:00:01.000Z',
  ...over,
})

describe('cartão no fio da conversa', () => {
  it('encaixa o pedido depois da resposta do agente, na ordem do tempo', () => {
    const later = message({
      id: 'm2',
      role: 'user',
      text: 'ok',
      createdAt: '2026-11-06T12:00:02.000Z',
    })
    expect(mergeChatItems([later, message()], [approval()])).toEqual([
      { type: 'message', message: message() },
      { type: 'approval', approval: approval() },
      { type: 'message', message: later },
    ])
  })

  it('recibo de permissão e de pergunta depois da decisão', () => {
    expect(approvalReceipt(approval({ status: 'approved' }))).toBe(
      'Aprovado: Enviar e-mail para ana@ex.com',
    )
    expect(approvalReceipt(approval({ status: 'declined' }))).toBe(
      'Recusado: Enviar e-mail para ana@ex.com',
    )
    expect(
      approvalReceipt(
        approval({
          kind: 'question',
          text: 'Qual ambiente?',
          status: 'approved',
          note: 'staging',
        }),
      ),
    ).toBe('Respondeu: staging')
    expect(
      approvalReceipt(approval({ kind: 'question', text: 'Qual ambiente?', status: 'declined' })),
    ).toBe('Pergunta pulada: Qual ambiente?')
  })
})

describe('Aguardando você', () => {
  it('pedido pendente pede a pessoa mesmo com a fila ociosa', () => {
    expect(waitingOnYou('idle', false)).toBe(false)
    expect(waitingOnYou('idle', true)).toBe(true)
    expect(waitingOnYou('failed', false)).toBe(true)
    expect(waitingOnYou('responded', true)).toBe(true)
  })
})
