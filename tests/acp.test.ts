import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { AcpAdapter } from '../src/backend/providers/acp-adapter'
import type { ExecutionCallbacks, ExecutionOptions } from '../src/backend/providers/types'

const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url))
const config = (mode = 'normal', log?: string) => ({
  cliPath: process.execPath,
  cliArgs: [fixture, mode, ...(log ? [log] : [])],
})
const adapter = new AcpAdapter()
function turn(
  mode = 'normal',
  extra: Partial<ExecutionOptions> = {},
  onPermissionRequest?: ExecutionCallbacks['onPermissionRequest'],
) {
  const onChunk = vi.fn()
  const onDone = vi.fn()
  const onError = vi.fn()
  const active = adapter.executeTurn(
    'A prompt',
    { workspacePath: process.cwd(), providerConfig: config(mode), ...extra },
    { onChunk, onDone, onError, onPermissionRequest },
  )
  return { active, onChunk, onDone, onError }
}

describe('Generic ACP adapter over stdio', () => {
  it('checks the protocol handshake instead of a version command', async () => {
    expect(await adapter.checkAvailability(config())).toMatchObject({
      available: true,
      version: 'test-agent 1.0.0',
    })
    expect(await adapter.checkAvailability()).toMatchObject({
      available: false,
      error: expect.stringContaining('Configure'),
    })
    expect(await adapter.checkAvailability({ cliPath: '/nonexistent/orchbot-acp' })).toMatchObject({
      available: false,
    })
    expect(await adapter.checkAvailability(config('bad-version'))).toMatchObject({
      available: false,
      error: expect.stringContaining('incompatível'),
    })
  })

  it('checks session creation for auth without sending a prompt', async () => {
    expect(await adapter.checkAvailability(config())).toMatchObject({
      available: true,
      readiness: 'ready',
    })
    expect(await adapter.checkAvailability(config('auth-error'))).toMatchObject({
      available: true,
      readiness: 'login_required',
      authStatus: 'missing',
    })
    expect(await adapter.checkAvailability()).toMatchObject({ readiness: 'not_configured' })
    expect(await adapter.checkAvailability({ cliPath: '/nonexistent/orchbot-acp' })).toMatchObject({
      readiness: 'not_installed',
    })
  })

  it('streams only agent messages and finishes once', async () => {
    const run = turn()
    await vi.waitFor(() => expect(run.onDone).toHaveBeenCalledWith('Olá 🌍'))
    expect(run.onChunk.mock.calls).toEqual([
      ['Olá ', 'Olá '],
      ['🌍', 'Olá 🌍'],
    ])
    expect(run.onDone).toHaveBeenCalledTimes(1)
    expect(run.onError).not.toHaveBeenCalled()
  })

  it('discovers model options and passes instructions, selected model, literal arguments and key', async () => {
    expect(await adapter.discoverModels(config())).toEqual(['auto', 'model-a', 'model-b'])
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-acp-test-'))
    try {
      const run = turn('echo', {
        model: 'model-b',
        instructions: 'System rule',
        providerConfig: {
          ...config('echo', path.join(dir, 'wire.log')),
          cliArgs: [fixture, 'echo', path.join(dir, 'wire.log'), 'literal $(echo unsafe)'],
          apiKey: 'test-secret',
          apiKeyEnv: 'TEST_ACP_KEY',
        },
      })
      await vi.waitFor(() => expect(run.onDone).toHaveBeenCalled())
      const response = JSON.parse(run.onDone.mock.calls[0][0].slice('Olá 🌍'.length))
      expect(response).toMatchObject({
        model: 'model-b',
        key: 'test-secret',
        arg: 'literal $(echo unsafe)',
      })
      expect(response.prompt[0].text).toContain('System rule')
      expect(response.prompt[0].text).toContain('A prompt')
      expect(fs.readFileSync(path.join(dir, 'wire.log'), 'utf8')).not.toContain('test-secret')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects unavailable models without silently ignoring the selection', async () => {
    const run = turn('no-models', { model: 'unavailable-model' })
    await vi.waitFor(() =>
      expect(run.onError).toHaveBeenCalledWith(expect.stringContaining('não oferecido')),
    )
    expect(run.onDone).not.toHaveBeenCalled()
  })

  it('requests a decision before granting a permission and validates the selected id', async () => {
    const permission = vi.fn().mockResolvedValue('yes')
    const allowed = turn('permission', {}, permission)
    await vi.waitFor(() =>
      expect(allowed.onDone).toHaveBeenCalledWith(
        JSON.stringify({ outcome: { outcome: 'selected', optionId: 'yes' } }),
      ),
    )
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({ toolCall: expect.objectContaining({ title: 'Write a file' }) }),
      expect.any(AbortSignal),
    )
    const invalid = turn('permission', {}, async () => 'invented-option')
    await vi.waitFor(() =>
      expect(invalid.onDone).toHaveBeenCalledWith(
        JSON.stringify({ outcome: { outcome: 'cancelled' } }),
      ),
    )
    const unhandled = turn('permission')
    await vi.waitFor(() =>
      expect(unhandled.onDone).toHaveBeenCalledWith(
        JSON.stringify({ outcome: { outcome: 'cancelled' } }),
      ),
    )
  })

  it.each(['auth-error', 'partial-error', 'crash'])(
    'reports %s once, including after partial text',
    async (mode) => {
      const run = turn(mode)
      await vi.waitFor(() => expect(run.onError).toHaveBeenCalledTimes(1))
      expect(run.onDone).not.toHaveBeenCalled()
    },
  )

  it('sends session/cancel and does not report completion after interruption', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-acp-cancel-'))
    const log = path.join(dir, 'wire.log')
    const run = turn('hang-prompt', { providerConfig: config('hang-prompt', log) })
    try {
      await vi.waitFor(() => expect(fs.readFileSync(log, 'utf8')).toContain('session/prompt'))
      run.active.interrupt()
      await vi.waitFor(() => expect(fs.readFileSync(log, 'utf8')).toContain('session/cancel'))
      expect(run.onDone).not.toHaveBeenCalled()
      expect(run.onError).not.toHaveBeenCalled()
    } finally {
      run.active.interrupt()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'terminates the launcher and its agent subprocess',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-acp-launcher-'))
      const log = path.join(dir, 'wire.log')
      const launcher = fileURLToPath(new URL('./fixtures/acp-launcher.mjs', import.meta.url))
      const run = turn('hang-prompt', {
        providerConfig: { cliPath: process.execPath, cliArgs: [launcher, log] },
      })
      try {
        await vi.waitFor(() => expect(fs.readFileSync(log, 'utf8')).toContain('session/prompt'))
        const pids = JSON.parse(fs.readFileSync(`${log}.pids`, 'utf8')) as number[]
        run.active.interrupt()
        await vi.waitFor(
          () => {
            for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
          },
          { timeout: 3000 },
        )
        expect(run.onDone).not.toHaveBeenCalled()
        expect(run.onError).not.toHaveBeenCalled()
      } finally {
        run.active.interrupt()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('times out a peer that never initializes and closes the process', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const result = adapter.checkAvailability(config('hang-init'))
      await vi.advanceTimersByTimeAsync(30_001)
      expect(await result).toMatchObject({
        available: false,
        error: expect.stringContaining('Tempo esgotado'),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start an agent if interrupted before startup', async () => {
    const run = turn()
    run.active.interrupt()
    await Promise.resolve()
    expect(run.onChunk).not.toHaveBeenCalled()
    expect(run.onError).not.toHaveBeenCalled()
    expect(run.onDone).not.toHaveBeenCalled()
  })

  it('aborts pending permission dialogs when interrupted', async () => {
    let permissionSignal: AbortSignal | undefined
    const run = turn(
      'permission',
      {},
      (_request, signal) =>
        new Promise((resolve) => {
          permissionSignal = signal
          signal.addEventListener('abort', () => resolve(undefined), { once: true })
        }),
    )
    await vi.waitFor(() => expect(permissionSignal).toBeDefined())
    run.active.interrupt()
    expect(permissionSignal?.aborted).toBe(true)
    expect(run.onDone).not.toHaveBeenCalled()
    expect(run.onError).not.toHaveBeenCalled()
  })
})
