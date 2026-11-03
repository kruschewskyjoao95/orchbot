import { type ChildProcess, spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { SupportedProvider } from '../../shared/types'
import { acpMcp } from '../mcp/mcp-launch'
import { guardedLaunch } from './antigravity-server'
import { buildProviderEnv } from './cli-utils'
import { withInstructions } from './runner'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
  ProviderRuntimeConfig,
} from './types'

const runningChildren = new Set<ChildProcess>()
function killAgent(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    /* The process may already have exited. */
  }
}
process.once('exit', () => {
  for (const child of runningChildren) killAgent(child, 'SIGKILL')
})

function errorMessage(error: unknown, config?: ProviderRuntimeConfig): string {
  const message = error instanceof Error ? error.message : 'Falha na comunicação ACP.'
  return config?.apiKey ? message.split(config.apiKey).join('[REDACTED]') : message
}

/** O que muda de um agente ACP para outro: como achar o executável e como se apresentar a ele. */
export interface AcpFlavor {
  id: SupportedProvider
  name: string
  /** `clientInfo.name` enviado no initialize (alguns agentes liberam recursos conforme o cliente). */
  clientName: string
  installHint: string
  loginHint: string
  missingMessage: string
  launch: (config?: ProviderRuntimeConfig) => { command: string; args: string[] } | undefined
  /** Lança por systemd-run quando o limite herdado de RTTIME mataria o agente. */
  guardRttime?: boolean
}

export const GENERIC_ACP: AcpFlavor = {
  id: 'acp',
  name: 'Agente ACP',
  clientName: 'orchbot',
  installHint: 'Instale um agente ACP e configure o comando e argumentos no botão ⚙.',
  loginHint: 'Faça login no agente ACP pelo terminal e teste novamente.',
  missingMessage: 'Configure o comando e os argumentos do agente ACP (⚙).',
  launch: (config) => {
    const command = config?.cliPath?.trim()
    return command ? { command, args: config?.cliArgs ?? [] } : undefined
  },
}

function connectAgent(
  flavor: AcpFlavor,
  config: ProviderRuntimeConfig | undefined,
  cwd: string,
  app: acp.ClientApp,
) {
  const wanted = flavor.launch(config)
  if (!wanted) throw new Error(flavor.missingMessage)
  const { command } = wanted
  if (config?.apiKey && !config.apiKeyEnv && flavor.id === 'acp')
    throw new Error('Informe a variável de ambiente da API key na configuração ACP.')
  const env = {
    ...buildProviderEnv(config),
    ...(config?.apiKeyEnv && config.apiKey ? { [config.apiKeyEnv]: config.apiKey } : {}),
  }
  const launch = flavor.guardRttime
    ? guardedLaunch(wanted.command, wanted.args, cwd, env)
    : { command: wanted.command, args: wanted.args }
  const child = spawn(launch.command, launch.args, {
    cwd,
    shell: false,
    detached: process.platform !== 'win32',
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  runningChildren.add(child)
  child.once('close', () => runningChildren.delete(child))
  const connection = app.connect(
    acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  )
  let stderr = ''
  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString('utf8')).slice(-4096)
  })
  child.on('error', (error: NodeJS.ErrnoException) =>
    connection.close(
      Object.assign(new Error(`Não foi possível iniciar o agente ACP: ${command}`), {
        code: error.code,
      }),
    ),
  )
  child.on('close', (code) => {
    // A CLI may echo its environment in diagnostics; never return the configured key.
    const detail = config?.apiKey ? stderr.split(config.apiKey).join('[REDACTED]') : stderr
    connection.close(new Error(`Agente ACP encerrou (${code ?? 'sinal'}). ${detail}`.trim()))
  })
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    connection.close()
    child.stdin.destroy()
    launch.cleanup?.()
    if (runningChildren.has(child)) {
      killAgent(child, 'SIGTERM')
      const force = setTimeout(() => killAgent(child, 'SIGKILL'), 1000)
      force.unref()
      child.once('close', () => clearTimeout(force))
    }
  }
  const timeout = setTimeout(
    () => connection.close(new Error('Tempo esgotado ao iniciar a sessão ACP.')),
    30_000,
  )
  const initialize = async () => {
    const result = await connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: flavor.clientName, version: '0.1.0' },
      clientCapabilities: {},
    })
    if (result.protocolVersion !== acp.PROTOCOL_VERSION)
      throw new Error('Versão ACP incompatível com o Orchbot.')
    return result
  }
  return {
    connection,
    initialize,
    ready: () => clearTimeout(timeout),
    close: () => {
      clearTimeout(timeout)
      stop()
    },
  }
}

function modelOptions(session: acp.NewSessionResponse) {
  return selectOption(session, 'model')
}

function selectOption(session: acp.NewSessionResponse, category: string) {
  const option = session.configOptions?.find(
    (item) => item.category === category && item.type === 'select',
  )
  if (!option || option.type !== 'select') return undefined
  const values = option.options.flatMap((item) => ('options' in item ? item.options : [item]))
  return { id: option.id, values }
}

export class AcpAdapter implements ProviderAdapter {
  readonly id: SupportedProvider
  readonly name: string

  constructor(private readonly flavor: AcpFlavor = GENERIC_ACP) {
    this.id = flavor.id
    this.name = flavor.name
  }

