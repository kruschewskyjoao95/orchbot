import { describe, expect, it } from 'vitest'
import { agentPreview, isAgentUnread, sortSidebarAgents } from '../src/renderer/src/sidebar-row'

describe('linha da barra lateral', () => {
  it('mostra o recorte da última mensagem em vez da descrição', () => {
    expect(agentPreview('Rascunho pronto para a Ana.', 'Especialista em e-mail')).toBe(
      'Rascunho pronto para a Ana.',
    )
    expect(agentPreview('linha um\nlinha dois', 'desc')).toBe('linha um linha dois')
    expect(agentPreview(undefined, 'Especialista em e-mail')).toBe('Especialista em e-mail')
    expect(agentPreview('', '')).toBe('Pronto para ajudar')
    expect(agentPreview(`ok ${'x'.repeat(90)}`)).toBe(`ok ${'x'.repeat(77)}`)
  })

  it('não lido inclui pedido pendente', () => {
    expect(isAgentUnread({ unread: true, pendingApproval: false })).toBe(true)
    expect(isAgentUnread({ unread: false, pendingApproval: true })).toBe(true)
    expect(isAgentUnread({ unread: false, pendingApproval: false })).toBe(false)
  })

  it('fixados ficam na frente, na ordem original entre si', () => {
    expect(
      sortSidebarAgents([
        { id: 'a', pinned: false },
        { id: 'b', pinned: true },
        { id: 'c', pinned: false },
        { id: 'd', pinned: true },
      ]).map((row) => row.id),
    ).toEqual(['b', 'd', 'a', 'c'])
  })
})
