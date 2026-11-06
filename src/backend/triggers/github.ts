import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { WebhookTrigger } from '../../shared/types'

export function githubSignature(secret: string, body: Buffer, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false
  return timingSafeEqual(
    Buffer.from(signature.slice(7), 'hex'),
    createHmac('sha256', secret).update(body).digest(),
  )
}

export function githubPayload(
  trigger: WebhookTrigger,
  headers: IncomingHttpHeaders,
  body: Buffer,
): string | null {
  const payload = JSON.parse(body.toString('utf8'))
  const event = headers['x-github-event']
  if (event === 'ping') return null
  if (!payload || typeof payload !== 'object') throw new Error('Payload inválido.')
  if (
    typeof payload.repository?.full_name !== 'string' ||
    payload.repository.full_name.toLowerCase() !== trigger.githubRepository?.toLowerCase()
  )
    throw new Error('Repositório não permitido.')
  if (!['issues', 'pull_request'].includes(String(event))) return null
  const actions =
    event === 'issues' ? ['opened', 'reopened'] : ['opened', 'reopened', 'synchronize']
  if (!actions.includes(payload.action)) return null
  const item = event === 'issues' ? payload.issue : payload.pull_request
  if (
    !item ||
    !Number.isSafeInteger(item.number) ||
    item.number < 1 ||
    typeof item.title !== 'string' ||
    (item.body !== null && typeof item.body !== 'string')
  )
    throw new Error('Issue/PR inválido.')
  return JSON.stringify({
    event,
    action: payload.action,
    repository: payload.repository.full_name,
    number: item.number,
    title: item.title,
    body: item.body,
    url: item.html_url,
    head: item.head?.sha,
    base: item.base?.sha,
  })
}
