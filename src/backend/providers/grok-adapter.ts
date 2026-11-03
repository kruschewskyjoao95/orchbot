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

export class GrokAdapter implements ProviderAdapter {
  public readonly id = 'grok'
  public readonly name = 'Grok (xAI)'

  public async checkAvailability(): Promise<ProviderInfo> {
    try {
      const { stdout } = await execFileAsync('grok', ['--version'])
      return {
        available: true,
        version: stdout.trim(),
      }
    } catch {
      // Se não houver CLI grok instalado, verifica se há chave de ambiente ou mock disponível
      const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY
      if (apiKey) {
        return {
          available: true,
          version: 'xAI API configurada (via ENV)',
        }
      }
      return {
        available: false,
        error:
          'CLI grok não encontrado no PATH e nenhuma variável GROK_API_KEY/XAI_API_KEY detectada.',
      }
    }
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const args = ['exec', '--model', options.model ?? 'grok-2']

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
      child = spawn('grok', args, {
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
        callbacks.onError(`Erro ao executar grok: ${err.message}`)
      })

      child.on('close', (code) => {
        if (isInterrupted) return
        if (code === 0) {
          callbacks.onDone(fullText)
        } else {
          callbacks.onError(`Processo grok finalizou com código ${code}. ${stderrText}`.trim())
        }
      })
    } catch (err: unknown) {
      callbacks.onError(
        `Falha ao iniciar adapter Grok: ${err instanceof Error ? err.message : String(err)}`,
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
