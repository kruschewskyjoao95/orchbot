import type { Approval, Message } from '../../shared/types'
import { type AgentState, needsYou } from './agent-state'

export type ChatItem =
  | { type: 'message'; message: Message }
  | { type: 'approval'; approval: Approval }

export function mergeChatItems(messages: Message[], approvals: Approval[]): ChatItem[] {
  const items: ChatItem[] = [
    ...messages.map((message) => ({ type: 'message' as const, message })),
    ...approvals.map((approval) => ({ type: 'approval' as const, approval })),
  ]
  return items.sort((a, b) => {
    const left = a.type === 'message' ? a.message.createdAt : a.approval.createdAt
    const right = b.type === 'message' ? b.message.createdAt : b.approval.createdAt
    if (left !== right) return left < right ? -1 : 1
    const leftId = a.type === 'message' ? a.message.id : a.approval.id
    const rightId = b.type === 'message' ? b.message.id : b.approval.id
    return leftId < rightId ? -1 : 1
  })
}

export function approvalReceipt(approval: Approval): string {
  if (approval.kind === 'question') {
    if (approval.status === 'approved') return `Respondeu: ${approval.note || '(sem texto)'}`
    return `Pergunta pulada: ${approval.text}`
  }
  if (approval.status === 'approved') return `Aprovado: ${approval.text}`
  return `Recusado: ${approval.text}`
}

export function waitingOnYou(state: AgentState, hasPendingApproval: boolean): boolean {
  return needsYou(state) || hasPendingApproval
}
