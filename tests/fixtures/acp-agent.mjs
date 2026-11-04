import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const mode = process.argv[2] || 'normal'
const log = process.argv[3]
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const reply = (id, result) => send({ id, result })
const notify = (sessionUpdate, content) =>
  send({
    method: 'session/update',
    params: {
      sessionId: 'test-session',
      update: { sessionUpdate, content: { type: 'text', text: content } },
    },
  })
let promptId
let selectedModel
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (log) appendFileSync(log, `${JSON.stringify(message)}\n`)
  const { id, method, params } = message
  if (id === 'permission') {
    notify('agent_message_chunk', JSON.stringify(message.result))
    reply(promptId, { stopReason: 'end_turn' })
    return
  }
  if (method === 'initialize') {
    if (mode === 'hang-init') return
    reply(id, {
      protocolVersion: mode === 'bad-version' ? 999 : params.protocolVersion,
      agentCapabilities:
        mode === 'dirs' ? { sessionCapabilities: { additionalDirectories: {} } } : {},
      agentInfo: { name: 'test-agent', version: '1.0.0' },
      authMethods: [],
    })
  } else if (method === 'session/new') {
    if (mode === 'auth-error') {
      send({ id, error: { code: -32000, message: 'Authentication required: run agent login' } })
      return
    }
    reply(id, {
      sessionId: 'test-session',
      configOptions:
        mode === 'no-models'
          ? []
          : [
              {
                id: 'model-choice',
                category: 'model',
                type: 'select',
                name: 'Model',
                currentValue: 'model-a',
                options: [
                  { value: 'model-a', name: 'Model A' },
                  {
                    group: 'other',
                    name: 'Other',
                    options: [{ value: 'model-b', name: 'Model B' }],
                  },
                ],
              },
            ],
    })
  } else if (method === 'session/set_config_option') {
    selectedModel = params.value
    reply(id, { configOptions: [] })
  } else if (method === 'session/prompt') {
    promptId = id
    if (mode === 'hang-prompt') return
    if (mode === 'crash') {
      process.stderr.write('diagnostic crash')
      process.exit(2)
    }
    if (mode === 'permission') {
      send({
        id: 'permission',
        method: 'session/request_permission',
        params: {
          sessionId: 'test-session',
          toolCall: {
            toolCallId: 'tool-1',
            title: 'Write a file',
            rawInput: { path: '/tmp/file' },
          },
          options: [
            { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        },
      })
      return
    }
    notify('agent_thought_chunk', 'private thought')
    notify('agent_message_chunk', 'Olá ')
    notify('agent_message_chunk', '🌍')
    if (mode === 'echo')
      notify(
        'agent_message_chunk',
        JSON.stringify({
          prompt: params.prompt,
          model: selectedModel,
          key: process.env.TEST_ACP_KEY,
          arg: process.argv[4],
        }),
      )
    if (mode === 'partial-error')
      send({ id, error: { code: -32603, message: 'Failure after partial output' } })
    else reply(id, { stopReason: 'end_turn' })
  } else if (method === 'session/cancel') {
    reply(promptId, { stopReason: 'cancelled' })
  } else if (id !== undefined) send({ id, error: { code: -32601, message: 'Method not found' } })
})
