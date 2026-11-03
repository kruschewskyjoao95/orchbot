import { describe, expect, it } from 'vitest'
import type { AgentState } from '../src/renderer/src/agent-state'
import {
  COWORKER_TEMPLATES,
  buildCommandPaletteItems,
  computeBoardSummary,
  filterPaletteItems,
  getActiveTaskForAgent,
  parseComposerInput,
  parseStructuredMessage,
} from '../src/renderer/src/orchestration-ui'
import type { Agent, Channel, Project, TaskQueueItem } from '../src/shared/types'

const sampleAgents: Agent[] = [
  {
    id: 'foreman-1',
    name: 'Foreman (Orquestrador)',
    avatar: '👑',
    description: 'Coordena a equipe',
    role: 'orchestrator',
    projectId: 'proj-1',
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    instructions: 'Delega tarefas',
    workspacePath: '/tmp/foreman',
    autonomyLevel: 'autonomous',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'worker-1',
    name: 'Engenheiro de Software',
    avatar: '🛠️',
    description: 'Implementa código',
    role: 'worker',
    projectId: 'proj-1',
    provider: 'codex',
    model: 'gpt-5',
    instructions: 'Escreve código',
    workspacePath: '/tmp/worker',
    autonomyLevel: 'autonomous',
    createdAt: '2026-01-01T00:01:00Z',
    updatedAt: '2026-01-01T00:01:00Z',
  },
  {
    id: 'worker-2',
    name: 'Auditor',
    avatar: '🔍',
    description: 'Revisa PRs',
    role: 'worker',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    instructions: 'Audita segurança',
    workspacePath: '/tmp/auditor',
    autonomyLevel: 'cautious',
    createdAt: '2026-01-01T00:02:00Z',
    updatedAt: '2026-01-01T00:02:00Z',
  },
]

const sampleProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'SaaS Principal',
    description: 'Produto core',
    workspacePath: '/tmp/saas',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

