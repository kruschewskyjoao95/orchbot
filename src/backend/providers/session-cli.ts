import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
import { getCatalogEntry } from './catalog'
import { buildProviderEnv, resolveCliCommand } from './cli-utils'
import type { ActiveExecution, ExecutionCallbacks, ExecutionOptions } from './types'
import { codexHome, parseClaudeUsage, parseCodexUsage, readCodexContext } from './usage'

const runningChildren = new Set<ChildProcess>()
function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') child.kill(signal)
    else if (child.pid) process.kill(-child.pid, signal)
  } catch {
    /* The process may already have exited. */
  }
}
process.once('exit', () => {
  for (const child of runningChildren) signalProcessGroup(child, 'SIGKILL')
})

interface CliEvent {
  type?: unknown
  subtype?: unknown
  session_id?: unknown
  thread_id?: unknown
  item?: { id?: unknown; type?: unknown; text?: unknown }
  event?: { type?: unknown; delta?: { type?: unknown; text?: unknown } }
  error?: { message?: unknown }
  errors?: unknown
  message?: unknown
  result?: unknown
  is_error?: unknown
  usage?: unknown
  modelUsage?: unknown
  request_id?: unknown
  request?: {
    subtype?: unknown
    tool_name?: unknown
    tool_use_id?: unknown
    description?: unknown
    input?: unknown
  }
}

export function isCliSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}

