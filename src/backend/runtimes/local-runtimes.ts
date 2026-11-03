import type { LocalRuntime } from '../../shared/types'

const CANDIDATES = [
  {
    id: 'ollama',
    name: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    probe: 'http://127.0.0.1:11434/api/tags',
    pick: (j: { models?: { name?: unknown }[] }) => (j?.models ?? []).map((m) => m?.name),
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    endpoint: 'http://127.0.0.1:1234/v1',
    probe: 'http://127.0.0.1:1234/v1/models',
    pick: (j: { data?: { id?: unknown }[] }) => (j?.data ?? []).map((m) => m?.id),
  },
] as const

/** Procura servidores de modelos locais respondendo em loopback (nada sai da máquina). */
export async function detectLocalRuntimes(
  configuredEndpoints: string[] = [],
  fetcher: typeof fetch = fetch,
): Promise<LocalRuntime[]> {
  const norm = (u: string) => u.replace('localhost', '127.0.0.1').replace(/\/+$/, '')
  const configured = new Set(configuredEndpoints.map(norm))
  const found = await Promise.all(
    CANDIDATES.map(async (c): Promise<LocalRuntime | null> => {
      try {
        const res = await fetcher(c.probe, { signal: AbortSignal.timeout(1200) })
        if (!res.ok) return null
        const models = (c.pick(await res.json()) as unknown[]).filter(
          (m): m is string => typeof m === 'string',
        )
        return {
          id: c.id,
          name: c.name,
          endpoint: c.endpoint,
          models,
          configured: configured.has(norm(c.endpoint)),
        }
      } catch {
        return null
      }
    }),
  )
  return found.filter((r): r is LocalRuntime => r !== null)
}
