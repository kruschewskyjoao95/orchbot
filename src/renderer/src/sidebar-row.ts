const PREVIEW_MAX = 80

export function agentPreview(lastMessage?: string, description?: string): string {
  const text = (lastMessage ?? '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, PREVIEW_MAX)
  const fallback = (description ?? '').trim()
  return fallback || 'Pronto para ajudar'
}

export function isAgentUnread(input: { unread?: boolean; pendingApproval: boolean }): boolean {
  return Boolean(input.unread) || input.pendingApproval
}

export function sortSidebarAgents<T extends { pinned?: boolean }>(agents: T[]): T[] {
  return [...agents].sort(
    (left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)),
  )
}