/** Session-aware lifecycle shared by the two native JSONL CLIs. */
export function runSessionCli(
  provider: 'codex' | 'claude',
  args: string[],
  options: ExecutionOptions,
  callbacks: ExecutionCallbacks,
  /** Claude com permissão por stdio: o prompt vai por stdin e o CLI pergunta antes de cada ferramenta. */
  stdinPrompt?: string,
): ActiveExecution {
  let child: ChildProcess | undefined
  const permissions = new AbortController()
  let interrupted = false
  let settled = false
  let sessionId: string | undefined
  let fullText = ''
  let stderr = ''
  let failure = ''
  let diagnostic = ''
  let completed = false
  const messages = new Map<string, string>()
  const config = options.providerConfig
  const entry = getCatalogEntry(provider)
  const terminate = () => {
    if (!child?.pid) return
    const active = child
    signalProcessGroup(active, 'SIGTERM')
    const force = setTimeout(() => signalProcessGroup(active, 'SIGKILL'), 1000)
    force.unref()
    active.once('close', () => clearTimeout(force))
  }
  const finish = (code: number | null) => {
    if (settled) return
    settled = true
    if (interrupted) {
      callbacks.onInterrupted?.()
      return
    }
    if (failure || code !== 0 || !completed || !sessionId) {
      let error =
        failure ||
        diagnostic ||
        stderr.trim() ||
        `${entry.name} encerrou sem concluir o turno (código ${code}).`
      if (!sessionId && completed && !failure && code === 0)
        error = 'O CLI não informou o ID da sessão. Atualize o CLI para habilitar a continuidade.'
      if (config?.apiKey) error = error.split(config.apiKey).join('[REDACTED]')
      if (options.resumeSessionId)
        error +=
          '\nSe a sessão não estiver mais disponível, use Reiniciar sessão CLI ou abra outra conversa.'
      callbacks.onError(error)
    } else callbacks.onDone(fullText.trim())
  }
  const updateText = (text: string) => {
    if (text === fullText || interrupted) return
    const chunk = text.startsWith(fullText) ? text.slice(fullText.length) : text
    fullText = text
    callbacks.onChunk(chunk, fullText)
  }
  const capture = (id: unknown) => {
    if (!isCliSessionId(id)) throw new Error('O CLI informou um ID de sessão inválido.')
    if (options.resumeSessionId && id !== options.resumeSessionId)
      throw new Error('O CLI abriu uma sessão diferente da sessão solicitada.')
    if (sessionId && id !== sessionId) throw new Error('O CLI trocou de sessão durante o turno.')
    if (sessionId !== id) {
      sessionId = id
      callbacks.onSessionId?.(id)
    }
  }
  // Deferring also lets the queue register the execution before any startup failure.
  void Promise.resolve().then(() => {
    if (interrupted) {
      finish(null)
      return
    }
    try {
      if (options.resumeSessionId !== undefined && !isCliSessionId(options.resumeSessionId))
        throw new Error('ID da sessão CLI inválido.')
      const launched = spawn(resolveCliCommand(entry.cliCommand, config?.cliPath), args, {
        cwd: options.workspacePath || process.cwd(),
        env: {
          ...buildProviderEnv({ ...config, envKeys: entry.envKeys }),
          ...(provider === 'codex' ? { PYTHONUNBUFFERED: '1' } : {}),
        },
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child = launched
      runningChildren.add(launched)
      launched.once('close', () => {
        runningChildren.delete(launched)
        permissions.abort() // fecha o diálogo se o CLI morrer esperando resposta
      })
      const write = (message: unknown) => {
        if (launched.stdin.writable) launched.stdin.write(`${JSON.stringify(message)}\n`)
      }
      if (stdinPrompt === undefined) launched.stdin.end()
      else write({ type: 'user', message: { role: 'user', content: stdinPrompt } })
      const answerPermission = async (event: CliEvent) => {
        const requestId = event.request_id
        const req = event.request
        if (req?.subtype !== 'can_use_tool') {
          write({
            type: 'control_response',
            response: { subtype: 'error', request_id: requestId, error: 'não suportado' },
          })
          return
        }
        const tool = typeof req.tool_name === 'string' ? req.tool_name : 'ferramenta'
        const what = typeof req.description === 'string' ? req.description : ''
        const request = {
          sessionId: sessionId ?? '',
          toolCall: {
            toolCallId: String(req.tool_use_id ?? requestId),
            title: what ? `${tool}: ${what}` : tool,
            rawInput: req.input,
          },
          options: [
            { optionId: 'allow', name: 'Permitir', kind: 'allow_once' },
            { optionId: 'deny', name: 'Recusar', kind: 'reject_once' },
          ],
        } as RequestPermissionRequest
        // Sem resposta (diálogo fechado, sem janela, erro) conta como recusa.
        const choice = await callbacks
          .onPermissionRequest?.(request, permissions.signal)
          .catch(() => undefined)
        write({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response:
              choice === 'allow'
                ? { behavior: 'allow', updatedInput: req.input ?? {} }
                : {
                    behavior: 'deny',
                    message: 'A pessoa recusou no Orchbot. Não tente de novo por outro caminho.',
                  },
          },
        })
      }
      const lines = createInterface({ input: launched.stdout, crlfDelay: Number.POSITIVE_INFINITY })
      lines.on('line', (line) => {
        if (interrupted || failure || !line.trim()) return
        let event: CliEvent
        try {
          event = JSON.parse(line)
        } catch {
          return
        }
        if (!event || typeof event !== 'object') return
        if (stdinPrompt !== undefined && event.type === 'control_request') {
          void answerPermission(event)
          return
        }
        try {
          if (provider === 'codex') {
            if (event.type === 'thread.started') capture(event.thread_id)
            if (
              (event.type === 'item.completed' || event.type === 'item.updated') &&
              event.item?.type === 'agent_message' &&
              typeof event.item.text === 'string'
            ) {
              messages.set(
                typeof event.item.id === 'string' ? event.item.id : 'message',
                event.item.text,
              )
              updateText([...messages.values()].join('\n\n'))
            }
            if (event.type === 'turn.failed')
              failure =
                typeof event.error?.message === 'string'
                  ? event.error.message
                  : 'O turno Codex falhou.'
            if (event.type === 'error' && typeof event.message === 'string')
              diagnostic = event.message
            if (event.type === 'turn.completed') {
              completed = true
              const usage = parseCodexUsage(event)
              if (usage) {
                const home =
                  config?.cliProfile?.envKey === 'CODEX_HOME'
                    ? config.cliProfile.directory
                    : undefined
                const context = sessionId ? readCodexContext(sessionId, codexHome(home)) : undefined
                callbacks.onUsage?.({ ...usage, ...context })
              }
            }
          } else {
            if ((event.type === 'system' && event.subtype === 'init') || event.type === 'result') {
              if (event.session_id !== undefined) capture(event.session_id)
            }
            if (
              event.type === 'stream_event' &&
              event.event?.type === 'content_block_delta' &&
              event.event.delta?.type === 'text_delta' &&
              typeof event.event.delta.text === 'string'
            )
              updateText(fullText + event.event.delta.text)
            if (event.type === 'result') {
              if (stdinPrompt !== undefined) launched.stdin.end()
              if (event.is_error || (event.subtype && event.subtype !== 'success')) {
                failure = Array.isArray(event.errors)
                  ? event.errors.filter((error: unknown) => typeof error === 'string').join('\n')
                  : ''
                failure ||=
                  typeof event.result === 'string' ? event.result : 'O turno Claude falhou.'
              } else {
                if (typeof event.result === 'string') updateText(event.result)
                completed = true
                const usage = parseClaudeUsage(event)
                if (usage) callbacks.onUsage?.(usage)
              }
            }
          }
        } catch (error) {
          failure = error instanceof Error ? error.message : 'Falha ao registrar sessão CLI.'
          terminate()
        }
      })
      child.stderr?.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString('utf8')).slice(-8192)
      })
      child.once('error', (error) => {
        failure = error.message
      })
      child.once('close', finish)
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      finish(null)
    }
  })
  return {
    interrupt: () => {
      if (!interrupted && !settled) {
        interrupted = true
        permissions.abort()
        terminate()
      }
    },
  }
}
