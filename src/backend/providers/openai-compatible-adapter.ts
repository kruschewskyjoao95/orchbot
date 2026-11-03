import { normalizeProviderEndpoint } from '../../shared/custom-providers'
import type { CustomProviderId } from '../../shared/types'
import type {
  ActiveExecution,
  ExecutionCallbacks,
  ExecutionOptions,
  ProviderAdapter,
  ProviderRuntimeConfig,
} from './types'

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function apiError(error: unknown, config?: ProviderRuntimeConfig): string {
  const message = error instanceof Error ? error.message : 'Falha na API do provedor.'
  return config?.apiKey ? message.split(config.apiKey).join('[REDACTED]') : message
}

async function requestApi(
  route: string,
  config: ProviderRuntimeConfig | undefined,
  signal: AbortSignal,
  body?: unknown,
): Promise<Response> {
  const base = normalizeProviderEndpoint(config?.endpoint)
  const response = await fetch(`${base}/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(config?.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    redirect: 'error',
  })
  if (!response.ok) {
    let detail = ''
    try {
      const data = await response.json()
      if (typeof data?.error?.message === 'string') detail = data.error.message.slice(0, 1000)
    } catch {
      /* Some endpoints return HTML or no error body. */
    }
    throw new ApiRequestError(
      response.status,
      `API HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    )
  }
  return response
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  constructor(
    readonly id: CustomProviderId,
    readonly name: string,
  ) {}

  async discoverModels(config?: ProviderRuntimeConfig): Promise<string[]> {
    try {
      const response = await requestApi('models', config, AbortSignal.timeout(15_000))
      const data = await response.json()
      if (!Array.isArray(data?.data)) throw new Error('Resposta inválida de /models.')
      return [
        ...new Set<string>(
          data.data.flatMap((item: unknown) => {
            if (
              item &&
              typeof item === 'object' &&
              'id' in item &&
              typeof item.id === 'string' &&
              item.id
            )
              return [item.id]
            return []
          }),
        ),
      ]
    } catch (error) {
      if (error instanceof ApiRequestError)
        throw new ApiRequestError(error.status, apiError(error, config))
      throw new Error(apiError(error, config))
    }
  }

  async checkAvailability(config?: ProviderRuntimeConfig) {
    try {
      const models = await this.discoverModels(config)
      return {
        available: true,
        version: `API compatível • ${models.length} modelos`,
        readiness: 'unverified' as const,
        error:
          'API acessível. A lista de modelos não comprova autenticação ou permissão para gerar respostas.',
        authStatus: 'unknown' as const,
      }
    } catch (error) {
      return {
        available: false,
        readiness:
          error instanceof ApiRequestError && error.status === 401
            ? ('login_required' as const)
            : ('error' as const),
        authStatus:
          error instanceof ApiRequestError && error.status === 401
            ? ('missing' as const)
            : ('unknown' as const),
        error: apiError(error, config),
      }
    }
  }

  executeTurn(
    prompt: string,
    options: ExecutionOptions,
    callbacks: ExecutionCallbacks,
  ): ActiveExecution {
    const cancel = new AbortController()
    const config = options.providerConfig
    void Promise.resolve().then(async () => {
      let fullText = ''
      let finished = false
      const emit = (text: string) => {
        if (!text || cancel.signal.aborted) return
        fullText += text
        callbacks.onChunk(text, fullText)
      }
      const consume = (data: unknown, streaming: boolean) => {
        if (!data || typeof data !== 'object') throw new Error('Resposta inválida da API.')
        if ('error' in data && data.error) {
          const detail =
            typeof data.error === 'object' && 'message' in data.error
              ? String(data.error.message)
              : 'Falha durante a resposta.'
          throw new Error(detail.slice(0, 1000))
        }
        if (!('choices' in data) || !Array.isArray(data.choices))
          throw new Error('Resposta sem choices na API.')
        const choice = data.choices[0]
        if (!choice) return // Usage-only events have no choices.
        if (typeof choice !== 'object') throw new Error('Choice inválida na API.')
        const message = streaming ? choice.delta : choice.message
        if (message?.tool_calls?.length || choice.finish_reason === 'tool_calls')
          throw new Error(
            'Esta conexão usa chat de texto. Chamadas nativas de ferramentas não são suportadas.',
          )
        if (
          message?.content !== undefined &&
          message.content !== null &&
          typeof message.content !== 'string'
        )
          throw new Error('Conteúdo de resposta inválido na API.')
        if (typeof message?.content === 'string') emit(message.content)
        if (typeof message?.refusal === 'string') emit(message.refusal)
        if (choice.finish_reason === 'length')
          throw new Error('Resposta interrompida pelo limite de tokens do provedor.')
        if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'error')
          throw new Error('O provedor interrompeu a resposta.')
        if (choice.finish_reason) finished = true
      }
      try {
        if (cancel.signal.aborted) return
        if (!options.model?.trim()) throw new Error('Informe o modelo para este provedor.')
        // shortcut: a request lasts at most five minutes; add an idle timeout if long generations need it.
        const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(300_000)])
        const response = await requestApi('chat/completions', config, signal, {
          model: options.model,
          messages: [
            ...(options.instructions ? [{ role: 'system', content: options.instructions }] : []),
            { role: 'user', content: prompt },
          ],
          stream: true,
        })
        if (response.headers.get('content-type')?.includes('application/json')) {
          consume(await response.json(), false)
        } else {
          if (
            !response.headers.get('content-type')?.includes('text/event-stream') ||
            !response.body
          )
            throw new Error('A API não retornou um stream SSE válido.')
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let done = false
          const event = (frame: string) => {
            const payload = frame
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n')
            if (!payload.trim()) return
            if (payload.trim() === '[DONE]') {
              done = true
              finished = true
              return
            }
            consume(JSON.parse(payload), true)
          }
          try {
            while (!done) {
              const next = await reader.read()
              buffer += decoder.decode(next.value, { stream: !next.done })
              const frames = buffer.split(/\r?\n\r?\n/)
              buffer = frames.pop() ?? ''
              for (const frame of frames) {
                if (done) break
                event(frame)
              }
              if (buffer.length > 1024 * 1024)
                throw new Error('Evento SSE excedeu o tamanho permitido.')
              if (next.done) {
                if (buffer.trim() && !done) event(buffer)
                break
              }
            }
          } finally {
            await reader.cancel().catch(() => {})
            reader.releaseLock()
          }
        }
        if (!finished) throw new Error('A conexão terminou antes de concluir a resposta.')
        if (!cancel.signal.aborted) callbacks.onDone(fullText)
      } catch (error) {
        if (!cancel.signal.aborted) callbacks.onError(apiError(error, config))
      }
    })
    return { interrupt: () => cancel.abort() }
  }
}
