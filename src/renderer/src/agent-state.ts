import type { TaskQueueItem } from '../../shared/types'

/** O que a barra lateral mostra ao lado de cada agente. */
export type AgentState = 'working' | 'failed' | 'paused' | 'responded' | 'idle'

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  working: 'Trabalhando…',
  failed: 'Falhou: abra para ver',
  paused: 'Fila pausada',
  responded: 'Respondeu',
  idle: '',
}

/** Estados que pedem você: aparecem em "Precisa de você", no topo da barra lateral. */
export const needsYou = (state: AgentState) => state === 'failed' || state === 'paused'

/**
 * Estado pela fila do agente (mais recente primeiro, como `getQueue` devolve). Algo rodando vence;
 * depois, a última tarefa encerrada diz se falhou. Pausa só aparece quando não há nada rodando.
 */
export function stateFromQueue(tasks: TaskQueueItem[], paused: boolean): AgentState {
  if (tasks.some((t) => t.status === 'running')) return 'working'
  if (paused) return 'paused'
  const last = tasks.find((t) => t.status !== 'pending')
  return last?.status === 'failed' ? 'failed' : 'idle'
}

/** Próximo estado quando uma tarefa do agente muda (evento da fila). */
export function stateFromTask(
  current: AgentState,
  task: TaskQueueItem,
  isOpen: boolean,
): AgentState {
  if (task.status === 'running') return 'working'
  if (task.status === 'failed') return 'failed'
  if (task.status === 'completed') return isOpen ? 'idle' : 'responded'
  if (task.status === 'cancelled' || task.status === 'interrupted')
    return current === 'paused' ? 'paused' : 'idle'
  return current
}
