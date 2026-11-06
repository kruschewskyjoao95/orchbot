import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { QueueManager } from '../queue/queue-manager'
import type { OrchbotDatabase } from '../storage/db'
import { controlInput } from './contract'

const digest = (value: string) => createHash('sha256').update(value).digest()
export async function startControlServer(db: OrchbotDatabase, queue: QueueManager, file: string) {
  const token = randomBytes(32).toString('base64url')
  const server = http.createServer((req, res) => {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    if (
      req.headers.origin ||
      req.method !== 'POST' ||
      req.url !== '/rpc' ||
      !timingSafeEqual(digest(String(req.headers.authorization ?? '')), digest(`Bearer ${token}`))
    ) {
      req.resume()
      send(403, { error: 'Acesso recusado.' })
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 128000) {
        if (!res.writableEnded) send(413, { error: 'Corpo muito grande.' })
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      try {
        const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!raw || Object.keys(raw).some((key) => !['method', 'args'].includes(key)))
          throw new Error('Pedido inválido.')
        const args = controlInput(raw.method, raw.args)
        let result: unknown
        switch (raw.method) {
          case 'list_agents':
            result = db
              .listAgents()
              .filter((agent) => !agent.systemRole)
              .map((agent) => ({
                id: agent.id,
                name: agent.name,
                provider: agent.provider,
                runtime: agent.runtime ?? 'host',
              }))
            break
          case 'send_task':
            result = queue.enqueueControl(args.requestId, args.agentId, args.prompt)
            break
          case 'get_task': {
            const task = db.getTask(args.taskId)
            if (!task) throw new Error('Tarefa não encontrada.')
            result = { task, snapshot: queue.threadSnapshot(task.threadId) }
            break
          }
          case 'cancel_task':
            result = { cancelled: queue.cancel(args.taskId) }
            break
        }
        send(200, result)
      } catch (error) {
        send(400, { error: error instanceof Error ? error.message : 'Falha de controle.' })
      }
    })
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    // Troca por rename evita leitura parcial. O segredo nunca aparece no argv nem na interface.
    const temporary = `${file}.${randomBytes(6).toString('hex')}`
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({
          url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`,
          token,
        }),
        { mode: 0o600, flag: 'wx' },
      )
      fs.renameSync(temporary, file)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  } catch (error) {
    server.close()
    throw error
  }
  return {
    file,
    close: async () => {
      fs.rmSync(file, { force: true })
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
