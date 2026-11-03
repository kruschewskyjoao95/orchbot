import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAdapter } from '../src/backend/providers/claude-adapter'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ExecutionOptions } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'

const cli = fileURLToPath(new URL('./fixtures/session-cli.mjs', import.meta.url))
const uuid = '11111111-1111-4111-8111-111111111111'

describe.each(['codex', 'claude'] as const)('%s persistent sessions', (provider) => {
  let dir: string
  let db: OrchbotDatabase
  let queue: QueueManager
  let registry: ProviderRegistry
  let agentId: string
  let threadId: string
  const adapter = provider === 'codex' ? new CodexAdapter() : new ClaudeAdapter()
  const calls = (): Array<{
    id: string
    resume?: string
    prompt: string
    args: string[]
    event?: string
  }> =>
    fs
      .readFileSync(path.join(dir, 'cli-calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-native-session-'))
    db = new OrchbotDatabase(path.join(dir, 'orchbot.db'))
    db.updateConnection({ providerId: provider, cliPath: cli })
    const agent = db.createAgent({
      name: 'SessionBot',
      provider,
      model: 'normal',
      workspacePath: dir,
      browserAccess: false,
    })
    agentId = agent.id
    threadId = db.listThreads(agentId)[0].id
    registry = new ProviderRegistry()
    queue = new QueueManager(db, registry)
  })
  afterEach(() => {
    queue.close()
    registry.interruptAll()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  async function enqueue(prompt: string, target = threadId) {
    const task = queue.enqueue(agentId, target, prompt)
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('completed'))
    return task
  }
  function direct(extra: Partial<ExecutionOptions> = {}) {
    const onSessionId = vi.fn()
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const onInterrupted = vi.fn()
    const execution = adapter.executeTurn(
      'A prompt',
      { workspacePath: dir, model: 'normal', providerConfig: { cliPath: cli }, ...extra },
      { onSessionId, onChunk, onDone, onError, onInterrupted },
    )
    return { execution, onSessionId, onChunk, onDone, onError, onInterrupted }
  }

  it('resumes exactly the same native session across turns and an app/database restart', async () => {
    await enqueue('First detailed task')
    const first = calls()[0]
    expect(first.resume).toBeUndefined()
    queue.close()
    db.close()
    db = new OrchbotDatabase(path.join(dir, 'orchbot.db'))
    registry = new ProviderRegistry()
    queue = new QueueManager(db, registry)
    await enqueue('Continue with all previous details')
    expect(calls()[1].resume).toBe(first.id)
    expect(db.listMessages(threadId).at(-1)?.text).toBe('Turn 2: Olá 🌍')
    const args = calls()[1].args
    if (provider === 'codex') {
      expect(args.slice(0, 2)).toEqual(['exec', 'resume'])
      expect(args).not.toContain('-C')
    } else expect(args).toContain('--resume')
    expect(args).not.toContain('--last')
    expect(args).not.toContain('--continue')
  })

  it('isolates conversations and restores the correct session when switching tabs', async () => {
    await enqueue('Thread A')
    const first = calls()[0].id
    const other = db.createThread(agentId, 'Another conversation')
    await enqueue('Thread B', other.id)
    expect(calls()[1].resume).toBeUndefined()
    expect(calls()[1].id).not.toBe(first)
    await enqueue('Back to A')
    expect(calls()[2].resume).toBe(first)
  })

  it('starts fresh after changing provider, workspace, or CLI connection', async () => {
    await enqueue('Original context')
    db.updateAgent({ id: agentId, provider: provider === 'codex' ? 'claude' : 'codex' })
    db.updateAgent({ id: agentId, provider })
    await enqueue('Provider changed')
    expect(calls()[1].resume).toBeUndefined()
    // A different command spelling invalidates the session scope without clearing chat messages.
    const alias = path.join(dir, 'alias-cli')
    fs.symlinkSync(cli, alias)
    db.updateConnection({ providerId: provider, cliPath: alias })
    await enqueue('Connection changed')
    expect(calls()[2].resume).toBeUndefined()
    const anotherWorkspace = path.join(dir, 'another-workspace')
    fs.mkdirSync(anotherWorkspace)
    db.updateAgent({ id: agentId, workspacePath: anotherWorkspace })
    await enqueue('Workspace changed')
    const workspaceCall = JSON.parse(
      fs.readFileSync(path.join(anotherWorkspace, 'cli-calls.jsonl'), 'utf8').trim(),
    )
    expect(workspaceCall.resume).toBeUndefined()
    expect(db.listMessages(threadId)).toHaveLength(4)
  })

  it('allows explicit reset without deleting messages and bootstraps fresh sessions', async () => {
    db.addMessage(threadId, 'user', 'Keep the detailed project decision')
    db.addMessage(threadId, 'assistant', 'We decided to preserve existing data')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await enqueue('First native turn')
    expect(calls()[0].args.join(' ')).toContain('preserve existing data')
    await enqueue('Native continuation')
    // Claude sends system instructions as an argument; Codex embeds them in the prompt.
    expect(calls()[1].args.join(' ')).not.toContain('[HISTÓRICO RECENTE DA CONVERSA]')
    expect(db.resetProviderSession(threadId)).toBe(true)
    expect(db.listMessages(threadId)).toHaveLength(4)
    await enqueue('Start a clean native session')
    expect(calls()[2].resume).toBeUndefined()
  })

  it('keeps the session on errors and never silently retries in a fresh session', async () => {
    await enqueue('Initial task')
    const first = calls()[0].id
    fs.writeFileSync(path.join(dir, 'cli-sessions.json'), '{}')
    const failed = queue.enqueue(agentId, threadId, 'Session was removed outside Orchbot')
    await vi.waitFor(() => expect(db.getTask(failed.id)?.status).toBe('failed'))
    expect(db.getTask(failed.id)?.error).toContain('Reiniciar sessão CLI')
    expect(calls()).toHaveLength(2)
    expect(calls()[1].resume).toBe(first)
    db.resetProviderSession(threadId)
    await enqueue('Explicit recovery')
    expect(calls()[2].resume).toBeUndefined()
  })

  it('waits for CLI exit after interruption before resuming queued work', async () => {
    db.updateAgent({ id: agentId, model: 'hang' })
    const running = queue.enqueue(agentId, threadId, 'Long-running task')
    await vi.waitFor(() =>
      expect(db.listTasks(agentId).find((task) => task.id === running.id)?.status).toBe('running'),
    )
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, 'cli-sessions.json'))).toBe(true))
    expect(() => db.resetProviderSession(threadId)).toThrow('Interrompa')
    db.updateAgent({ id: agentId, model: 'normal' })
    const next = queue.enqueue(agentId, threadId, 'Next queued task')
    queue.interruptThread(threadId)
    await vi.waitFor(() => expect(db.getTask(next.id)?.status).toBe('completed'))
    expect(db.getTask(running.id)?.status).toBe('interrupted')
    const log = calls()
    expect(log[1].event).toBe('closed')
    expect(log[2].resume).toBe(log[0].id)
  })

  it('does not unlock the active session when cancelling a different pending task', async () => {
    db.updateAgent({ id: agentId, model: 'hang' })
    const running = queue.enqueue(agentId, threadId, 'Keep this running')
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, 'cli-sessions.json'))).toBe(true))
    const cancelled = queue.enqueue(agentId, threadId, 'Cancel the pending task')
    const next = queue.enqueue(agentId, threadId, 'Run after the active session closes')
    db.updateAgent({ id: agentId, model: 'normal' })
    queue.cancel(cancelled.id)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(db.getTask(next.id)?.status).toBe('pending')
    expect(db.getTask(running.id)?.status).toBe('running')
    queue.interruptThread(threadId)
    await vi.waitFor(() => expect(db.getTask(next.id)?.status).toBe('completed'))
    expect(calls()[1].event).toBe('closed')
  })

  it('persists the session before completion and resumes after shutdown reconciliation', async () => {
    db.updateAgent({ id: agentId, model: 'hang' })
    const running = queue.enqueue(agentId, threadId, 'Interrupted by app shutdown')
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, 'cli-sessions.json'))).toBe(true))
    const original = calls()[0].id
    queue.close()
    registry.interruptAll()
    await vi.waitFor(() => expect(calls().some((call) => call.event === 'closed')).toBe(true))
    db.close()
    db = new OrchbotDatabase(path.join(dir, 'orchbot.db'))
    db.updateAgent({ id: agentId, model: 'normal' })
    registry = new ProviderRegistry()
    queue = new QueueManager(db, registry)
    expect(db.getTask(running.id)?.status).toBe('interrupted')
    await enqueue('Resume after restart')
    expect(calls().at(-1)?.resume).toBe(original)
  })

  it('retains the captured ID while cancellation waits for the child to close', async () => {
    db.updateAgent({ id: agentId, model: 'hang' })
    const running = queue.enqueue(agentId, threadId, 'Cancel this task')
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, 'cli-sessions.json'))).toBe(true))
    db.updateAgent({ id: agentId, model: 'normal' })
    const pending = queue.enqueue(agentId, threadId, 'After cancel')
    expect(queue.cancel(running.id)).toBe(true)
    await vi.waitFor(() => expect(db.getTask(pending.id)?.status).toBe('completed'))
    expect(db.getTask(running.id)?.status).toBe('cancelled')
    expect(calls()[1].event).toBe('closed')
    expect(calls()[2].resume).toBe(calls()[0].id)
  })

  it.each(['failure', 'exit-error', 'bad-id', 'missing-id'])(
    'reports %s once even after partial output',
    async (model) => {
      const run = direct({ model })
      await vi.waitFor(() => expect(run.onError).toHaveBeenCalledTimes(1))
      expect(run.onDone).not.toHaveBeenCalled()
      if (model === 'bad-id' || model === 'missing-id')
        expect(run.onSessionId).not.toHaveBeenCalled()
    },
  )

  it('forces shutdown if the CLI ignores graceful interruption', async () => {
    const run = direct({ model: 'hang-ignore' })
    await vi.waitFor(() => expect(run.onSessionId).toHaveBeenCalled())
    run.execution.interrupt()
    await vi.waitFor(() => expect(run.onInterrupted).toHaveBeenCalledTimes(1), { timeout: 2500 })
    expect(run.onDone).not.toHaveBeenCalled()
    expect(run.onError).not.toHaveBeenCalled()
  })

  it('does not accept another session in response to an explicit resume', async () => {
    fs.writeFileSync(path.join(dir, 'cli-sessions.json'), JSON.stringify({ [uuid]: ['old task'] }))
    const run = direct({ model: 'mismatch', resumeSessionId: uuid })
    await vi.waitFor(() =>
      expect(run.onError).toHaveBeenCalledWith(expect.stringContaining('sessão diferente')),
    )
    expect(run.onSessionId).not.toHaveBeenCalled()
    expect(run.onDone).not.toHaveBeenCalled()
  })

  it('reports startup errors once and rejects invalid resume IDs before spawning', async () => {
    const failed = direct({ providerConfig: { cliPath: '/nonexistent/orchbot-cli' } })
    await vi.waitFor(() => expect(failed.onError).toHaveBeenCalledTimes(1))
    const invalid = direct({ resumeSessionId: '--last' })
    await vi.waitFor(() => expect(invalid.onError).toHaveBeenCalledTimes(1))
    expect(invalid.onSessionId).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(dir, 'cli-calls.jsonl'))).toBe(false)
  })

  it('cascades metadata on deletion and rejects invalid IDs at the database boundary', () => {
    db.saveProviderSession(threadId, provider, 'scope', uuid)
    expect(db.getProviderSession(threadId, provider, 'scope')).toBe(uuid)
    expect(db.getProviderSession(threadId, provider, 'other-scope')).toBeUndefined()
    expect(() => db.saveProviderSession(threadId, provider, 'scope', '/tmp/session')).toThrow(
      'inválido',
    )
    db.deleteThread(threadId)
    expect(db.getProviderSession(threadId, provider, 'scope')).toBeUndefined()
  })
})
