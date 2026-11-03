import type { Agent, Channel, Project, TaskQueueItem } from '../../shared/types'
import { AGENT_STATE_LABEL, type AgentState, needsYou } from './agent-state'

export interface CoworkerTemplate {
  id: string
  name: string
  avatar: string
  role: 'orchestrator' | 'worker'
  badge: string
  description: string
  instructions: string
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  autonomyLevel: 'autonomous' | 'cautious'
}

export const COWORKER_TEMPLATES: CoworkerTemplate[] = [
  {
    id: 'foreman',
    name: 'Foreman (Orquestrador)',
    avatar: '👑',
    role: 'orchestrator',
    badge: 'Líder de Equipe',
    description:
      'Coordena sua equipe, planeja subtarefas, delega aos especialistas e consolida o resultado.',
    instructions:
      'Você é o Foreman, líder e orquestrador da equipe. Seu papel é entender o objetivo do usuário em linguagem simples, dividir o trabalho em subtarefas claras, delegar para os especialistas certos do projeto usando blocos [[DELEGAR:Nome]] e sintetizar as respostas com objetividade.',
    effort: 'high',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'software-architect',
    name: 'Engenheiro de Software',
    avatar: '🛠️',
    role: 'worker',
    badge: 'Código & Testes',
    description:
      'Implementa features, refatora código com segurança e mantém a suíte de testes verde.',
    instructions:
      'Você é um engenheiro de software sênior. Escreva código limpo, tipado e enxuto, valide mudanças com testes automatizados e explique decisões técnicas de forma direta.',
    effort: 'high',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'code-reviewer',
    name: 'Auditor & Revisor',
    avatar: '🛡️',
    role: 'worker',
    badge: 'Qualidade & Segurança',
    description:
      'Analisa diffs, encontra regressões, falhas de segurança e sugere correções precisas.',
    instructions:
      'Você é um revisor de código rigoroso e objetivo. Procure bugs reais, condições de corrida, vazamento de segredos, quebras de contrato e falta de testes. Priorize problemas críticos primeiro.',
    effort: 'high',
    autonomyLevel: 'cautious',
  },
  {
    id: 'web-researcher',
    name: 'Pesquisador & Analista',
    avatar: '🔍',
    role: 'worker',
    badge: 'Pesquisa & Dados',
    description:
      'Investiga documentações, analisa dados do projeto e monitora páginas no navegador.',
    instructions:
      'Você é um analista e pesquisador técnico. Colete evidências concretas nos arquivos e no navegador embarcado, compare alternativas em tabelas claras e cite sempre a fonte.',
    effort: 'medium',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'qa-automation',
    name: 'Especialista de QA',
    avatar: '🧪',
    role: 'worker',
    badge: 'Automação & Rotinas',
    description:
      'Cria casos de teste, reproduz bugs e executa verificações periódicas de integridade.',
    instructions:
      'Você é especialista em qualidade e testes automatizados. Reproduza falhas com passos mínimos, escreva testes determinísticos e verifique casos de borda.',
    effort: 'medium',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'ops-assistant',
    name: 'Assistente Executivo',
    avatar: '📋',
    role: 'worker',
    badge: 'Organização & Docs',
    description: 'Organiza roadmaps, resume reuniões/threads, atualiza documentação e checklists.',
    instructions:
      'Você é um assistente executivo e redator técnico. Mantenha a documentação sincronizada com o código, estruture planos de ação claros e resuma progresso sem ruído.',
    effort: 'low',
    autonomyLevel: 'cautious',
  },
]

export interface BoardSummary {
  total: number
  orchestrators: number
  workers: number
  working: number
  needsYou: number
  responded: number
  idle: number
  activeChannels: number
}

export function computeBoardSummary(
  agents: Agent[],
  states: Record<string, AgentState>,
  channels: Channel[],
): BoardSummary {
  let orchestrators = 0
  let workers = 0
  let working = 0
  let needsYouCount = 0
  let responded = 0
  let idle = 0

  for (const agent of agents) {
    if (agent.role === 'orchestrator') orchestrators++
    else workers++

    const st = states[agent.id] ?? 'idle'
    if (st === 'working') working++
    else if (needsYou(st)) needsYouCount++
    else if (st === 'responded') responded++
    else idle++
  }

  const activeChannels = channels.filter((c) => !c.archived && c.status === 'active').length

  return {
    total: agents.length,
    orchestrators,
    workers,
    working,
    needsYou: needsYouCount,
    responded,
    idle,
    activeChannels,
  }
}

