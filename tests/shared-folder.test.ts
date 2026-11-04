import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainService } from '../src/backend/brain/brain-service'
import { AcpAdapter } from '../src/backend/providers/acp-adapter'
import { ClaudeAdapter } from '../src/backend/providers/claude-adapter'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { CopilotAdapter } from '../src/backend/providers/copilot-adapter'
import { GeminiAdapter } from '../src/backend/providers/gemini-adapter'
import { GrokAdapter } from '../src/backend/providers/grok-adapter'
import { KimiAdapter } from '../src/backend/providers/kimi-adapter'
import type { ProviderRegistry } from '../src/backend/providers/registry'
import type { ExecutionOptions, ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

const argsCli = fileURLToPath(new URL('./fixtures/args-cli.mjs', import.meta.url))
const acpAgent = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url))
const SHARED = '/srv/projeto/shared'

const temp: string[] = []
const mkdir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temp.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function argsFor(adapter: ProviderAdapter): Promise<string[]> {
  const dir = mkdir('orchbot-shared-args-')
  await new Promise<void>((resolve) =>
    adapter.executeTurn(
      'oi',
      { workspacePath: dir, extraDirs: [SHARED], providerConfig: { cliPath: argsCli } },
      {
        onChunk: () => {},
        onDone: () => resolve(),
        onError: () => resolve(),
        onInterrupted: () => resolve(),
      },
    ),
  )
  return JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8'))
}

describe('a pasta shared/ chega liberada a cada CLI', () => {
  it.each([
    ['claude', new ClaudeAdapter(), ['--add-dir', SHARED]],
    ['codex', new CodexAdapter(), ['-c', `sandbox_workspace_write.writable_roots=["${SHARED}"]`]],
    ['copilot', new CopilotAdapter(), ['--add-dir', SHARED]],
    ['kimi', new KimiAdapter(), ['--add-dir', SHARED]],
    ['grok', new GrokAdapter(), ['--add-dir', SHARED]],
    ['gemini', new GeminiAdapter(), [`--include-directories=${SHARED}`]],
  ] as const)('%s', async (_name, adapter, expected) => {
    const args = await argsFor(adapter)
    const at = args.indexOf(expected[0])
    expect(at).toBeGreaterThanOrEqual(0)
    expect(args.slice(at, at + expected.length)).toEqual(expected)
    // Codex fecha as flags com `--` e lê o prompt do stdin (`-`): a pasta extra não engole o prompt.
    if (args.includes('--')) expect(args.slice(args.indexOf('--') + 1).at(-1)).toBe('-')
  })

  it.each([
    ['anuncia suporte', 'dirs', [SHARED]],
    ['não anuncia', 'echo', undefined],
  ] as const)('ACP: só manda additionalDirectories se o agente %s', async (_l, mode, expected) => {
    const log = path.join(mkdir('orchbot-shared-acp-'), 'wire.log')
    const onDone = vi.fn()
    const onError = vi.fn()
    new AcpAdapter().executeTurn(
      'oi',
      {
        workspacePath: process.cwd(),
        extraDirs: [SHARED],
        providerConfig: { cliPath: process.execPath, cliArgs: [acpAgent, mode, log] },
      },
      { onChunk: () => {}, onDone, onError },
    )
    await vi.waitFor(() => expect(onDone.mock.calls.length + onError.mock.calls.length).toBe(1))
    const newSession = fs
      .readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((m) => m.method === 'session/new')
    expect(newSession.params.additionalDirectories).toEqual(expected)
  })
})

describe('fila: pasta compartilhada do projeto', () => {
  let db: OrchbotDatabase
  let queue: QueueManager
  afterEach(() => {
    queue?.close()
    db?.close()
  })

  const boot = (projectPath: string | undefined) => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    const seen: { prompt: string; options: ExecutionOptions }[] = []
    const adapter: ProviderAdapter = {
      id: 'codex',
      name: 'Mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        seen.push({ prompt, options })
        setTimeout(() => callbacks.onDone('Pronto.'), 1)
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
    const project = db.createProject({ name: 'Loja', workspacePath: projectPath })
    const agent = db.createAgent({
      name: 'Ana',
      provider: 'codex',
      model: 'gpt',
      projectId: project.id,
      workspacePath: mkdir('orchbot-shared-agent-'),
    })
    queue.enqueue(agent.id, db.listThreads(agent.id)[0].id, 'faça')
    return seen
  }

  it('cria shared/, libera para o provedor e avisa no prompt', async () => {
    const root = mkdir('orchbot-shared-project-')
    const seen = boot(root)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    const shared = path.join(root, 'shared')
    expect(fs.statSync(shared).isDirectory()).toBe(true)
    expect(seen[0].options.extraDirs).toEqual([shared])
    expect(seen[0].options.instructions).toContain(`[PASTA COMPARTILHADA DO PROJETO]\n${shared}`)
  })

  it('projeto sem pasta não ganha shared/ nem pasta extra', async () => {
    const seen = boot(undefined)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0].options.extraDirs).toBeUndefined()
    expect(seen[0].options.instructions ?? '').not.toContain('PASTA COMPARTILHADA')
  })
})

describe('cérebro: anexos em shared/', () => {
  it('o read devolve o caminho dos anexos e recusa sair da pasta', () => {
    const db = new OrchbotDatabase(':memory:', testSecretStorage)
    try {
      const root = mkdir('orchbot-shared-brain-')
      const project = db.createProject({ name: 'Loja', workspacePath: root })
      fs.mkdirSync(path.join(root, 'shared'))
      fs.writeFileSync(path.join(root, 'shared', 'tabela.csv'), 'a,b\n')
      fs.writeFileSync(path.join(root, 'segredo.txt'), 'x')
      const brain = new BrainService(db)
      brain.savePage({
        projectId: project.id,
        slug: 'precos',
        title: 'Preços',
        content: '# Preços\nVer shared/tabela.csv e (shared/falta.pdf). Não: shared/../segredo.txt',
      })
      const agent = db.createAgent({
        name: 'Ana',
        provider: 'codex',
        model: 'gpt',
        projectId: project.id,
        workspacePath: root,
      })
      const [out] = brain.run(agent, [{ action: 'read', body: 'precos' }]).lines
      expect(out).toContain(
        `- shared/tabela.csv → ${path.join(root, 'shared', 'tabela.csv')} (1 KB)`,
      )
      expect(out).toContain('- shared/falta.pdf: não encontrado.')
      expect(out).toContain('- shared/../segredo.txt: fora da pasta compartilhada.')
      expect(brain.contextSection(agent)).toContain('shared/<nome>')
    } finally {
      db.close()
    }
  })
})

describe('.orchbot/ fora do git do agente', () => {
  it('espelho e caixa de entrada não aparecem no git status', () => {
    const repo = mkdir('orchbot-shared-git-')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    const db = new OrchbotDatabase(':memory:', testSecretStorage)
    try {
      const agent = db.createAgent({
        name: 'Ana',
        provider: 'codex',
        model: 'gpt',
        instructions: 'seja breve',
        workspacePath: repo,
      })
      db.addMemory(agent.id, 'gosta de café')
      expect(fs.existsSync(path.join(repo, '.orchbot', 'agent', 'MEMORY.md'))).toBe(true)
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe(
        '',
      )
    } finally {
      db.close()
    }
  })
})
