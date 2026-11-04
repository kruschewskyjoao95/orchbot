import type { BrowserPageContent, BrowserPageInput, BrowserPageLink } from '../../shared/types'

// Formato conhecido (rótulo, GitHub, AWS, JWT, Bearer). Sem "texto longo": caminho e hash ficam.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /((?:api[_-]?key|access[_-]?token|secret|password|bearer|authorization)[\s=:'"]+)([A-Za-z0-9_\-\.]{6,})/gi,
    '$1[REDACTED_SECRET]',
  ],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g, '[REDACTED_SECRET]'],
  [/\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/g, '[REDACTED_SECRET]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_SECRET]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_SECRET]'],
]

export function sanitizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    throw new Error('URL vazia')
  }

  let parsed: URL
  try {
    if (trimmed.includes('://') || trimmed.startsWith('javascript:')) {
      parsed = new URL(trimmed)
    } else {
      parsed = new URL(`https://${trimmed}`)
    }
  } catch {
    throw new Error(`URL inválida: ${trimmed}`)
  }

  // Apenas http e https são permitidos
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Protocolo proibido (${parsed.protocol}). Apenas HTTP e HTTPS são permitidos.`)
  }

  // Previne acesso a esquemas especiais e arquivos locais
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
    // Permitido para desenvolvimento local, mas não para esquemas file://
  }

  return parsed.toString()
}

export function redactSecrets(text: string): string {
  let result = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

export function sanitizeHtmlToText(html: string): string {
  // Remove scripts, styles, iframes
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')

  // Remove tags HTML
  cleaned = cleaned.replace(/<[^>]+>/g, ' ')

  // Decodifica entidades básicas comuns
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

  // Normaliza múltiplos espaços
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return redactSecrets(cleaned)
}

export function parsePageDomSummary(
  tabId: string,
  url: string,
  title: string,
  rawHtmlOrBody: string,
  rawLinks: BrowserPageLink[] = [],
  rawInputs: BrowserPageInput[] = [],
): BrowserPageContent {
  const cleanSummary = sanitizeHtmlToText(rawHtmlOrBody).slice(0, 4000)

  const sanitizedLinks: BrowserPageLink[] = rawLinks
    .filter(
      (l) =>
        l.href &&
        (l.href.startsWith('http://') || l.href.startsWith('https://') || l.href.startsWith('/')),
    )
    .slice(0, 50)
    .map((l) => ({
      text: redactSecrets(l.text.trim().slice(0, 100)),
      href: l.href,
    }))

  const sanitizedInputs: BrowserPageInput[] = rawInputs.slice(0, 30).map((inp) => ({
    name: inp.name ? redactSecrets(inp.name) : undefined,
    id: inp.id,
    type: inp.type || 'text',
    placeholder: inp.placeholder ? redactSecrets(inp.placeholder) : undefined,
    selector: inp.selector,
  }))

  return {
    tabId,
    url,
    title: redactSecrets(title),
    textSummary: cleanSummary,
    links: sanitizedLinks,
    inputs: sanitizedInputs,
  }
}