  async checkAvailability(config?: ProviderRuntimeConfig) {
    let agent: ReturnType<typeof connectAgent> | undefined
    const installHint = this.flavor.installHint
    let initialized = false
    let version: string | undefined
    const wanted = this.flavor.launch(config)
    if (!wanted)
      return {
        available: false,
        installHint,
        readiness:
          this.flavor.id === 'acp' ? ('not_configured' as const) : ('not_installed' as const),
        authStatus: 'unknown' as const,
        error: this.flavor.missingMessage,
      }
    try {
      agent = connectAgent(this.flavor, config, process.cwd(), acp.client())
      const info = await agent.initialize()
      initialized = true
      version = info.agentInfo ? `${info.agentInfo.name} ${info.agentInfo.version}` : 'ACP v1'
      await agent.connection.agent.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })
      return {
        available: true,
        installHint,
        readiness: 'ready' as const,
        version,
        path: wanted.command,
        authStatus: 'cli' as const,
      }
    } catch (error) {
      const authRequired = error instanceof acp.RequestError && error.code === -32000
      const missing =
        error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
      return {
        available: initialized,
        installHint,
        readiness: authRequired
          ? ('login_required' as const)
          : missing
            ? ('not_installed' as const)
            : ('error' as const),
        version,
        path: wanted.command,
        authStatus: authRequired ? ('missing' as const) : ('unknown' as const),
        loginHint: this.flavor.loginHint,
        error: authRequired
          ? 'O agente ACP exige autenticação antes de abrir a sessão.'
          : errorMessage(error, config),
      }
    } finally {
      agent?.close()
    }
  }

  async discoverModels(config?: ProviderRuntimeConfig): Promise<string[]> {
    const agent = connectAgent(this.flavor, config, process.cwd(), acp.client())
    try {
      await agent.initialize()
      const session = await agent.connection.agent.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })
      return ['auto', ...new Set(modelOptions(session)?.values.map((item) => item.value) ?? [])]
    } catch (error) {
      throw new Error(errorMessage(error, config))
    } finally {
      agent.close()
    }
  }

  executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    let agent: ReturnType<typeof connectAgent> | undefined
    let sessionId: string | undefined
    let interrupted = false
    let fullText = ''
    const permissions = new AbortController()
    const app = acp
      .client()
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (interrupted || params.sessionId !== sessionId) return
        const update = params.update
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
          fullText += update.content.text
          callbacks.onChunk(update.content.text, fullText)
        }
      })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params, signal }) => {
        if (interrupted || params.sessionId !== sessionId || !callbacks.onPermissionRequest) {
          return { outcome: { outcome: 'cancelled' } }
        }
        const optionId = await callbacks.onPermissionRequest(
          params,
          AbortSignal.any([signal, permissions.signal]),
        )
        if (
          interrupted ||
          signal.aborted ||
          !params.options.some((item) => item.optionId === optionId)
        ) {
          return { outcome: { outcome: 'cancelled' } }
        }
        return { outcome: { outcome: 'selected', optionId: optionId as string } }
      })
    // Defer errors until the queue has registered the active execution.
    void Promise.resolve().then(async () => {
      try {
        if (interrupted) return
        agent = connectAgent(this.flavor, options.providerConfig, options.workspacePath, app)
        const init = await agent.initialize()
        const mcp = acpMcp(
          options.providerConfig?.mcpServers ?? [],
          init.agentCapabilities?.mcpCapabilities,
        )
        if (mcp.skipped.length)
          callbacks.onNotice?.(
            `🔌 Este agente ACP não aceita servidores MCP por HTTP; ignorados: ${mcp.skipped.join(', ')}.`,
          )
        const session = await agent.connection.agent.request(acp.methods.agent.session.new, {
          cwd: options.workspacePath,
          mcpServers: mcp.servers as never,
        })
        sessionId = session.sessionId
        const model = options.model
        if (model && model !== 'auto') {
          const models = modelOptions(session)
          if (!models?.values.some((item) => item.value === model)) {
            throw new Error(
              `Modelo "${model}" não oferecido pelo agente ACP. Use auto ou descubra os modelos na conexão.`,
            )
          }
          await agent.connection.agent.request(acp.methods.agent.session.setConfigOption, {
            sessionId,
            configId: models.id,
            value: model,
          })
        }
        // Esforço do robô → opção de raciocínio do agente, só se ele oferecer exatamente esse valor.
        const effort = options.providerConfig?.effort
        const thought = effort ? selectOption(session, 'thought_level') : undefined
        if (effort && thought?.values.some((item) => item.value === effort))
          await agent.connection.agent.request(acp.methods.agent.session.setConfigOption, {
            sessionId,
            configId: thought.id,
            value: effort,
          })
        agent.ready()
        const result = await agent.connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: 'text', text: withInstructions(prompt, options.instructions) }],
        })
        if (!interrupted) {
          if (result.stopReason === 'cancelled')
            callbacks.onError('Turno cancelado pelo agente ACP.')
          else callbacks.onDone(fullText)
        }
      } catch (error) {
        if (!interrupted) {
          callbacks.onError(errorMessage(error, options.providerConfig))
        }
      } finally {
        permissions.abort()
        agent?.close()
      }
    })
    return {
      interrupt: () => {
        if (interrupted) return
        interrupted = true
        permissions.abort()
        if (agent && sessionId) {
          void agent.connection.agent
            .notify(acp.methods.agent.session.cancel, { sessionId })
            .catch(() => {})
          const active = agent
          const grace = setTimeout(() => active.close(), 250)
          grace.unref()
        } else agent?.close()
      },
    }
  }
}
