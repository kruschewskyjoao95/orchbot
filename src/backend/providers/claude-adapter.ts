import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderInfo } from '../../shared/types'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
} from './types'

const execFileAsync = promisify(execFile)

export class ClaudeAdapter implements ProviderAdapter {
  public readonly id = 'claude'
  public readonly name = 'Claude Code (Anthropic)'

  public async checkAvailability(): Promise<ProviderInfo> {
    try {
      const { stdout } = await execFileAsync('claude', ['--version'])
      return {
        available: true,
        version: stdout.trim(),
      }
    } catch (err: unknown) {
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const args = ['-p', '--verbose', '--output-format=stream-json', '--include-partial-messages']

    if (options.model) {
      args.push('--model', options.model)
    }

    if (options.instructions) {
      args.push('--append-system-prompt', options.instructions)
    }

    args.push(prompt)

    let isInterrupted = false
    let child: ChildProcess | null = null
    let fullText = ''
    let stderrText = ''

    try {
      child = spawn('claude', args, {
        cwd: options.workspacePath || process.cwd(),
        env: {
          ...process.env,
        },
      })
    } catch (err: unknown) {
      callbacks.onError(err instanceof Error ? err.message : String(err))
      return { interrupt: () => {} }
    }

    let buffer = ''

    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString('utf-8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const parsed = JSON.parse(trimmed)

          // 1. Evento de streaming com delta parcial
          if (
            parsed.type === 'stream_event' &&
            parsed.event?.type === 'content_block_delta' &&
            parsed.event.delta?.type === 'text_delta' &&
            typeof parsed.event.delta.text === 'string'
          ) {
            const chunk = parsed.event.delta.text
            fullText += chunk
            callbacks.onChunk(chunk, fullText)
          }

          // 2. Evento de resultado final consolidado
          if (parsed.type === 'result' && typeof parsed.result === 'string') {
            if (!fullText) {
              fullText = parsed.result
              callbacks.onChunk(parsed.result, fullText)
            }
          }
        } catch {
          // Linha não-JSON (pode ser log informativo)
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderrText += data.toString('utf-8')
    })

    child.on('close', (code) => {
      if (isInterrupted) {
        return
      }

      if (code !== 0 && !fullText) {
        callbacks.onError(stderrText.trim() || `Claude encerrou com código ${code}`)
      } else {
        callbacks.onDone(fullText.trim())
      }
    })

    child.on('error', (err) => {
      if (!isInterrupted) {
        callbacks.onError(err.message)
      }
    })

    return {
      interrupt: () => {
        isInterrupted = true
        if (child && !child.killed) {
          child.kill('SIGTERM')
        }
      },
    }
  }
}
