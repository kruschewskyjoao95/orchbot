import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runStreamingCli } from '../src/backend/providers/runner'

describe.each(['plain', 'lines-json'] as const)('Streaming CLI (%s)', (mode) => {
  it('reports a missing CLI only once, including after its close event', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orchbot-missing-cli-'))
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const onInterrupted = vi.fn()
    try {
      runStreamingCli(
        {
          cliCommand: path.join(dir, 'absent-cli'),
          label: 'Missing CLI',
          mode,
          buildArgs: () => [],
        },
        'Prompt',
        { workspacePath: dir },
        { onChunk, onDone, onError, onInterrupted },
      )
      await vi.waitFor(() => expect(onError).toHaveBeenCalled())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('ENOENT'))
      expect(onChunk).not.toHaveBeenCalled()
      expect(onDone).not.toHaveBeenCalled()
      expect(onInterrupted).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports interruption once without completion or error', async () => {
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const onInterrupted = vi.fn()
    const output = mode === 'plain' ? 'Started' : `${JSON.stringify({ text: 'Started' })}\n`
    const active = runStreamingCli(
      {
        cliCommand: process.execPath,
        label: 'Interruptible CLI',
        mode,
        buildArgs: () => [
          '-e',
          `process.stdout.write(${JSON.stringify(output)}); setInterval(() => {}, 1000)`,
        ],
      },
      'Prompt',
      { workspacePath: process.cwd() },
      { onChunk, onDone, onError, onInterrupted },
    )
    try {
      await vi.waitFor(() => expect(onChunk).toHaveBeenCalled())
      active.interrupt()
      await vi.waitFor(() => expect(onInterrupted).toHaveBeenCalledTimes(1))
      expect(onDone).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    } finally {
      active.interrupt()
    }
  })

  it.each([
    { exitCode: 1, stderr: 'Quota exceeded' },
    { exitCode: 1, stderr: '' },
    { exitCode: 0, stderr: 'Warning' },
  ])(
    'reports exit $exitCode after text output with stderr "$stderr"',
    async ({ exitCode, stderr }) => {
      const onChunk = vi.fn()
      const onDone = vi.fn()
      const onError = vi.fn()
      const text = 'Partial response'
      const output = mode === 'plain' ? text : JSON.stringify({ text })

      runStreamingCli(
        {
          cliCommand: process.execPath,
          label: 'Test CLI',
          mode,
          buildArgs: () => [
            '-e',
            `process.stdout.write(${JSON.stringify(output)}); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = ${exitCode}`,
          ],
        },
        'Prompt',
        { workspacePath: process.cwd() },
        { onChunk, onDone, onError },
      )

      await vi.waitFor(() => expect(onDone.mock.calls.length + onError.mock.calls.length).toBe(1))
      expect(onChunk).toHaveBeenCalledWith(text, text)
      if (exitCode === 0) {
        expect(onDone).toHaveBeenCalledWith(text)
        expect(onError).not.toHaveBeenCalled()
      } else {
        expect(onError).toHaveBeenCalledWith(
          stderr || `Processo Test CLI finalizou com código ${exitCode}.`,
        )
        expect(onDone).not.toHaveBeenCalled()
      }
    },
  )
})
