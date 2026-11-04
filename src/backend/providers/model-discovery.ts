import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { ProviderModelInfo } from '../../shared/types'
import { isProviderEffort } from '../../shared/types'
import { buildProviderEnv, resolveCliCommand } from './cli-utils'
import type { ProviderRuntimeConfig } from './types'

export function parseProviderModels(value: unknown): ProviderModelInfo[] {
  if (!Array.isArray(value)) return []
  const models = new Map<string, ProviderModelInfo>()
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const id = row.resolvedModel || row.model || row.value || row.slug || row.id
    if (typeof id !== 'string' || !id.trim() || models.has(id)) continue
    const rawEfforts =
      row.supportedReasoningEfforts ?? row.supportedEffortLevels ?? row.supported_reasoning_levels
    const supportedEfforts = Array.isArray(rawEfforts)
      ? [
          ...new Set(
            rawEfforts
              .map((e) => (typeof e === 'string' ? e : (e?.reasoningEffort ?? e?.effort)))
              .filter(isProviderEffort),
          ),
        ]
      : undefined
    const defaultEffort = row.defaultReasoningEffort ?? row.default_reasoning_level
    models.set(id, {
      id,
      displayName:
        typeof row.displayName === 'string'
          ? row.displayName
          : typeof row.display_name === 'string'
            ? row.display_name
            : undefined,
      supportedEfforts:
        row.supportsEffort === false || (typeof row.value === 'string' && rawEfforts === undefined)
          ? []
          : supportedEfforts,
      defaultEffort:
        row.supportsEffort !== false && supportedEfforts?.includes(defaultEffort)
          ? defaultEffort
          : undefined,
    })
  }
  return [...models.values()]
}

/** Consulta metadados sem enviar prompt ou iniciar um turno de trabalho. */
export function probeModelCatalog(
  provider: 'codex' | 'claude',
  config?: ProviderRuntimeConfig,
): Promise<ProviderModelInfo[]> {
  return new Promise((resolve) => {
    const child = spawn(
      resolveCliCommand(provider, config?.cliPath),
      provider === 'codex'
        ? ['app-server']
        : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
      { cwd: tmpdir(), env: buildProviderEnv(config), stdio: ['pipe', 'pipe', 'ignore'] },
    )
    let settled = false
    let buffer = ''
    const models: ProviderModelInfo[] = []
    const finish = (result: ProviderModelInfo[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdin.destroy()
      child.kill()
      resolve(result)
    }
    const timer = setTimeout(() => finish([]), 15000)
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`)
    child.on('error', () => finish([]))
    child.on('close', () => finish([]))
    child.stdin.on('error', () => finish([]))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (settled) return
      buffer += chunk
      if (buffer.length > 4 * 1024 * 1024) return finish([])
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (settled) break
        try {
          const message = JSON.parse(line)
          if (provider === 'claude') {
            if (message.type === 'control_response' && message.response?.request_id === 'models')
              finish(parseProviderModels(message.response?.response?.models))
          } else if (message.id === 1) {
            if (message.error) return finish([])
            send({ method: 'initialized', params: {} })
            send({ id: 2, method: 'model/list', params: { limit: 100, includeHidden: false } })
          } else if (message.id === 2) {
            if (message.error) return finish([])
            models.push(...parseProviderModels(message.result?.data))
            const cursor = message.result?.nextCursor
            if (cursor)
              send({
                id: 2,
                method: 'model/list',
                params: { limit: 100, includeHidden: false, cursor },
              })
            else finish([...new Map(models.map((m) => [m.id, m])).values()])
          }
        } catch {
          // Alguns CLIs imprimem avisos fora do protocolo JSON.
        }
      }
    })
    if (provider === 'claude')
      send({ request_id: 'models', type: 'control_request', request: { subtype: 'initialize' } })
    else
      send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'orchbot', version: '0.1.0' } },
      })
  })
}