export interface ParsedComposerCommand {
  kind: 'mention' | 'slash' | 'plain'
  targetAgent?: Agent
  command?: 'delegar' | 'equipe' | 'quadro' | 'limpar' | 'novo-topico' | 'ajuda'
  argumentText: string
}

/**
 * Interpreta comandos rápidos no composer:
 * - `@NomeDoAgente tarefa...` ou `@"Nome Composto" tarefa...` -> delega diretamente para o agente mencionado
 * - `/delegar NomeDoAgente :: tarefa` -> delega tarefa
 * - `/quadro` ou `/equipe` -> abre o quadro de orquestração
 * - `/novo-topico Título` -> cria tópico rapidamente
 */
export function parseComposerInput(raw: string, roster: Agent[]): ParsedComposerCommand {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'plain', argumentText: '' }

  if (trimmed.startsWith('@')) {
    const withoutAt = trimmed.slice(1).trim()

    // Suporte a @"Nome do Agente" <tarefa>
    if (withoutAt.startsWith('"')) {
      const closingIdx = withoutAt.indexOf('"', 1)
      if (closingIdx !== -1) {
        const quotedName = withoutAt.slice(1, closingIdx).trim().toLowerCase()
        const rest = withoutAt
          .slice(closingIdx + 1)
          .replace(/^[:\s]+/, '')
          .trim()
        const matched = roster.find((a) => a.name.toLowerCase() === quotedName)
        if (matched) {
          return {
            kind: 'mention',
            targetAgent: matched,
            argumentText: rest,
          }
        }
      }
    }

    // Tenta casar pelo nome mais longo primeiro para evitar colisão entre "Ana" e "Ana Maria"
    const sorted = [...roster].sort((a, b) => b.name.length - a.name.length)
    for (const candidate of sorted) {
      const prefixLower = candidate.name.toLowerCase()
      const inputLower = withoutAt.toLowerCase()
      if (
        inputLower === prefixLower ||
        inputLower.startsWith(`${prefixLower} `) ||
        inputLower.startsWith(`${prefixLower}:`)
      ) {
        const rest = withoutAt
          .slice(candidate.name.length)
          .replace(/^[:\s]+/, '')
          .trim()
        return {
          kind: 'mention',
          targetAgent: candidate,
          argumentText: rest,
        }
      }
    }
  }

  if (trimmed.startsWith('/')) {
    const spaceIdx = trimmed.indexOf(' ')
    const cmdRaw = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase()
    const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()

    if (cmdRaw === 'quadro' || cmdRaw === 'board') {
      return { kind: 'slash', command: 'quadro', argumentText: rest }
    }
    if (cmdRaw === 'equipe' || cmdRaw === 'team') {
      return { kind: 'slash', command: 'equipe', argumentText: rest }
    }
    if (cmdRaw === 'delegar' || cmdRaw === 'delegate') {
      return { kind: 'slash', command: 'delegar', argumentText: rest }
    }
    if (
      cmdRaw === 'topico' ||
      cmdRaw === 'novo-topico' ||
      cmdRaw === 'thread' ||
      cmdRaw === 'topic'
    ) {
      return { kind: 'slash', command: 'novo-topico', argumentText: rest }
    }
    if (cmdRaw === 'limpar' || cmdRaw === 'reset') {
      return { kind: 'slash', command: 'limpar', argumentText: rest }
    }
    if (cmdRaw === 'ajuda' || cmdRaw === 'help') {
      return { kind: 'slash', command: 'ajuda', argumentText: rest }
    }
  }

  return { kind: 'plain', argumentText: trimmed }
}

export interface PaletteItem {
  id: string
  kind: 'section' | 'agent' | 'template' | 'action'
  label: string
  sublabel: string
  shortcut?: string
  icon: string
  keywords: string
  sectionId?: 'board' | 'agents' | 'channels' | 'skills'
  agentId?: string
  templateId?: string
  actionId?:
    | 'new-agent'
    | 'new-foreman'
    | 'new-channel'
    | 'new-project'
    | 'delegate'
    | 'search-memory'
    | 'settings'
    | 'providers'
}

