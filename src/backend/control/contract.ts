const string = { type: 'string', minLength: 1 }
export const CONTROL_TOOLS = [
  {
    name: 'list_agents',
    description: 'Lista colegas e seus runtimes; não inclui contas ou credenciais.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'send_task',
    description:
      'Enfileira uma tarefa. Reuse requestId ao tentar novamente; não concede permissões.',
    inputSchema: {
      type: 'object',
      properties: { agentId: string, requestId: string, prompt: string },
      required: ['agentId', 'requestId', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description:
      'Lê tarefa, mensagens e texto em andamento. O resultado pode conter dados do workspace.',
    inputSchema: {
      type: 'object',
      properties: { taskId: string },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancela uma tarefa pendente ou em execução.',
    inputSchema: {
      type: 'object',
      properties: { taskId: string },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
] as const

export function controlInput(method: unknown, args: unknown): Record<string, string> {
  const tool = CONTROL_TOOLS.find((entry) => entry.name === method)
  if (!tool || !args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Operação ou argumentos inválidos.')
  const keys = Object.keys(tool.inputSchema.properties)
  if (Object.keys(args).length !== keys.length) throw new Error('Argumentos inválidos.')
  const result: Record<string, string> = {}
  for (const key of keys) {
    const value = (args as Record<string, unknown>)[key]
    const max = key === 'prompt' ? 64000 : 200
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > max ||
      (key !== 'prompt' && !/^[\x21-\x7e]+$/.test(value))
    )
      throw new Error(`Argumento inválido: ${key}.`)
    result[key] = value
  }
  return result
}
