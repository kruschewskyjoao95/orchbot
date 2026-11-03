const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

export interface AgentMatch<T> {
  match?: T
  ambiguous?: T[]
}

/**
 * Resolve um agente citado por um modelo: id exato, nome exato (sem diferenciar caixa/acentos)
 * ou prefixo único de id (8+ caracteres). Pedaços do nome não valem: "a" não pode achar "Ana".
 */
export function resolveAgent<T extends { id: string; name: string }>(
  needle: string,
  roster: T[],
): AgentMatch<T> {
  const raw = needle.trim()
  const byId = roster.find((a) => a.id === raw)
  if (byId) return { match: byId }
  const byName = roster.filter((a) => fold(a.name) === fold(raw))
  if (byName.length === 1) return { match: byName[0] }
  if (byName.length > 1) return { ambiguous: byName }
  if (raw.length >= 8) {
    const byPrefix = roster.filter((a) => a.id.startsWith(raw))
    if (byPrefix.length === 1) return { match: byPrefix[0] }
    if (byPrefix.length > 1) return { ambiguous: byPrefix }
  }
  return {}
}

export function describeMiss<T extends { name: string }>(needle: string, m: AgentMatch<T>): string {
  return m.ambiguous
    ? `"${needle}" é ambíguo (${m.ambiguous.map((a) => a.name).join(', ')}): use o id completo.`
    : `agente "${needle}" não encontrado: use o nome exato (veja [[AGENT:list]]).`
}
