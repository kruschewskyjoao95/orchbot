import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseComputerDirectives,
  stripComputerDirectives,
} from '../src/backend/computer/computer-protocol'
import {
  checkComputerUse,
  executeComputerAction,
  openArgv,
} from '../src/backend/computer/computer-tools'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { type SupportedProvider, effectiveCapabilities } from '../src/shared/types'

describe('Uso do computador — protocolo e status', () => {
  it('extrai comandos apps/screenshot/click/type e limpa o texto', () => {
    const text =
      'Vou olhar.\n[[COMPUTER:apps]] [[/COMPUTER]]\n[[COMPUTER:click]] 640, 420 [[/COMPUTER]]\n[[COMPUTER:type]] olá [[/COMPUTER]]'
    expect(parseComputerDirectives(text)).toEqual([
      { action: 'apps' },
      { action: 'click', x: 640, y: 420 },
      { action: 'type', target: 'olá' },
    ])
    expect(stripComputerDirectives(text)).toBe('Vou olhar.')
  })

  it('abrir aplicativo separa o comando e recusa shell', async () => {
    expect(openArgv('firefox --new-window https://example.com')).toEqual({
      file: 'firefox',
      args: ['--new-window', 'https://example.com'],
    })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-open-'))
    await expect(executeComputerAction('open', { app: "bash -c 'id'" }, tmp)).rejects.toThrow(
      'Não abro um shell',
    )
    await expect(
      executeComputerAction('open', { app: 'env /bin/bash -c id' }, tmp),
    ).rejects.toThrow('Não abro um shell')
    for (const app of ['firefox; id', 'firefox | id', 'firefox && id', 'firefox `id`']) {
      await expect(executeComputerAction('open', { app }, tmp)).rejects.toThrow('metacaractere')
    }
    await expect(
      executeComputerAction('open', { app: 'orchbot-app-que-nao-existe' }, tmp),
    ).rejects.toThrow('ENOENT')
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('sem ydotool nem xdotool o clique devolve erro, mesmo com hyprctl', async () => {
    const ydotool = spawnSync('which', ['ydotool'], { encoding: 'utf8' })
    const xdotool = spawnSync('which', ['xdotool'], { encoding: 'utf8' })
    if (ydotool.status === 0 || xdotool.status === 0) return
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-click-'))
    await expect(executeComputerAction('click', { x: 3, y: 4 }, tmp)).rejects.toThrow(
      'sem ydotool ou xdotool',
    )
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('status responde com ferramentas detectadas sem quebrar', async () => {
    const status = await checkComputerUse()
    expect(typeof status.ready).toBe('boolean')
    expect(status.message.length).toBeGreaterThan(10)
    expect(status.platform).toBe(process.platform)
  })
})

describe('Robô usa o computador quando habilitado', () => {
  let tmpDir: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-computer-'))
    db = new OrchbotDatabase(path.join(tmpDir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('padrão desligado; robô habilitado lista apps e responde', async () => {
    db.updateSettings({ computerUseEnabled: false })
    const agent = db.createAgent({
      name: 'Desktop',
      provider: 'codex',
      model: 'fake',
      workspacePath: tmpDir,
      computerUse: true,
    })
    expect(effectiveCapabilities(agent, db.getSettings()).computerUse).toBe(true)

    const adapter: ProviderAdapter = {
      id: 'codex' as SupportedProvider,
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        if (prompt.includes('[RESULTADO DO COMPUTADOR]')) {
          expect(options.instructions).toContain('[USO DO COMPUTADOR]')
          setTimeout(() => callbacks.onDone('Você tem 2 janelas abertas.'), 5)
        } else {
          setTimeout(() => callbacks.onDone('Vou ver a tela.\n[[COMPUTER:apps]] [[/COMPUTER]]'), 5)
        }
        return { interrupt: () => {} }
      },
    }
    const registry = new ProviderRegistry()
    registry.registerAdapter(adapter)
    const queue = new QueueManager(db, registry, {})
    const calls: string[] = []
    queue.setComputerExecutor(async (_id, action) => {
      calls.push(action)
      return '- firefox: "Google" em 0,0 tamanho 800x600'
    })

    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')
    queue.enqueue(agent.id, thread.id, 'o que está aberto aí?')

    await vi.waitFor(
      () => {
        const messages = db.listMessages(thread.id)
        expect(messages.some((m) => m.text.includes('2 janelas abertas'))).toBe(true)
      },
      { timeout: 8000, interval: 50 },
    )
    expect(calls).toEqual(['apps'])
    queue.close()
  })

  it('busca na memória não gasta o computador: quatro passos rodam e o quinto volta no resultado', async () => {
    const agent = db.createAgent({
      name: 'Desktop',
      provider: 'codex',
      model: 'fake',
      workspacePath: tmpDir,
      computerUse: true,
    })
    const prompts: string[] = []
    const adapter: ProviderAdapter = {
      id: 'codex' as SupportedProvider,
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, _options, callbacks) => {
        prompts.push(prompt)
        const computerTurns = prompts.filter((item) =>
          item.includes('[RESULTADO DO COMPUTADOR]'),
        ).length
        let reply: string
        if (prompt.includes('Limite de')) reply = 'O quinto clique não rodou.'
        else if (!prompt.includes('[RESULTADO'))
          reply = 'Vou buscar e olhar.\n[[MEMORY:search]] janelas [[/MEMORY]]'
        else if (computerTurns === 0) reply = '[[COMPUTER:apps]] [[/COMPUTER]]'
        else if (computerTurns === 1) reply = '[[COMPUTER:screenshot]] [[/COMPUTER]]'
        else if (computerTurns === 2) reply = '[[COMPUTER:click]] 10, 20 [[/COMPUTER]]'
        else if (computerTurns === 3) reply = '[[COMPUTER:screenshot]] [[/COMPUTER]]'
        else reply = '[[COMPUTER:click]] 30, 40 [[/COMPUTER]]'
        setTimeout(() => callbacks.onDone(reply), 0)
        return { interrupt: () => {} }
      },
    }
    const registry = new ProviderRegistry()
    registry.registerAdapter(adapter)
    const queue = new QueueManager(db, registry, {})
    const calls: string[] = []
    queue.setComputerExecutor(async (_id, action) => {
      calls.push(action)
      return 'ok'
    })
    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')
    queue.enqueue(agent.id, thread.id, 'liste, fotografe, clique e fotografe de novo')

    await vi.waitFor(
      () => {
        expect(
          db.listMessages(thread.id).some((m) => m.text.includes('O quinto clique não rodou.')),
        ).toBe(true)
      },
      { timeout: 8000, interval: 20 },
    )
    expect(calls).toEqual(['apps', 'screenshot', 'click', 'screenshot'])
    expect(prompts.some((prompt) => prompt.includes('[RESULTADO DA MEMÓRIA]'))).toBe(true)
    expect(
      prompts.some(
        (prompt) =>
          prompt.includes('[RESULTADO DO COMPUTADOR]') &&
          prompt.includes('Limite de 4 rodadas no computador') &&
          prompt.includes('Este comando não rodou.'),
      ),
    ).toBe(true)
    queue.close()
  })
})