export function buildCommandPaletteItems(
  agents: Agent[],
  projects: Project[],
  states: Record<string, AgentState>,
): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: 'nav:board',
      kind: 'section',
      sectionId: 'board',
      label: 'Ir para o Quadro da Equipe',
      sublabel: 'Visão geral de todos os agentes, filas, canais e orquestradores',
      shortcut: 'Ctrl+1',
      icon: '🗺️',
      keywords: 'quadro board visão geral equipe coworkers orquestracao',
    },
    {
      id: 'nav:chat',
      kind: 'section',
      sectionId: 'agents',
      label: 'Ir para Conversa Direta & Terminal',
      sublabel: 'Abrir área de chat e delegação rápida com o agente atual',
      shortcut: 'Ctrl+2',
      icon: '💬',
      keywords: 'chat conversa terminal agente',
    },
    {
      id: 'nav:channels',
      kind: 'section',
      sectionId: 'channels',
      label: 'Ir para Canais Multi-Agentes (#)',
      sublabel: 'Salas de colaboração entre especialistas e orquestradores',
      shortcut: 'Ctrl+3',
      icon: '#',
      keywords: 'canais channels salas multi-agentes',
    },
    {
      id: 'action:new-agent',
      kind: 'action',
      actionId: 'new-agent',
      label: 'Contratar Novo Agente (Coworker)',
      sublabel: 'Criar especialista ou orquestrador a partir de template ou IA',
      shortcut: 'Ctrl+N',
      icon: '➕',
      keywords: 'novo agente criar coworker bot especialista',
    },
    {
      id: 'action:new-foreman',
      kind: 'template',
      templateId: 'foreman',
      label: 'Contratar Foreman (Orquestrador de Equipe)',
      sublabel: 'Líder que entrevista você, planeja e delega para os especialistas',
      icon: '👑',
      keywords: 'foreman orquestrador lider coordenador equipe',
    },
    {
      id: 'action:delegate',
      kind: 'action',
      actionId: 'delegate',
      label: 'Delegar Tarefa entre Agentes',
      sublabel: 'Enviar subtarefa do agente ativo para outro especialista da equipe',
      icon: '🤝',
      keywords: 'delegar tarefa handoff especialista',
    },
    {
      id: 'action:new-channel',
      kind: 'action',
      actionId: 'new-channel',
      label: 'Novo Canal de Colaboração (#)',
      sublabel: 'Reúna múltiplos agentes em uma missão com um dono responsável',
      icon: '#',
      keywords: 'canal channel sala colaboracao',
    },
    {
      id: 'action:new-project',
      kind: 'action',
      actionId: 'new-project',
      label: 'Novo Projeto (Workspace)',
      sublabel: 'Agrupar agentes em uma pasta de trabalho dedicada no disco',
      icon: '📁',
      keywords: 'projeto pasta workspace diretorio',
    },
    {
      id: 'nav:skills',
      kind: 'section',
      sectionId: 'skills',
      label: 'Abrir Skills & Servidores MCP',
      sublabel: 'Gerenciar habilidades reutilizáveis e integrações de ferramentas',
      icon: '🧩',
      keywords: 'skills plugins mcp ferramentas catalogo',
    },
    {
      id: 'action:search-memory',
      kind: 'action',
      actionId: 'search-memory',
      label: 'Busca Rápida em Memórias & Código (FTS5)',
      sublabel: 'Pesquisar instantaneamente em conversas passadas e arquivos do repositório',
      icon: '🔍',
      keywords: 'busca pesquisar memoria rag fts5 sqlite',
    },
    {
      id: 'nav:providers',
      kind: 'action',
      actionId: 'providers',
      label: 'Configurar Provedores & Modelos (CLIs / APIs)',
      sublabel: 'Codex, Claude, Grok, Gemini, Ollama e contas conectadas',
      icon: '🔌',
      keywords: 'provedores conexoes modelos api cli login',
    },
    {
      id: 'nav:settings',
      kind: 'action',
      actionId: 'settings',
      label: 'Abrir Configurações do Orchbot',
      sublabel: 'Tema, aparência, atalhos, autonomia padrão e diagnóstico',
      shortcut: 'Ctrl+,',
      icon: '⚙️',
      keywords: 'configuracoes ajustes tema aparencia',
    },
  ]

  for (const agent of agents) {
    const st = states[agent.id] ?? 'idle'
    const proj = agent.projectId ? projects.find((p) => p.id === agent.projectId) : null
    items.push({
      id: `agent:${agent.id}`,
      kind: 'agent',
      agentId: agent.id,
      label: agent.name,
      sublabel: `${agent.role === 'orchestrator' ? '👑 Orquestrador' : '🛠️ Especialista'} • ${agent.provider}/${agent.model}${proj ? ` • 📁 ${proj.name}` : ''}`,
      shortcut: AGENT_STATE_LABEL[st] || (agent.role === 'orchestrator' ? 'Foreman' : 'Ativo'),
      icon: agent.avatar || (agent.role === 'orchestrator' ? '👑' : '🤖'),
      keywords:
        `${agent.name} ${agent.provider} ${agent.model} ${agent.description ?? ''} ${proj?.name ?? ''}`.toLowerCase(),
    })
  }

  for (const tpl of COWORKER_TEMPLATES) {
    items.push({
      id: `template:${tpl.id}`,
      kind: 'template',
      templateId: tpl.id,
      label: `Template: ${tpl.name}`,
      sublabel: tpl.description,
      shortcut: tpl.badge,
      icon: tpl.avatar,
      keywords: `template ${tpl.name} ${tpl.badge} ${tpl.description}`.toLowerCase(),
    })
  }

  return items
}

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.sublabel.toLowerCase().includes(q) ||
      item.keywords.includes(q),
  )
}

