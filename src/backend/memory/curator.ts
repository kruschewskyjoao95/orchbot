import type { MemoryKind } from '../../shared/types'

/** O que o passo do curador pode devolver. Procedimento nunca entra em `fact`. */
export interface CuratorPlan {
  fact?: { text: string; kind: MemoryKind }
  update?: { id: string; text: string }
  forget: string[]
  skill?: { slug: string; description: string; body: string }
}

const MAX_FACT = 500

/** Lista, checklist ou mais de uma linha é procedimento, não fato. */
export function isProcedure(text: string): boolean {
  return /\n/.test(text) || /^\s*(?:\d+[.)]|[-*])\s+\S/m.test(text)
}

function oneFact(value: unknown): { text: string; kind: MemoryKind } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const text = (value as { text?: unknown }).text
  const kind = (value as { kind?: unknown }).kind
  if (typeof text !== 'string') return undefined
  const clean = text.trim()
  if (!clean || isProcedure(clean)) return undefined
  return { text: clean.slice(0, MAX_FACT), kind: kind === 'task' ? 'task' : 'preference' }
}

function oneUpdate(value: unknown): { id: string; text: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const id = (value as { id?: unknown }).id
  const text = (value as { text?: unknown }).text
  if (typeof id !== 'string' || typeof text !== 'string') return undefined
  const clean = text.trim()
  if (!id.trim() || !clean || isProcedure(clean)) return undefined
  return { id: id.trim(), text: clean.slice(0, MAX_FACT) }
}

function oneSkill(value: unknown): CuratorPlan['skill'] {
  if (!value || typeof value !== 'object') return undefined
  const slug = (value as { slug?: unknown }).slug
  const description = (value as { description?: unknown }).description
  const body = (value as { body?: unknown }).body
  if (typeof slug !== 'string' || typeof description !== 'string' || typeof body !== 'string')
    return undefined
  if (!slug.trim() || !description.trim() || !body.trim()) return undefined
  return {
    slug: slug.trim().slice(0, 80),
    description: description.trim().slice(0, 300),
    body: body.trim().slice(0, 8000),
  }
}

/** null quando não há JSON. Plano vazio é válido: nada mudou. */
export function parseCuratorPlan(raw: string): CuratorPlan | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  try {
    const value = JSON.parse(json) as unknown
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const forget = Array.isArray(record.forget)
      ? record.forget
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
          .slice(0, 5)
      : []
    return {
      fact: oneFact(record.fact),
      update: oneUpdate(record.update),
      forget,
      skill: oneSkill(record.skill),
    }
  } catch {
    return null
  }
}

export function curatorPrompt(memories: string, transcript: string): string {
  return [
    'Você é o curador da memória deste robô. Este passo é só seu: não escreva a resposta ao usuário.',
    'Devolva SOMENTE este JSON:',
    '{"fact":{"text":"uma frase","kind":"preference"},"update":{"id":"id","text":"frase nova"},"forget":["id"],"skill":{"slug":"nome-curto","description":"quando usar","body":"passos em markdown"}}',
    'fact é um fato do trabalho deste robô. kind "preference" dura meses; "task" dura dias. Uma frase, sem lista.',
    'update troca o texto de uma memória pelo id curto mostrado. forget lista ids obsoletos ou duplicados.',
    'Procedimento, checklist e formato de saída vão em skill, nunca em fact ou update.',
    'Fato da empresa (o que vende, preço, tom, clientes) não entra aqui. Nada de senhas ou chaves.',
    'Use null na chave que não mudar. No máximo um fact, um update e uma skill.',
    `\nMemórias atuais:\n${memories || '(nenhuma)'}`,
    `\nConversa recente:\n${transcript}`,
  ].join('\n')
}
