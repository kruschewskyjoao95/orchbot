export type CollabKind = 'AGENT' | 'CHANNEL'

export interface CollabDirective {
  kind: CollabKind
  action: string
  /** Texto antes de "::" (destinatário / id da mensagem) quando houver. */
  target: string
  body: string
}

const BLOCK_RE = /\[\[(AGENT|CHANNEL):([a-z]+)\]\]([\s\S]*?)\[\[\/(?:AGENT|CHANNEL)\]\]/gi
const VALID: Record<CollabKind, string[]> = {
  AGENT: ['list', 'send', 'reply', 'react', 'file'],
  CHANNEL: ['ask'],
}
/** Ações em que o texto vem como `alvo :: conteúdo`. */
const SPLIT = new Set(['send', 'reply', 'react', 'file', 'ask'])

export function parseCollabDirectives(text: string): CollabDirective[] {
  const out: CollabDirective[] = []
  for (const m of text.matchAll(BLOCK_RE)) {
    const kind = m[1].toUpperCase() as CollabKind
    const action = m[2].toLowerCase()
    if (!VALID[kind].includes(action)) continue
    const raw = m[3].trim()
    if (SPLIT.has(action)) {
      const i = raw.indexOf('::')
      if (i < 0) continue
      const target = raw.slice(0, i).trim()
      const body = raw.slice(i + 2).trim()
      if (target && body) out.push({ kind, action, target, body })
    } else out.push({ kind, action, target: '', body: raw })
  }
  return out
}

export function stripCollabDirectives(text: string): string {
  return text.replace(BLOCK_RE, '').trim()
}

export const needsCollabFollowUp = (d: CollabDirective[]) =>
  d.some((x) => x.kind === 'AGENT' && x.action === 'list')

export function buildCollabInstructions(): string {
  return [
    '[CONVERSA ENTRE AGENTES]',
    'Você pode falar direto com outros agentes do seu projeto. Blocos ao final da resposta:',
    '[[AGENT:list]] [[/AGENT]]  (lista os agentes disponíveis)',
    '[[AGENT:send]] Nome do agente :: mensagem [[/AGENT]]',
    '[[AGENT:reply]] id-da-mensagem :: resposta [[/AGENT]]  (responde a uma mensagem recebida; o id aparece como "id abcd1234")',
    '[[AGENT:react]] id-da-mensagem :: 👍 [[/AGENT]]  (só reage, sem gastar um turno do outro agente)',
    '[[AGENT:file]] Nome do agente :: caminho/relativo/ao/seu/workspace [[/AGENT]]  (copia o arquivo para o workspace do outro)',
    'Seja objetivo, não responda por educação (use react) e evite trocar mensagens em loop.',
  ].join('\n')
}