describe('orchestration-ui helpers (Quadro da Equipe & Paleta de Comandos)', () => {
  it('exposes coworker templates including a Foreman orchestrator', () => {
    expect(COWORKER_TEMPLATES.length).toBeGreaterThanOrEqual(5)
    const foreman = COWORKER_TEMPLATES.find((t) => t.id === 'foreman')
    expect(foreman).toBeDefined()
    expect(foreman?.role).toBe('orchestrator')
    const workers = COWORKER_TEMPLATES.filter((t) => t.role === 'worker')
    expect(workers.length).toBeGreaterThanOrEqual(4)
  })

  it('computes board summary metrics accurately', () => {
    const states: Record<string, AgentState> = {
      'foreman-1': 'working',
      'worker-1': 'paused',
      'worker-2': 'responded',
    }
    const channels: Channel[] = [
      {
        id: 'ch-1',
        title: 'geral',
        goal: 'Alinhar entregas',
        ownerAgentId: 'foreman-1',
        members: [
          { agentId: 'foreman-1', threadId: 'th-1' },
          { agentId: 'worker-1', threadId: 'th-2' },
        ],
        status: 'active',
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'ch-2',
        title: 'antigo',
        goal: 'Histórico',
        ownerAgentId: 'foreman-1',
        members: [{ agentId: 'foreman-1', threadId: 'th-3' }],
        status: 'stopped',
        archived: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]
    const summary = computeBoardSummary(sampleAgents, states, channels)
    expect(summary).toEqual({
      total: 3,
      orchestrators: 1,
      workers: 2,
      working: 1,
      needsYou: 1,
      responded: 1,
      idle: 0,
      activeChannels: 1,
    })
  })

  it('parses @AgentName mentions (single word, multi-word, and quoted) for inline delegation', () => {
    const bySingleWord = parseComposerInput(
      '@Auditor revise o arquivo src/main/index.ts',
      sampleAgents,
    )
    expect(bySingleWord.kind).toBe('mention')
    expect(bySingleWord.targetAgent?.id).toBe('worker-2')
    expect(bySingleWord.argumentText).toBe('revise o arquivo src/main/index.ts')

    const byMultiWordPrefix = parseComposerInput(
      '@Engenheiro de Software crie os testes unitários',
      sampleAgents,
    )
    expect(byMultiWordPrefix.kind).toBe('mention')
    expect(byMultiWordPrefix.targetAgent?.id).toBe('worker-1')
    expect(byMultiWordPrefix.argumentText).toBe('crie os testes unitários')

    const byQuoted = parseComposerInput(
      '@"Engenheiro de Software" refatore o módulo de banco',
      sampleAgents,
    )
    expect(byQuoted.kind).toBe('mention')
    expect(byQuoted.targetAgent?.id).toBe('worker-1')
    expect(byQuoted.argumentText).toBe('refatore o módulo de banco')
  })

  it('parses /slash commands and falls back to plain message', () => {
    expect(parseComposerInput('/quadro', sampleAgents)).toEqual({
      kind: 'slash',
      command: 'quadro',
      argumentText: '',
    })
    expect(parseComposerInput('/delegar revisar segurança', sampleAgents)).toEqual({
      kind: 'slash',
      command: 'delegar',
      argumentText: 'revisar segurança',
    })
    expect(parseComposerInput('Olá, tudo bem?', sampleAgents)).toEqual({
      kind: 'plain',
      argumentText: 'Olá, tudo bem?',
    })
  })

  it('builds and filters Command Palette items by query', () => {
    const items = buildCommandPaletteItems(sampleAgents, sampleProjects, {
      'foreman-1': 'working',
    })
    expect(items.length).toBeGreaterThan(8)

    const filteredForeman = filterPaletteItems(items, 'foreman')
    expect(filteredForeman.some((i) => i.agentId === 'foreman-1')).toBe(true)

    const filteredBoard = filterPaletteItems(items, 'quadro')
    expect(filteredBoard.some((i) => i.id === 'nav:board')).toBe(true)
  })

  it('parses structured messages containing delegation headers, results, and code blocks', () => {
    const raw = [
      '🔗 [TAREFA DELEGADA POR: Foreman -> PARA: Auditor]',
      'Por favor valide o código abaixo:',
      '```ts',
      'const x: number = 42',
      '```',
      '✅ [RESULTADO DO ESPECIALISTA Auditor PARA Foreman]',
      'Tudo certo!',
    ].join('\n')

    const structured = parseStructuredMessage(raw)
    expect(structured.delegationHeader).toContain('TAREFA DELEGADA POR')
    expect(structured.delegationKind).toBe('request')
    expect(structured.blocks.some((s) => s.kind === 'delegation')).toBe(true)
    expect(structured.blocks.some((s) => s.kind === 'code' && s.language === 'ts')).toBe(true)
    expect(structured.blocks.some((s) => s.kind === 'specialist_result')).toBe(true)
  })

  it('identifies active or next pending task for an agent on the Board', () => {
    const tasks: TaskQueueItem[] = [
      {
        id: 't1',
        agentId: 'worker-1',
        threadId: 'th-1',
        prompt: 'Concluída',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 't2',
        agentId: 'worker-1',
        threadId: 'th-1',
        prompt: 'Rodando agora',
        status: 'running',
        createdAt: '2026-01-01T00:01:00Z',
      },
      {
        id: 't3',
        agentId: 'worker-1',
        threadId: 'th-1',
        prompt: 'Na fila',
        status: 'pending',
        createdAt: '2026-01-01T00:02:00Z',
      },
    ]
    expect(getActiveTaskForAgent(tasks)?.id).toBe('t2')
    expect(getActiveTaskForAgent([tasks[0], tasks[2]])?.id).toBe('t3')
    expect(getActiveTaskForAgent([tasks[0]])).toBeUndefined()
  })
})
