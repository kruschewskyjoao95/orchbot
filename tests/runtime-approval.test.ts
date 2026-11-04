import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseRuntimePayload,
  runtimeApprovalText,
} from '../src/backend/approvals/approval-protocol'
import { browserBatchNeedsApproval } from '../src/backend/browser/browser-protocol'
import { computerBatchNeedsApproval } from '../src/backend/computer/computer-protocol'
import type { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { AutonomyLevel } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

describe('o que precisa de aprovação', () => {
  it('segura o lote inteiro quando há clique, preenchimento, fechar, shell, digitar ou tecla', () => {
    expect(browserBatchNeedsApproval([{ action: 'open', target: 'https://x' }])).toBe(false)
    expect(browserBatchNeedsApproval([{ action: 'inspect' }])).toBe(false)
    expect(browserBatchNeedsApproval([{ action: 'screenshot' }])).toBe(false)
    expect(browserBatchNeedsApproval([{ action: 'click', target: '#ok' }])).toBe(true)
    expect(browserBatchNeedsApproval([{ action: 'fill', target: '#a', value: 'b' }])).toBe(true)
    expect(browserBatchNeedsApproval([{ action: 'close', target: '1' }])).toBe(true)
    expect(
      browserBatchNeedsApproval([{ action: 'inspect' }, { action: 'click', target: '#ok' }]),
    ).toBe(true)

    expect(computerBatchNeedsApproval([{ action: 'apps' }])).toBe(false)
    expect(computerBatchNeedsApproval([{ action: 'screenshot' }])).toBe(false)
    expect(computerBatchNeedsApproval([{ action: 'open', target: 'firefox' }])).toBe(true)
    expect(computerBatchNeedsApproval([{ action: 'click', x: 1, y: 2 }])).toBe(true)
    expect(computerBatchNeedsApproval([{ action: 'type', target: 'oi' }])).toBe(true)
    expect(computerBatchNeedsApproval([{ action: 'key', target: 'Return' }])).toBe(true)
    expect(parseRuntimePayload('')).toBeUndefined()
    expect(parseRuntimePayload('{')).toBeUndefined()
    expect(
      runtimeApprovalText({
        kind: 'computer',
        directives: [{ action: 'open', target: 'firefox' }],
      }),
    ).toContain('shell')
  })
})

describe('aprovação no runtime, modo cauteloso', () => {
  let db: OrchbotDatabase
  let queue: QueueManager

  afterEach(() => {
    queue.close()
    db.close()
  })

  const boot = (autonomy: AutonomyLevel, computer: boolean, firstReply: string) => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    const prompts: string[] = []
    const calls: { kind: string; action: string; args: Record<string, unknown> }[] = []
    const adapter: ProviderAdapter = {
      id: 'codex',
      name: 'Mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, _options, callbacks) => {
        prompts.push(prompt)
        const done =
          prompt.includes('[RESPOSTA DA APROVAÇÃO]') || prompt.includes('[RESULTADO')
            ? 'Pronto.'
            : firstReply
        setTimeout(() => callbacks.onDone(done), 1)
        return { interrupt: () => {} }
      },
    }
    const registry = {
      getAdapter: () => adapter,
      registerActiveExecution() {},
      removeActiveExecution() {},
      interruptThread: () => true,
    } as unknown as ProviderRegistry
    queue = new QueueManager(db, registry)
    queue.setComputerExecutor(async (_id, action, args) => {
      calls.push({ kind: 'computer', action, args })
      return 'ok'
    })
    queue.setBrowserExecutor(async (_id, tool, args) => {
      calls.push({ kind: 'browser', action: tool, args })
      return { success: true }
    })
    const agent = db.createAgent({
      name: 'Ana',
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/runtime-approval',
      autonomyLevel: autonomy,
      computerUse: computer,
    })
    const thread = db.listThreads(agent.id)[0].id
    queue.enqueue(agent.id, thread, 'faça')
    return { prompts, calls, thread }
  }

  it('não clica nem abre app até aprovar, e então o runtime executa o lote', async () => {
    const { prompts, calls, thread } = boot(
      'cautious',
      true,
      'Vou agir.\n[[COMPUTER:apps]] [[/COMPUTER]]\n[[COMPUTER:click]] 10, 20 [[/COMPUTER]]\n[[COMPUTER:open]] firefox [[/COMPUTER]]',
    )
    await vi.waitFor(() => expect(db.listPendingApprovals()).toHaveLength(1))
    expect(calls).toEqual([])
    const [approval] = db.listPendingApprovals()
    expect(approval.text).toContain('Clicar em 10, 20')
    expect(approval.text).toContain('Abrir o app pelo shell: firefox')
    expect(approval.text).toContain('Listar janelas')
    expect(approval.payloadJson).toContain('"kind":"computer"')
    const visible = db.listMessages(thread).find((m) => m.role === 'assistant')
    expect(visible?.text).toBe('Vou agir.')
    expect(prompts).toHaveLength(1)

    queue.decideApproval(approval.id, true)
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(calls.map((call) => call.action)).toEqual(['apps', 'click', 'open'])
    expect(calls[1]?.args).toEqual({ x: 10, y: 20 })
    expect(calls[2]?.args).toEqual({ app: 'firefox' })
    expect(prompts[1]).toContain('[RESULTADO DO COMPUTADOR]')
    expect(prompts[1]).toContain('já executou')
    expect(prompts[1]).not.toContain('Pode executar')
    expect(db.listPendingApprovals()).toHaveLength(0)
  })

  it('recusar não executa o clique', async () => {
    const { prompts, calls } = boot('cautious', true, '[[COMPUTER:click]] 3, 4 [[/COMPUTER]]')
    await vi.waitFor(() => expect(db.listPendingApprovals()).toHaveLength(1))
    queue.decideApproval(db.listPendingApprovals()[0].id, false)
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(calls).toEqual([])
    expect(prompts[1]).toContain('RECUSADO')
    expect(prompts[1]).toContain('Não execute')
  })

  it('leitura do computador segue na hora', async () => {
    const { prompts, calls } = boot('cautious', true, '[[COMPUTER:apps]] [[/COMPUTER]]')
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(calls.map((call) => call.action)).toEqual(['apps'])
    expect(db.listPendingApprovals()).toHaveLength(0)
    expect(prompts[1]).toContain('[RESULTADO DO COMPUTADOR]')
  })

  it('modo autônomo clica sem card', async () => {
    const { prompts, calls } = boot('autonomous', true, '[[COMPUTER:click]] 8, 9 [[/COMPUTER]]')
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(calls.map((call) => call.action)).toEqual(['click'])
    expect(db.listPendingApprovals()).toHaveLength(0)
  })

  it('segura inspecionar junto com preencher e executa os dois depois do aprovado', async () => {
    const { prompts, calls } = boot(
      'cautious',
      false,
      '[[BROWSER:inspect]] [[/BROWSER]]\n[[BROWSER:fill]] #email :: ana@ex.com [[/BROWSER]]',
    )
    await vi.waitFor(() => expect(db.listPendingApprovals()).toHaveLength(1))
    expect(calls).toEqual([])
    expect(db.listPendingApprovals()[0].text).toContain('Preencher #email')
    queue.decideApproval(db.listPendingApprovals()[0].id, true)
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(calls.map((call) => call.action)).toEqual([
      'orchbot_browser.inspect',
      'orchbot_browser.fill',
    ])
    expect(calls[1]?.args).toEqual({ selector: '#email', value: 'ana@ex.com' })
    expect(prompts[1]).toContain('[RESULTADO DO NAVEGADOR]')
    expect(prompts[1]).not.toContain('Pode executar')
  })

  it('só inspecionar no modo cauteloso roda na hora', async () => {
    const { prompts, calls } = boot('cautious', false, '[[BROWSER:inspect]] [[/BROWSER]]')
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(calls.map((call) => call.action)).toEqual(['orchbot_browser.inspect'])
    expect(db.listPendingApprovals()).toHaveLength(0)
  })
})
