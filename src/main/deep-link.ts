import type { DeepLink } from '../shared/types'

const ID_RE = /^[A-Za-z0-9-]{8,64}$/
const SECTIONS = ['channels', 'skills', 'connections', 'agents'] as const

/**
 * orchbot://agent/<id> · orchbot://channel/<id> · orchbot://new-agent · orchbot://channels|skills|connections|agents
 * Devolve null para qualquer outra coisa: o link vem de fora do app e não é confiável.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'orchbot:') return null
  const host = url.hostname.toLowerCase()
  let id: string
  try {
    id = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''))
  } catch {
    return null // "%" malformado lançaria URIError no processo principal
  }
  if (host === 'agent' && ID_RE.test(id)) return { kind: 'agent', id }
  if (host === 'channel' && ID_RE.test(id)) return { kind: 'channel', id }
  if (host === 'new-agent' && !id) return { kind: 'new-agent' }
  if ((SECTIONS as readonly string[]).includes(host) && !id)
    return { kind: 'section', name: host as (typeof SECTIONS)[number] }
  return null
}

/** Em Linux/Windows o link chega como argumento da linha de comando. */
export function findDeepLinkArg(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith('orchbot://'))
}
