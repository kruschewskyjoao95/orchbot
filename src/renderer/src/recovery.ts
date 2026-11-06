import type { Message, ThreadSnapshot } from '../../shared/types'

export function snapshotIsCurrent(
  snapshot: ThreadSnapshot,
  activeThreadId: string | undefined,
  observedRevision: number,
): boolean {
  return snapshot.threadId === activeThreadId && snapshot.revision >= observedRevision
}

export function mergeMessage(messages: Message[], message: Message): Message[] {
  return messages.some((item) => item.id === message.id)
    ? messages.map((item) => (item.id === message.id ? message : item))
    : [...messages, message]
}
