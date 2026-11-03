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

export class MuseAdapter implements ProviderAdapter {
  public readonly id = 'muse'
  public readonly name = 'Muse (Google Gemini)'

  public async checkAvailability(): Promise<ProviderInfo> {
    try {
      const { stdout } = await execFileAsync('muse', ['--version'])
      return {
        available: true,
        version: stdout.trim(),
      }
    } catch {
      try {
        const { stdout } = await execFileAsync('gemini', ['--version'])
        return {
          available: true,
          version: `Gemini CLI: ${stdout.trim()}`,
        }
      } catch {
        const apiKey = process.env.GEMINI_API_KEY || process.env.MUSE_API_KEY
        if (apiKey) {
          return {
            available: true,
            version: 'Google Gemini API configurada (via ENV)',
          }
        }
        return {
          available: false,
          error:
            'CLI muse/gemini não encontrado no PATH e nenhuma variável GEMINI_API_KEY/MUSE_API_KEY detectada.',
        }
      }
    }
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const cmd = 'muse'
    const args = ['exec', '--model', options.model ?? 'gemini-2.0-flash']

    if (options.workspacePath) {
      args.push('--dir', options.workspacePath)
    }

    const effectivePrompt = options.instructions
      ? `[Instruções do Sistema: ${options.instructions}]\n\n${prompt}`
      : prompt

    args.push(effectivePrompt)

    let isInterrupted = false
    let child: ChildProcess | null = null
    let fullText = ''
    let stderrText = ''

    try {
      child = spawn(cmd, args, {
        cwd: options.workspacePath,
        env: { ...process.env },
      })

      child.stdout?.on('data', (data: Buffer) => {
        if (isInterrupted) return
        const chunk = data.toString()
        fullText += chunk
        callbacks.onChunk(chunk, fullText)
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderrText += data.toString()
      })

      child.on('error', (err) => {
        if (isInterrupted) return
        callbacks.onError(`Erro ao executar muse: ${err.message}`)
      })

      child.on('close', (code) => {
        if (isInterrupted) return
        if (code === 0) {
          callbacks.onDone(fullText)
        } else {
          callbacks.onError(`Processo muse finalizou com código ${code}. ${stderrText}`.trim())
        }
      })
    } catch (err: unknown) {
      callbacks.onError(
        `Falha ao iniciar adapter Muse: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

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
