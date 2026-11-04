export type BrainAction = 'search' | 'read' | 'propose' | 'write' | 'decide' | 'proposals'

export interface BrainDirective {
  action: BrainAction
  body: string
}

export interface BrainPageDraft {
  slug: string
  title: string
  /** null quando o bloco não declarou o tipo. */
  type: 'company' | 'product' | 'note' | null
  content: string
  reason: string
  source: string
}

const ACTIONS: BrainAction[] = ['search', 'read', 'propose', 'write', 'decide', 'proposals']
const BLOCK_RE = /\[\[BRAIN:([a-z]+)\]\]([\s\S]*?)\[\[\/BRAIN\]\]/gi
const TYPES = new Set(['company', 'product', 'note'])
const UNCONFIRMED_HEADING = /^(#{1,6})\s+(.+?)\s*<!--\s*não confirmado\s*-->\s*$/gm

export const BRAIN_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const BRAIN_MAX_CONTENT = 32_000

export function parseBrainDirectives(text: string): BrainDirective[] {
  const out: BrainDirective[] = []
  for (const match of text.matchAll(BLOCK_RE)) {
    const action = match[1].toLowerCase() as BrainAction
    if (!ACTIONS.includes(action)) continue
    out.push({ action, body: (match[2] ?? '').trim() })
  }
  return out
}

export const stripBrainDirectives = (text: string) => text.replace(BLOCK_RE, '').trim()

/** search, read e a lista de propostas devolvem conteúdo e pedem outro turno. */
export function needsBrainFollowUp(directives: BrainDirective[]): boolean {
  return directives.some(
    (d) => d.action === 'search' || d.action === 'read' || d.action === 'proposals',
  )
}

/** Títulos de seção marcados com `<!-- não confirmado -->`. */
export function unconfirmedHeadings(content: string): string[] {
  const out: string[] = []
  for (const match of content.matchAll(UNCONFIRMED_HEADING)) {
    const title = match[2]?.trim()
    if (title) out.push(title)
  }
  return out
}

/** Cabeçalho `chave: valor` até uma linha `---`; o resto é a página inteira. */
export function parsePageDraft(body: string): BrainPageDraft | { error: string } {
  const parts = body.split(/\r?\n---\r?\n/)
  if (parts.length < 2) return { error: 'falta a página inteira depois de uma linha ---.' }
  const content = parts.slice(1).join('\n---\n').trim()
  if (!content) return { error: 'a página veio vazia. Mande a página inteira, não um trecho.' }
  const fields: Record<string, string> = {}
  for (const line of parts[0].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z]+):\s*(.*)$/)
    if (field) fields[field[1].toLowerCase()] = field[2].trim()
  }
  const title = fields.title || fields.titulo || ''
  const slug = (fields.slug || '').toLowerCase()
  const typeRaw = (fields.type || fields.tipo || '').toLowerCase()
  const type = TYPES.has(typeRaw) ? (typeRaw as BrainPageDraft['type']) : null
  return {
    slug,
    title,
    type,
    content,
    reason: fields.reason || fields.motivo || '',
    source: fields.source || fields.fonte || '',
  }
}

export function parseBrainDecision(
  body: string,
): { id: string; accept: boolean } | { error: string } {
  const match = body.trim().match(/^(\S+)\s+(aceitar|dispensar)$/i)
  if (!match) return { error: 'use [[BRAIN:decide]] id aceitar [[/BRAIN]] ou id dispensar.' }
  return { id: match[1], accept: match[2].toLowerCase() === 'aceitar' }
}
