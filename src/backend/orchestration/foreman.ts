import type { Agent } from '../../shared/types'
import type { OrchbotDatabase } from '../storage/db'

export const FOREMAN_NAME = 'Coordenador'

export const FOREMAN_DESCRIPTION =
  'Recebe o pedido, distribui para a equipe e grava o cérebro do projeto. Não aparece como colega.'

/** Reescrito em todo início. A conversa fica; preferência, skill, agenda e conta não. */
export const FOREMAN_INSTRUCTIONS = [
  'Você é o coordenador fixo do Orchbot. A pessoa fala só com você.',
  'Você não é um colega da lista, não guarda preferência pessoal, não tem skill, não tem agenda e não tem conta própria.',
  'Seu trabalho é entender o pedido, distribuir para a equipe e gravar fato da empresa no cérebro do projeto.',
  'Divida o trabalho e delegue aos especialistas com [[DELEGAR:Nome]] e [[/DELEGAR]]. Não faça o trabalho deles.',
  'Fato da empresa (quem é o cliente, como falamos, o que vendemos) vai em [[BRAIN:write]]. Preferência pessoal não entra no cérebro nem na memória.',
  'Não use [[MEMORY:remember]], [[SKILL]] nem rotina. Isso é recusado.',
  'Se esta conversa não estiver numa pasta de projeto, peça à pessoa para escolher a pasta antes de gravar no cérebro.',
  'Quando chegar [RESULTADO DO ESPECIALISTA ...], resuma em linguagem simples.',
].join('\n')

export function isForeman(agent: { systemRole?: string } | null | undefined): boolean {
  return agent?.systemRole === 'foreman'
}

/** No turno do coordenador, a pasta é a da conversa, não a do cadastro (ele não tem). */
export function withForemanProject(agent: Agent, projectId: string | undefined): Agent {
  if (!isForeman(agent) || !projectId) return agent
  return { ...agent, projectId }
}

/**
 * Um coordenador por app. Nasce se houver uma IA ligada e, em todo boot,
 * volta ao texto canônico e perde memória, skill, agenda, conta e conector.
 * A conversa (threads) permanece.
 */
export function ensureForeman(db: OrchbotDatabase): Agent | null {
  let agent = db.findForeman()
  const enabled = db.listConnections().filter((connection) => connection.enabled)
  if (!agent) {
    const connection = enabled[0]
    // shortcut: sem conexão ligada ele não nasce agora; a lista de agentes tenta de novo neste boot.
    if (!connection) return null
    agent = db.createAgent({
      name: FOREMAN_NAME,
      avatar: '👑',
      role: 'orchestrator',
      description: FOREMAN_DESCRIPTION,
      provider: connection.providerId,
      model: connection.defaultModel,
      effort: 'high',
      instructions: FOREMAN_INSTRUCTIONS,
      workspacePath: '',
      autonomyLevel: 'autonomous',
      browserAccess: false,
      localScripts: false,
      startsNewChats: false,
      computerUse: false,
    })
    db.markForeman(agent.id)
  } else if (!db.getConnection(agent.provider)) {
    const connection = enabled[0]
    if (!connection) return agent
    agent = db.updateAgent({
      id: agent.id,
      provider: connection.providerId,
      model: connection.defaultModel,
    })
  }

  db.stripPersonalState(agent.id)
  if (!db.getConnection(agent.provider)) return db.getAgent(agent.id)
  return db.updateAgent({
    id: agent.id,
    name: FOREMAN_NAME,
    avatar: '👑',
    role: 'orchestrator',
    description: FOREMAN_DESCRIPTION,
    instructions: FOREMAN_INSTRUCTIONS,
    accountId: null,
    projectId: null,
    handoffAgentId: null,
    effort: 'high',
    browserAccess: false,
    localScripts: false,
    startsNewChats: false,
    computerUse: false,
  })
}
