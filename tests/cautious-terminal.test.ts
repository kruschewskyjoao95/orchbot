import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAdapter } from '../src/backend/providers/claude-adapter'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import type { ProviderRegistry } from '../src/backend/providers/registry'
import type {
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
} from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { AutonomyLevel } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const temp: string[] = []
afterEach(() => {
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function run(
  adapter: ProviderAdapter,
  cli: string,
  extra: Partial<ExecutionOptions>,
  onPermissionRequest?: ExecutionCallbacks['onPermissionRequest'],
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-cautious-'))
  temp.push(dir)
  return new Promise<{ text: string; args: string[] }>((resolve) => {
    const done = (text: string) =>
      resolve({ text, args: JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8')) })
    adapter.executeTurn(
      'apague o build',
      { workspacePath: dir, providerConfig: { cliPath: fixture(cli) }, ...extra },
      { onChunk: () => {}, onDone: done, onError: done, onPermissionRequest },
    )
  })
}

describe('Claude no modo cauteloso pergunta antes de cada ferramenta', () => {
  it('permitir roda o comando pedido', async () => {
    const ask = vi.fn().mockResolvedValue('allow')
    const { text, args } = await run(
      new ClaudeAdapter(),
      'claude-permission-cli.mjs',
      { permission: 'ask' },
      ask,
    )
    expect(text).toBe('allow:rm -rf build')
    expect(ask.mock.calls[0][0].toolCall).toMatchObject({
      title: 'Bash: Apagar a pasta build',
      rawInput: { command: 'rm -rf build' },
    })
    expect(args).toEqual(expect.arrayContaining(['--permission-prompt-tool', 'stdio']))
    expect(
      args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2),
    ).toEqual(['--permission-mode', 'manual'])
    // O prompt vai por stdin, não no argv.
    expect(args).not.toContain('apague o build')
  })

  it.each([
    ['recusar', 'deny'],
    ['fechar o diálogo', undefined],
  ])('%s não roda nada', async (_label, answer) => {
    const { text } = await run(
      new ClaudeAdapter(),
      'claude-permission-cli.mjs',
      { permission: 'ask' },
      vi.fn().mockResolvedValue(answer),
    )
    expect(text).toMatch(/^deny:A pessoa recusou/)
  })

  it('modo autônomo manda o prompt por stdin e não pergunta', async () => {
    const { args } = await run(new ClaudeAdapter(), 'args-cli.mjs', {})
    expect(args).not.toContain('--permission-prompt-tool')
    expect(args).not.toContain('apague o build')
  })
})

describe('Codex no modo cauteloso', () => {
  it.each([
    ['ask', ['-c', 'sandbox_mode="read-only"']],
    ['approved', ['-c', 'sandbox_mode="workspace-write"']],
  ] as const)('%s', async (permission, expected) => {
    const { args } = await run(new CodexAdapter(), 'args-cli.mjs', { permission })
    const at = args.indexOf(expected[1])
    expect(args.slice(at - 1, at + 1)).toEqual(expected)
  })

  it('autônomo não mexe no sandbox da pessoa', async () => {
    const { args } = await run(new CodexAdapter(), 'args-cli.mjs', {})
    expect(args.some((a) => a.startsWith('sandbox_mode='))).toBe(false)
  })
})

describe('fila: só o turno depois do APROVADO grava', () => {
  let db: OrchbotDatabase
  let queue: QueueManager
  afterEach(() => {
    queue?.close()
    db?.close()
  })

  const boot = (autonomy: AutonomyLevel) => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    const seen: { prompt: string; options: ExecutionOptions }[] = []
    const adapter: ProviderAdapter = {
      id: 'codex',
      name: 'Mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        seen.push({ prompt, options })
        const reply =
          seen.length === 1
            ? 'Preciso gravar.\n[[APROVAR]]rodar npm install[[/APROVAR]]'
            : 'Pronto.'
        setTimeout(() => callbacks.onDone(reply), 1)
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
    const agent = db.createAgent({
      name: 'Ana',
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/orchbot-cautious-agent',
      autonomyLevel: autonomy,
    })
    const thread = db.listThreads(agent.id)[0].id
    queue.enqueue(agent.id, thread, 'instale as dependências')
    return { seen, agent, thread }
  }

  it('cauteloso: pergunta, libera só o turno aprovado e volta a perguntar', async () => {
    const { seen, agent, thread } = boot('cautious')
    await vi.waitFor(() => expect(db.listPendingApprovals()).toHaveLength(1))
    expect(seen[0].options.permission).toBe('ask')
    expect(seen[0].options.instructions).toContain('Seu terminal está só leitura')

    queue.decideApproval(db.listPendingApprovals()[0].id, true)
    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen[1].options.permission).toBe('approved')

    queue.enqueue(agent.id, thread, 'e agora rode os testes')
    await vi.waitFor(() => expect(seen).toHaveLength(3))
    expect(seen[2].options.permission).toBe('ask')
  })

  it('recusado não libera a escrita', async () => {
    const { seen } = boot('cautious')
    await vi.waitFor(() => expect(db.listPendingApprovals()).toHaveLength(1))
    queue.decideApproval(db.listPendingApprovals()[0].id, false)
    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen[1].options.permission).toBe('ask')
  })

  it('autônomo não passa permissão nenhuma', async () => {
    const { seen } = boot('autonomous')
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[0].options.permission).toBeUndefined()
  })
})
