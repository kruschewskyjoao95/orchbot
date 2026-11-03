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
  public readonly name = 'Muse Code'

  public async checkAvailability(): Promise<ProviderInfo> {
    try {
      const { stdout } = await execFileAsync('muse', ['--version'])
      return {
        available: true,
        version: stdout.trim(),
      }
    } catch {
      const apiKey = process.env.MUSE_API_KEY || process.env.MUSE_TOKEN
      if (apiKey) {
        return {
          available: true,
          version: 'Muse API configurada (via ENV)',
        }
      }
      return {
        available: false,
        error:
          'CLI muse não encontrado no PATH e nenhuma variável de ambiente MUSE_API_KEY/MUSE_TOKEN detectada.',
      }
    }
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const cmd = 'muse'
    const args = ['exec', '--model', options.model ?? 'muse-spark-1.3']

    if (options.workspacePath) {
      args.push('--workspace', options.workspacePath)
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
