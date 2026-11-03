import type { Agent } from '../../shared/types'
import { resolveAgent } from './resolve-agent'

export interface DelegationDirective {
  /** Nome ou id do robô especialista, como escrito pelo orquestrador. */
  target: string
  task: string
}

export interface ResolvedDelegation extends DelegationDirective {
  agent: Agent
}

/**
 * Protocolo de delegação do orquestrador.
 * O modelo emite blocos ao final da resposta:
 *
 * [[DELEGAR:Nome do Robô]]
 * tarefa detalhada para o especialista
 * [[/DELEGAR]]
 */
export const DELEGATION_OPEN = '[[DELEGAR:'
export const MAX_ORCHESTRATION_DEPTH = 3

const BLOCK_RE = /\[\[DELEGAR:([^\]]+)\]\]([\s\S]*?)\[\[\/DELEGAR\]\]/g

export function parseDelegationDirectives(text: string): DelegationDirective[] {
  const directives: DelegationDirective[] = []
  for (const match of text.matchAll(BLOCK_RE)) {
    const target = match[1]?.trim()
    const task = match[2]?.trim()
    if (target && task) directives.push({ target, task })
  }
  return directives
}

export function stripDelegationDirectives(text: string): string {
  return text.replace(BLOCK_RE, '').trim()
}

export function resolveDelegations(
  directives: DelegationDirective[],
  roster: Agent[],
): { resolved: ResolvedDelegation[]; unknownTargets: string[] } {
  const resolved: ResolvedDelegation[] = []
  const unknownTargets: string[] = []
  for (const directive of directives) {
    const { match: agent } = resolveAgent(directive.target, roster)
    if (agent) resolved.push({ ...directive, agent })
    else unknownTargets.push(directive.target)
  }
  return { resolved, unknownTargets }
}

/** Equipe que o orquestrador pode comandar: mesmo projeto, ou todos se ele não tiver projeto. */
export function teamForOrchestrator(orchestrator: Agent, allAgents: Agent[]): Agent[] {
  return allAgents.filter((a) => {
    if (a.id === orchestrator.id) return false
    if (a.role === 'orchestrator') return false
    if (orchestrator.projectId) return a.projectId === orchestrator.projectId
    return true
  })
}

export function buildOrchestratorInstructions(orchestrator: Agent, team: Agent[]): string {
  const roster =
    team.length > 0
      ? team
          .map(
            (a) =>
              `- ${a.name} (id: ${a.id}, ${a.provider}/${a.model}${a.effort ? `, esforço ${a.effort}` : ''})${a.description ? `: ${a.description}` : ''}`,
          )
          .join('\n')
      : '(nenhum especialista disponível no momento)'

  return [
    '[PAPEL: ORQUESTRADOR]',
    `Você é o orquestrador ${orchestrator.name}. O usuário fala só com você.`,
    'Sua equipe de especialistas (você NÃO executa o trabalho deles, você delega):',
    roster,
    '',
    'Como delegar: ao final da sua resposta, emita um bloco para cada subtarefa:',
    `${DELEGATION_OPEN}Nome do Robô]]`,
    'tarefa completa e detalhada para o especialista',
    '[[/DELEGAR]]',
    '',
    'Regras: delegue apenas o que um especialista faz melhor; tarefas independentes podem ir em blocos separados no mesmo turno.',
    'Quando receber mensagens começando com [RESULTADO DO ESPECIALISTA ...], resuma o resultado para o usuário em linguagem clara, sem repetir o bloco de delegação.',
    'Se nenhum especialista for necessário, responda você mesmo, sem blocos.',
  ].join('\n')
}

/** Robô com startsNewChats pode abrir uma conversa nova: [[NOVO-CHAT:título]] tarefa [[/NOVO-CHAT]] (máx. 1 por turno). */
const NEW_CHAT_RE = /\[\[NOVO-CHAT:([^\]]+)\]\]([\s\S]*?)\[\[\/NOVO-CHAT\]\]/

export function parseNewChatDirective(text: string): { title: string; task: string } | null {
  const match = NEW_CHAT_RE.exec(text)
  if (!match) return null
  const title = match[1]?.trim()
  const task = match[2]?.trim()
  return title && task ? { title, task } : null
}

export function stripNewChatDirectives(text: string): string {
  return text.replace(new RegExp(NEW_CHAT_RE.source, 'g'), '').trim()
}
