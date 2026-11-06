import { CONTROL_TOOLS, controlInput } from '../backend/control/contract'

export function createMcpHandler(call: (method: string, args: unknown) => Promise<unknown>) {
  let initialized = false
  return async (raw: unknown): Promise<unknown | undefined> => {
    const request = raw as {
      jsonrpc?: unknown
      id?: unknown
      method?: unknown
      params?: Record<string, unknown>
    }
    const id =
      typeof request?.id === 'string' || typeof request?.id === 'number' ? request.id : null
    const error = (code: number, message: string) => ({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    })
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string')
      return error(-32600, 'Invalid request')
    if (request.id === undefined) return undefined
    let result: unknown
    if (request.method === 'initialize') {
      initialized = true
      const supported = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
      const requested = String(request.params?.protocolVersion)
      result = {
        protocolVersion: supported.includes(requested) ? requested : supported[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'orchbot-control', version: '1' },
      }
    } else if (request.method === 'ping') result = {}
    else if (!initialized) return error(-32002, 'Initialize first')
    else if (request.method === 'tools/list') result = { tools: CONTROL_TOOLS }
    else if (request.method === 'tools/call') {
      const name = request.params?.name
      try {
        const args = controlInput(name, request.params?.arguments ?? {})
        const value = await call(String(name), args)
        result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }
      } catch (failure) {
        result = {
          content: [
            {
              type: 'text',
              text: failure instanceof Error ? failure.message : 'Falha de controle.',
            },
          ],
          isError: true,
        }
      }
    } else return error(-32601, 'Method not found')
    return { jsonrpc: '2.0', id, result }
  }
}