export interface MessageSegment {
  kind: 'text' | 'delegation' | 'specialist_result' | 'code'
  content: string
  meta?: string
  language?: string
}

export interface StructuredMessage {
  delegationHeader?: string
  delegationKind?: 'request' | 'result'
  blocks: MessageSegment[]
}

/**
 * Destaca blocos estruturados nas mensagens (delegações, resultados de especialistas e blocos de código)
 * para exibição clara no chat.
 */
export function parseStructuredMessage(text: string): StructuredMessage {
  if (!text) return { blocks: [] }

  const segments: MessageSegment[] = []
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  let lastIndex = 0

  for (const match of text.matchAll(codeBlockRegex)) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      pushTextSegments(segments, text.slice(lastIndex, idx))
    }
    segments.push({
      kind: 'code',
      language: match[1]?.trim() || 'code',
      content: match[2]?.replace(/\n$/, '') ?? '',
    })
    lastIndex = idx + match[0].length
  }

  if (lastIndex < text.length) {
    pushTextSegments(segments, text.slice(lastIndex))
  }

  const blocks = segments.length > 0 ? segments : [{ kind: 'text' as const, content: text }]
  const firstSpecial = blocks.find((b) => b.kind === 'delegation' || b.kind === 'specialist_result')

  return {
    delegationHeader: firstSpecial?.meta,
    delegationKind:
      firstSpecial?.kind === 'specialist_result'
        ? 'result'
        : firstSpecial?.kind === 'delegation'
          ? 'request'
          : undefined,
    blocks,
  }
}

function pushTextSegments(out: MessageSegment[], chunk: string) {
  const trimmed = chunk.trim()
  if (!trimmed) return

  const resultMatch = trimmed.match(/\[RESULTADO DO ESPECIALISTA[^\]]*\]/)
  if (resultMatch) {
    const header = resultMatch[0].slice(1, -1)
    const body = trimmed
      .replace(resultMatch[0], '')
      .replace(/^✅\s*/, '')
      .trim()
    out.push({
      kind: 'specialist_result',
      meta: header,
      content: body,
    })
    return
  }

  const delMatch = trimmed.match(/\[(?:TAREFA DELEGADA POR|DELEGAÇÃO)[^\]]*\]/)
  if (delMatch) {
    const header = delMatch[0].slice(1, -1)
    const body = trimmed
      .replace(delMatch[0], '')
      .replace(/^[🔗🤝]\s*/u, '')
      .trim()
    out.push({
      kind: 'delegation',
      meta: header,
      content: body,
    })
    return
  }

  out.push({
    kind: 'text',
    content: chunk,
  })
}

export function getActiveTaskForAgent(queue: TaskQueueItem[]): TaskQueueItem | undefined {
  return queue.find((t) => t.status === 'running') ?? queue.find((t) => t.status === 'pending')
}
