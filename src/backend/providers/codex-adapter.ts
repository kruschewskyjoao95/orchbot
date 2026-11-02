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

export class CodexAdapter implements ProviderAdapter {
  public readonly id = 'codex'
  public readonly name = 'Codex (OpenAI)'

  public async checkAvailability(): Promise<ProviderInfo> {
    try {
      const { stdout } = await execFileAsync('codex', ['--version'])
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
    const args = ['exec', '--skip-git-repo-check', '--json']

    if (options.workspacePath) {
      args.push('-C', options.workspacePath)
    }

    if (options.model) {
      args.push('-m', options.model)
    }

    // Se houver instruções customizadas, combina de forma clara
    const effectivePrompt = options.instructions
      ? `[Instruções do Sistema: ${options.instructions}]\n\n${prompt}`
      : prompt

    args.push(effectivePrompt)

    let isInterrupted = false
    let child: ChildProcess | null = null
    let fullText = ''
    let stderrText = ''

    try {
      child = spawn('codex', args, {
        cwd: options.workspacePath || process.cwd(),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
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
          if (parsed.type === 'item.completed' || parsed.type === 'item.updated') {
            if (parsed.item?.type === 'agent_message' && typeof parsed.item.text === 'string') {
              const newText = parsed.item.text
              if (newText.length > fullText.length) {
                const chunk = newText.slice(fullText.length)
                fullText = newText
                callbacks.onChunk(chunk, fullText)
              } else if (!fullText && newText) {
                fullText = newText
                callbacks.onChunk(newText, fullText)
              }
            }
          } else if (parsed.type === 'turn.completed') {
            // Conclusão do turno
          }
        } catch {
          // Linha não-JSON (pode ser log)
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
        callbacks.onError(stderrText.trim() || `Codex encerrou com código ${code}`)
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
