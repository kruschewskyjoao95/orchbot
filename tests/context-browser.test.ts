import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseBrowserDirectives,
  stripBrowserDirectives,
  summarizeBrowserResult,
} from '../src/backend/browser/browser-protocol'
import {
  buildThreadContext,
  capRulesContent,
  estimateTokens,
} from '../src/backend/context/context-builder'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Message, SupportedProvider } from '../src/shared/types'

function msg(role: 'user' | 'assistant', text: string, n: number): Message {
  return { id: `m${n}`, threadId: 't', role, text, createdAt: new Date(n * 1000).toISOString() }
}

describe('Economia de tokens — contexto da conversa', () => {
  const history = Array.from({ length: 30 }, (_, i) =>
    msg(
      i % 2 === 0 ? 'user' : 'assistant',
      `mensagem número ${i} com um texto razoavelmente longo para testar truncamento`,
      i,
    ),
  )

  it('modo econômico é bem menor que o completo e resume as antigas', () => {
    const eco = buildThreadContext(history, 'economico')
    const full = buildThreadContext(history, 'completo')
    expect(eco.estimatedTokens).toBeLessThan(full.estimatedTokens / 2)
    expect(eco.summarizedMessages).toBeGreaterThan(0)
    expect(eco.text).toContain('RESUMO DAS MENSAGENS ANTERIORES')
    expect(estimateTokens('12345678')).toBe(3)
  })

  it('regras do projeto são capadas no modo econômico', () => {
    const rules = 'x'.repeat(5000)
    expect(capRulesContent(rules, 'economico').length).toBeLessThan(1400)
    expect(capRulesContent(rules, 'completo')).toBe(rules)
    expect(capRulesContent('x'.repeat(150_000), 'completo').length).toBeLessThan(61_000)
  })

  it('persiste modo de contexto e acesso ao navegador do robô', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-ctx-'))
    const db = new OrchbotDatabase(path.join(tmp, 't.db'))
    const agent = db.createAgent({
      name: 'Ads',
      description: 'Analisa Meta Ads',
      provider: 'antigravity',
      model: 'm',
      workspacePath: tmp,
      contextMode: 'economico',
      browserAccess: true,
    })
    expect(agent.contextMode).toBe('economico')
    expect(db.getAgent(agent.id)?.contextMode).toBe('economico')
    const off = db.updateAgent({ id: agent.id, browserAccess: false, contextMode: 'completo' })
    expect(off.browserAccess).toBe(false)
    expect(off.contextMode).toBe('completo')
    db.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

describe('Protocolo de navegador do robô', () => {
  it('extrai comandos open/inspect/fill e limpa o texto', () => {
    const text =
      'Vou abrir o painel.\n[[BROWSER:open]] https://ads.google.com [[/BROWSER]]\n[[BROWSER:inspect]] [[/BROWSER]]\n[[BROWSER:fill]] #email :: a@b.com [[/BROWSER]]'
    expect(parseBrowserDirectives(text)).toEqual([
      { action: 'open', target: 'https://ads.google.com' },
      { action: 'inspect', target: undefined },
      { action: 'fill', target: '#email', value: 'a@b.com' },
    ])
    expect(stripBrowserDirectives(text)).toBe('Vou abrir o painel.')
  })

  it('resumo do inspect é truncado para economizar tokens', () => {
    const summary = summarizeBrowserResult('inspect', {
      title: 'Google Ads',
      url: 'https://ads.google.com',
      textSummary: 'cliques '.repeat(500),
      links: [],
      inputs: [{ selector: '#q' }],
    })
    expect(summary.length).toBeLessThanOrEqual(1500)
    expect(summary).toContain('Google Ads')
  })
})

describe('Robô abre o navegador durante o turno', () => {
  let tmpDir: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-browserbot-'))
    db = new OrchbotDatabase(path.join(tmpDir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('robô de Ads abre o painel, recebe as métricas e responde ao usuário', async () => {
    const agent = db.createAgent({
      name: 'Ads Analyst',
      description: 'Analisa métricas de Google Ads',
      provider: 'antigravity',
      model: 'fake',
      workspacePath: tmpDir,
      contextMode: 'economico',
      browserAccess: true,
    })

    const adapter: ProviderAdapter = {
      id: 'antigravity' as SupportedProvider,
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        // O robô só analisa depois que o resultado do navegador volta
        if (prompt.includes('[RESULTADO DO NAVEGADOR]')) {
          expect(options.instructions).toContain('[NAVEGADOR EMBUTIDO]')
          setTimeout(() => callbacks.onDone('Suas campanhas tiveram 1.240 cliques hoje.'), 5)
        } else {
          setTimeout(
            () =>
              callbacks.onDone(
                'Vou consultar o painel.\n[[BROWSER:open]] https://ads.google.com [[/BROWSER]]\n[[BROWSER:inspect]] [[/BROWSER]]',
              ),
            5,
          )
        }
        return { interrupt: () => {} }
      },
    }

    const registry = new ProviderRegistry()
    registry.registerAdapter(adapter)
    const queue = new QueueManager(db, registry, {})
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    queue.setBrowserExecutor(async (_agentId, toolName, args) => {
      calls.push({ tool: toolName, args })
      if (toolName === 'orchbot_browser.inspect') {
        return {
          title: 'Google Ads — Visão geral',
          url: 'https://ads.google.com',
          textSummary: 'Cliques: 1.240 | CTR: 4,2% | Custo: R$ 312',
          links: [],
          inputs: [],
        }
      }
      return { url: 'https://ads.google.com', title: 'Google Ads' }
    })

    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')
    queue.enqueue(agent.id, thread.id, 'Como estão minhas campanhas hoje?')

    await vi.waitFor(
      () => {
        const messages = db.listMessages(thread.id)
        expect(messages.some((m) => m.text.includes('1.240 cliques'))).toBe(true)
      },
      { timeout: 8000, interval: 50 },
    )
    expect(calls.map((c) => c.tool)).toEqual(['orchbot_browser.open', 'orchbot_browser.inspect'])
    queue.close()
  })

  it('segura o próximo pedido até o resultado da página entrar na frente', async () => {
    const agent = db.createAgent({
      name: 'Ads Analyst',
      description: 'Analisa métricas de Google Ads',
      provider: 'antigravity',
      model: 'fake',
      workspacePath: tmpDir,
      contextMode: 'economico',
      browserAccess: true,
    })
    const prompts: string[] = []
    let finishFirst: (() => void) | undefined
    const adapter: ProviderAdapter = {
      id: 'antigravity' as SupportedProvider,
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, _options, callbacks) => {
        prompts.push(prompt)
        if (prompt.includes('[RESULTADO DO NAVEGADOR]')) {
          setTimeout(() => callbacks.onDone('Vi 9 cliques no painel.'), 0)
        } else if (prompts.length === 1) {
          finishFirst = () => callbacks.onDone('Vou olhar.\n[[BROWSER:inspect]] [[/BROWSER]]')
        } else {
          setTimeout(() => callbacks.onDone(`Resposta de: ${prompt}`), 0)
        }
        return { interrupt: () => {} }
      },
    }
    const registry = new ProviderRegistry()
    registry.registerAdapter(adapter)
    const queue = new QueueManager(db, registry, {})
    let releaseBrowser: () => void = () => {}
    const browserGate = new Promise<void>((resolve) => {
      releaseBrowser = resolve
    })
    queue.setBrowserExecutor(async () => {
      await browserGate
      return {
        title: 'Painel',
        url: 'https://ads.example',
        textSummary: 'cliques 9',
        links: [],
        inputs: [],
      }
    })

    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')
    queue.enqueue(agent.id, thread.id, 'Olhe o painel')
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    queue.enqueue(agent.id, thread.id, 'Pedido que já estava na fila')
    finishFirst?.()
    queue.enqueue(agent.id, thread.id, 'Mensagem no meio do clique')

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(prompts).toEqual(['Olhe o painel'])

    releaseBrowser()
    await vi.waitFor(() => expect(prompts).toHaveLength(4), { timeout: 8000 })
    expect(prompts[1]).toContain('[RESULTADO DO NAVEGADOR]')
    expect(prompts[1]).toContain('cliques 9')
    expect(prompts[2]).toBe('Pedido que já estava na fila')
    expect(prompts[3]).toBe('Mensagem no meio do clique')
    queue.close()
  })

  it('quatro passos no navegador rodam; o quinto volta no resultado', async () => {
    const agent = db.createAgent({
      name: 'Ads Analyst',
      description: 'Analisa métricas',
      provider: 'antigravity',
      model: 'fake',
      workspacePath: tmpDir,
      browserAccess: true,
    })
    const prompts: string[] = []
    const adapter: ProviderAdapter = {
      id: 'antigravity' as SupportedProvider,
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, _options, callbacks) => {
        prompts.push(prompt)
        const seen = prompts.filter((item) => item.includes('[RESULTADO DO NAVEGADOR]')).length
        const reply = prompt.includes('Limite de')
          ? 'Parei no limite.'
          : seen < 4
            ? '[[BROWSER:inspect]] [[/BROWSER]]'
            : '[[BROWSER:click]] #enviar [[/BROWSER]]'
        setTimeout(() => callbacks.onDone(reply), 0)
        return { interrupt: () => {} }
      },
    }
    const registry = new ProviderRegistry()
    registry.registerAdapter(adapter)
    const queue = new QueueManager(db, registry, {})
    const calls: string[] = []
    queue.setBrowserExecutor(async (_id, toolName) => {
      calls.push(toolName)
      return {
        title: 'Painel',
        url: 'https://ads.example',
        textSummary: 'ok',
        links: [],
        inputs: [],
      }
    })
    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')
    queue.enqueue(agent.id, thread.id, 'leia a página em quatro passos')

    await vi.waitFor(
      () => {
        expect(db.listMessages(thread.id).some((m) => m.text.includes('Parei no limite.'))).toBe(
          true,
        )
      },
      { timeout: 8000, interval: 20 },
    )
    expect(calls).toEqual([
      'orchbot_browser.inspect',
      'orchbot_browser.inspect',
      'orchbot_browser.inspect',
      'orchbot_browser.inspect',
    ])
    expect(
      prompts.some(
        (prompt) =>
          prompt.includes('[RESULTADO DO NAVEGADOR]') &&
          prompt.includes('Limite de 4 rodadas no navegador') &&
          prompt.includes('Este comando não rodou.'),
      ),
    ).toBe(true)
    queue.close()
  })
})
