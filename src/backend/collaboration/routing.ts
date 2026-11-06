import type { Agent } from '../../shared/types'

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const STOP = new Set(
  'para como pelo pela pelos pelas sobre entre uma umas uns dos das que com sem seu sua seus suas isso esta este esse essa fazer criar pode preciso quero por mais muito deve tarefa trabalho agente colega ajuda ajudar'.split(
    ' ',
  ),
)
const tokens = (value: string) =>
  new Set(
    normalize(value)
      .match(/[a-z0-9]{3,}/g)
      ?.filter((word) => !STOP.has(word)) ?? [],
  )

/** shortcut: termos exatos em português, sem inferência semântica; ampliar só com corpus medido. */
export function routeChannel(
  text: string,
  agents: Pick<Agent, 'id' | 'name' | 'description'>[],
  ownerId: string,
): { agentId: string; reason: string } {
  const mentions = [...text.matchAll(/@(?:"([^"]+)"|([^\s@,;:!?]+))/g)].map((match) =>
    normalize(match[1] ?? match[2]),
  )
  if (mentions.length) {
    const matches = agents.filter((agent) => mentions.includes(normalize(agent.name)))
    if (mentions.length === 1 && matches.length === 1)
      return { agentId: matches[0].id, reason: '@menção exata' }
    return { agentId: ownerId, reason: 'menção ambígua ou desconhecida; dono mantido' }
  }
  const vocabulary = agents.map((agent) => tokens(`${agent.name} ${agent.description ?? ''}`))
  const request = tokens(text)
  const scores = vocabulary.map(
    (words, index) =>
      [...words].filter(
        (word) =>
          request.has(word) && !vocabulary.some((other, i) => i !== index && other.has(word)),
      ).length,
  )
  const candidates = scores
    .map((score, index) => ({ score, index }))
    .filter((entry) => entry.score >= 2)
  if (
    candidates.length === 1 &&
    scores.every((score, i) => i === candidates[0].index || score === 0)
  )
    return {
      agentId: agents[candidates[0].index].id,
      reason: 'dois ou mais termos exclusivos do nome/descrição',
    }
  return { agentId: ownerId, reason: 'sinal insuficiente ou misto; dono mantido' }
}
