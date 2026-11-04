import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProviderInfo, SupportedProvider } from '../../shared/types'
import { claudeMcp } from '../mcp/mcp-launch'
import { getCatalogEntry } from './catalog'
import { buildProviderEnv, checkCliAvailability, resolveCliCommand } from './cli-utils'
import { runSessionCli } from './session-cli'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
  ProviderRuntimeConfig,
} from './types'

export class ClaudeAdapter implements ProviderAdapter {
  public readonly id: SupportedProvider = 'claude'
  public readonly name = 'Claude Code (Anthropic)'
  public readonly supportsSessionResume = true

  public async checkAvailability(config?: ProviderRuntimeConfig): Promise<ProviderInfo> {
    return checkCliAvailability('claude', config)
  }

  public async discoverModels(config?: ProviderRuntimeConfig): Promise<string[]> {
    // O Claude Code responde à requisição "initialize" do protocolo stream-json com os modelos da conta
    // (mesma fonte do supportedModels() do Agent SDK); funciona com assinatura, sem chave de API.
    const entry = getCatalogEntry('claude')
    const fromCli = await new Promise<string[]>((resolve) => {
      const child = spawn(
        resolveCliCommand(entry.cliCommand, config?.cliPath),
        ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
        { cwd: tmpdir(), env: buildProviderEnv(config), stdio: ['pipe', 'pipe', 'ignore'] },
      )
      let buf = ''
      const done = (models: string[]) => {
        clearTimeout(timer)
        child.kill()
        resolve(models)
      }
      const timer = setTimeout(() => done([]), 20000)
      child.on('error', () => done([]))
      child.on('close', () => done([]))
      child.stdout.on('data', (chunk) => {
        buf += chunk
        for (const line of buf.split('\n')) {
          if (!line.includes('"control_response"')) continue
          try {
            const models = JSON.parse(line).response?.response?.models as
              | { value: string; resolvedModel?: string }[]
              | undefined
            return done([
              ...new Set((models ?? []).filter((m) => m.value !== 'default').map((m) => m.value)),
            ])
          } catch {}
        }
      })
      child.stdout.setEncoding('utf8')
      child.stdin.write(
        '{"request_id":"models","type":"control_request","request":{"subtype":"initialize"}}\n',
      )
    })
    return fromCli.length > 0 ? fromCli : [...entry.models]
  }

  public executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const args = ['-p', '--verbose', '--output-format=stream-json', '--include-partial-messages']
    if (options.resumeSessionId) args.push('--resume', options.resumeSessionId)
    if (options.model) args.push('--model', options.model)
    if (options.providerConfig?.effort) args.push('--effort', options.providerConfig.effort)
    // Instruções em arquivo e prompt por stdin: o argv tem limite de 128 KB por argumento (E2BIG).
    let instructionsDir: string | undefined
    if (options.instructions) {
      try {
        instructionsDir = fs.mkdtempSync(path.join(tmpdir(), 'orchbot-claude-'))
        const file = path.join(instructionsDir, 'instructions.md')
        fs.writeFileSync(file, options.instructions, { mode: 0o600 })
        args.push('--append-system-prompt-file', file)
      } catch {
        instructionsDir = undefined
        args.push('--append-system-prompt', options.instructions)
      }
    }
    const cleanup = () => {
      if (instructionsDir) fs.rmSync(instructionsDir, { recursive: true, force: true })
    }
    const done: ExecutionCallbacks = {
      ...callbacks,
      onDone: (text) => {
        cleanup()
        callbacks.onDone(text)
      },
      onError: (error) => {
        cleanup()
        callbacks.onError(error)
      },
      onInterrupted: () => {
        cleanup()
        callbacks.onInterrupted?.()
      },
    }
    for (const dir of options.extraDirs ?? []) args.push('--add-dir', dir)
    const servers = options.providerConfig?.mcpServers
    if (servers?.length) args.push(...claudeMcp(servers).args)
    if (options.permission) {
      // O CLI pergunta ao host por stdin/stdout; manual ignora o modo padrão da conta (ex.: auto).
      args.push(
        '--input-format',
        'stream-json',
        '--permission-prompt-tool',
        'stdio',
        '--permission-mode',
        'manual',
      )
      return runSessionCli('claude', args, options, done, prompt)
    }
    return runSessionCli('claude', args, options, done, undefined, prompt)
  }
}
