import { describe, expect, it } from 'vitest'
import { routeChannel } from '../src/backend/collaboration/routing'

// Corpus manual e local: casos esperados definidos por domínio, não mede modelos de linguagem.
const agents = [
  { id: 'dono', name: 'Coordenação', description: 'coordenação planejamento prioridades' },
  { id: 'qa', name: 'Ana Testes', description: 'testes regressão qualidade vitest' },
  { id: 'ui', name: 'Bruno Interface', description: 'interface design acessibilidade css' },
  { id: 'db', name: 'Carla Dados', description: 'banco sql migração sqlite' },
]
const PORTUGUESE_ROUTING_CASES = [
  ['Revisar testes de regressão do webhook.', 'qa'],
  ['Os testes no vitest estão falhando.', 'qa'],
  ['Avalie a qualidade dos testes.', 'qa'],
  ['Quero melhorar a acessibilidade da interface.', 'ui'],
  ['Ajuste o design usando CSS.', 'ui'],
  ['Revise a interface e o CSS do formulário.', 'ui'],
  ['Faça uma migração no banco.', 'db'],
  ['Corrija o SQL do sqlite.', 'db'],
  ['O banco sqlite não abre.', 'db'],
  ['Revise isto, por favor.', 'dono'],
  ['Preciso consertar um erro na tela.', 'dono'],
  ['Os testes precisam melhorar.', 'dono'],
  ['Qualidade da interface.', 'dono'],
  ['Testes de regressão e design CSS.', 'dono'],
  ['Banco SQL e testes de regressão.', 'dono'],
  ['Não sei qual colega pode ajudar.', 'dono'],
  ['Migração estranha em produção.', 'dono'],
  ['Bruno, poderia olhar isso?', 'dono'],
  ['@"Ana Testes" revise o design CSS.', 'qa'],
  ['@"Carla Dados" veja este problema.', 'db'],
  ['@"Bruno Interface" reveja os testes vitest.', 'ui'],
  ['@"Pessoa ausente" corrija os testes vitest.', 'dono'],
  ['@"Ana Testes" @"Carla Dados" revisem.', 'dono'],
  ['TESTES e REGRESSÃO precisam de atenção.', 'qa'],
] as const

describe('routing conservador em português', () => {
  it.each(PORTUGUESE_ROUTING_CASES)('%s → %s', (text, expected) => {
    expect(routeChannel(text, agents, 'dono').agentId).toBe(expected)
  })
  it('não escolhe entre nomes/descrições idênticos nem eleva quem está fora dos participantes', () => {
    expect(
      routeChannel('@"Ana Testes" faça', [...agents, { ...agents[1], id: 'duplicado' }], 'dono')
        .agentId,
    ).toBe('dono')
    expect(routeChannel('testes regressão', [agents[0]], 'dono').agentId).toBe('dono')
  })
  it('registra cobertura e acertos do corpus sem alegar generalização', () => {
    const measured = PORTUGUESE_ROUTING_CASES.map(([text, expected]) => ({
      expected,
      actual: routeChannel(text, agents, 'dono').agentId,
    }))
    expect(measured.filter((entry) => entry.actual === entry.expected)).toHaveLength(24)
    expect(measured.filter((entry) => entry.actual !== 'dono')).toHaveLength(13)
  })
})
