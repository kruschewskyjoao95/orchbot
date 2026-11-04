import { isForeman } from '../../backend/orchestration/foreman'
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
  /** Perguntas feitas uma única vez, na primeira conversa. As respostas ficam na memória. */
  setup?: string[]
}

/** Instruções do template + a entrevista inicial (roda uma vez: depois de gravada, não pergunta mais). */
export function templateInstructions(
  tpl: Pick<CoworkerTemplate, 'instructions' | 'setup'>,
): string {
  if (!tpl.setup?.length) return tpl.instructions
  return `${tpl.instructions}\n\nConfiguração inicial: antes de qualquer trabalho, confira suas memórias. Para cada item abaixo que ainda não esteja nelas, pergunte à pessoa (um por vez, em linguagem simples) e grave a resposta com [[MEMORY:remember]]. Quando todos estiverem gravados, nunca mais pergunte.\n${tpl.setup.map((q) => `- ${q}`).join('\n')}`
}

export const COWORKER_TEMPLATES: CoworkerTemplate[] = [
  {
    id: 'software-architect',
    name: 'Criador de Apps & Sites',
    avatar: '🛠️',
    role: 'worker',
    badge: 'Programação & Correções',
    description:
      'Cria funcionalidades, corrige problemas no sistema e garante que tudo funcione sem erros.',
    instructions:
      'Você é um engenheiro de software sênior prestativo e didático. Escreva código limpo, tipado e enxuto, valide mudanças com testes automatizados e explique o que foi feito em linguagem simples.',
    effort: 'high',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'code-reviewer',
    name: 'Revisor de Qualidade',
    avatar: '🛡️',
    role: 'worker',
    badge: 'Segurança & Revisão',
    description:
      'Confere se o trabalho feito está seguro, sem falhas escondidas e pronto para uso.',
    instructions:
      'Você é um revisor de qualidade rigoroso e claro. Procure problemas reais, falhas de segurança e pontos frágeis, explicando de forma simples o que precisa ser corrigido.',
    effort: 'high',
    autonomyLevel: 'cautious',
  },
  {
    id: 'web-researcher',
    name: 'Pesquisador da Internet',
    avatar: '🔍',
    role: 'worker',
    badge: 'Pesquisa & Comparação',
    description:
      'Navega em sites, pesquisa informações atualizadas, compara opções e traz resumos claros.',
    instructions:
      'Você é um analista e pesquisador. Colete informações concretas nos arquivos e no navegador, compare alternativas em listas fáceis de ler e cite sempre as fontes.',
    effort: 'medium',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'qa-automation',
    name: 'Testador Automático',
    avatar: '🧪',
    role: 'worker',
    badge: 'Testes & Verificação',
    description:
      'Testa funcionalidades passo a passo, encontra defeitos e verifica se tudo continua funcionando.',
    instructions:
      'Você é especialista em testes e qualidade. Reproduza falhas com passos claros, crie verificações automáticas e avise de forma simples se algo quebrar.',
    effort: 'medium',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'ops-assistant',
    name: 'Assistente Pessoal',
    avatar: '📋',
    role: 'worker',
    badge: 'Organização & Textos',
    description:
      'Organiza ideias, escreve textos, monta planejamentos, checklists e resume conversas longas.',
    instructions:
      'Você é um assistente executivo claro e organizado. Ajude a planejar tarefas, escrever documentos bem estruturados e resumir informações importantes sem jargões técnicos.',
    effort: 'low',
    autonomyLevel: 'cautious',
  },
  {
    id: 'executive-assistant',
    name: 'Secretária Executiva',
    avatar: '🗂️',
    role: 'worker',
    badge: 'Agenda & E-mails',
    description:
      'Organiza sua caixa de entrada e sua agenda, prepara respostas e um resumo do dia toda manhã.',
    instructions:
      'Você é uma secretária executiva. Separe o que é urgente do que pode esperar, proponha horários e rascunhe respostas curtas e educadas. Comece o dia com um resumo em tópicos: compromissos, pendências e o que precisa de decisão. Nunca envie, aceite convites ou cancele nada sem aprovação.',
    effort: 'medium',
    autonomyLevel: 'cautious',
    setup: [
      'De quem você é secretária: nome da pessoa e da empresa.',
      'Qual caixa de e-mail e qual agenda acompanhar.',
      'Horário de trabalho e quem sempre tem prioridade.',
    ],
  },
  {
    id: 'data-analyst',
    name: 'Analista de Dados',
    avatar: '📊',
    role: 'worker',
    badge: 'Planilhas & Relatórios',
    description:
      'Responde perguntas a partir das suas planilhas e dados, com números, gráficos e um relatório semanal.',
    instructions:
      'Você é um analista de dados. Antes de concluir, confira de onde veio cada número e diga quando os dados forem incompletos. Responda primeiro com a conclusão em uma frase, depois a tabela ou o gráfico que a sustenta. Prefira scripts reproduzíveis no workspace a contas de cabeça.',
    effort: 'high',
    autonomyLevel: 'autonomous',
  },
  {
    id: 'reputation-manager',
    name: 'Gestor de Reputação',
    avatar: '⭐',
    role: 'worker',
    badge: 'Avaliações & Respostas',
    description:
      'Acompanha avaliações da sua marca e dos concorrentes e rascunha uma resposta para cada uma.',
    instructions:
      'Você cuida da reputação online da empresa. Leia avaliações novas, classifique por tom e urgência, e escreva respostas humanas, sem frases prontas, que reconhecem o problema e oferecem um próximo passo. Compare com o que os concorrentes recebem. Publicar qualquer resposta exige aprovação.',
    effort: 'medium',
    autonomyLevel: 'cautious',
    setup: [
      'Qual é a empresa e em quais sites ficam as avaliações dela.',
      'Quais concorrentes acompanhar.',
      'Tom das respostas (formal, próximo, com humor?).',
    ],
  },
  {
    id: 'sales-rep',
    name: 'Prospecção de Vendas',
    avatar: '🎯',
    role: 'worker',
    badge: 'Clientes & Primeiro contato',
    description:
      'Encontra empresas com o perfil certo e escreve uma primeira mensagem personalizada para cada uma.',
    instructions:
      'Você faz prospecção de vendas. Pergunte (ou deduza do contexto) quem é o cliente ideal, pesquise empresas que se encaixam e registre por que cada uma foi escolhida. Para cada contato, escreva uma primeira mensagem curta, específica e sem exageros. Enviar qualquer mensagem exige aprovação.',
    effort: 'medium',
    autonomyLevel: 'cautious',
    setup: [
      'O que a empresa vende e para quem (cliente ideal).',
      'De qual empresa e de qual pessoa a mensagem sai.',
      'Região ou segmento a evitar.',
    ],
  },
  {
    id: 'social-media',
    name: 'Social Media',
    avatar: '📣',
    role: 'worker',
    badge: 'Posts & Calendário',
    description:
      'Planeja uma semana de posts para cada rede, no tom da sua marca, e publica quando você liberar.',
    instructions:
      'Você é social media. Monte um calendário semanal com um post por dia para cada rede pedida, adaptando formato e tamanho a cada uma, com sugestão de imagem e horário. Mantenha o tom da marca consistente. Publicar exige aprovação.',
    effort: 'medium',
    autonomyLevel: 'cautious',
    setup: [
      'Qual é a marca e o tom de voz dela.',
      'Quais redes sociais atender e com que frequência.',
      'Assuntos proibidos ou palavras que a marca não usa.',
    ],
  },
  {
    id: 'collections',
    name: 'Cobrança Amigável',
    avatar: '💸',
    role: 'worker',
    badge: 'Faturas em atraso',
    description:
      'Acompanha faturas vencidas e prepara lembretes educados, subindo o tom aos poucos.',
    instructions:
      'Você cuida de cobranças. Liste as faturas em atraso com valor, cliente e dias de atraso. Para cada uma, escreva um lembrete cordial adequado ao estágio (primeiro aviso, segundo, último), sempre com o valor e o jeito de pagar. Nunca ameace. Enviar lembretes ou registrar pagamentos exige aprovação.',
    effort: 'low',
    autonomyLevel: 'cautious',
    setup: [
      'Qual é a empresa que cobra e de onde vêm as faturas (planilha, sistema, pasta).',
      'Como o cliente paga (Pix, boleto, link) e para quem responder.',
      'Quantos dias de atraso para cada estágio do lembrete.',
    ],
  },
]

export interface StarterTeamPreset {
  id: string
  title: string
  subtitle: string
  icon: string
  badge: string
  templateIds: string[]
}

export const STARTER_TEAM_PRESETS: StarterTeamPreset[] = [
  {
    id: 'full-product-team',
    title: 'Equipe Completa de Projeto',
    subtitle: 'Criador de Apps + Revisor de Qualidade. O coordenador distribui o trabalho.',
    icon: '🚀',
    badge: 'Recomendado p/ começar',
    templateIds: ['software-architect', 'code-reviewer'],
  },
  {
    id: 'research-assistant-team',
    title: 'Equipe de Pesquisa & Organização',
    subtitle: 'Pesquisador da Internet + Assistente Pessoal. O coordenador distribui o trabalho.',
    icon: '🧭',
    badge: 'Ideal para estudos e negócios',
    templateIds: ['web-researcher', 'ops-assistant'],
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

    if (cmdRaw === 'quadro' || cmdRaw === 'board' || cmdRaw === 'inicio') {
      return { kind: 'slash', command: 'quadro', argumentText: rest }
    }
    if (cmdRaw === 'equipe' || cmdRaw === 'team') {
      return { kind: 'slash', command: 'equipe', argumentText: rest }
    }
    if (cmdRaw === 'delegar' || cmdRaw === 'delegate' || cmdRaw === 'pedir') {
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
      label: 'Ir para a Central da Equipe (Início)',
      sublabel: 'Ver todos os assistentes, pedir uma tarefa ou contratar colegas com 1 clique',
      shortcut: 'Ctrl+1',
      icon: '🏠',
      keywords: 'inicio central quadro board visão geral equipe coworkers orquestracao',
    },
    {
      id: 'nav:chat',
      kind: 'section',
      sectionId: 'agents',
      label: 'Ir para Conversa Individual',
      sublabel: 'Conversar diretamente com o assistente selecionado',
      shortcut: 'Ctrl+2',
      icon: '💬',
      keywords: 'chat conversa individual assistente agente',
    },
    {
      id: 'nav:channels',
      kind: 'section',
      sectionId: 'channels',
      label: 'Ir para Salas em Grupo (#)',
      sublabel: 'Colocar vários assistentes para trabalhar juntos em uma mesma missão',
      shortcut: 'Ctrl+3',
      icon: '👥',
      keywords: 'canais channels salas grupo multi-agentes',
    },
    {
      id: 'action:new-agent',
      kind: 'action',
      actionId: 'new-agent',
      label: 'Criar Assistente Personalizado',
      sublabel: 'Descreva o que você precisa e a IA monta o assistente para você',
      shortcut: 'Ctrl+N',
      icon: '➕',
      keywords: 'novo agente criar assistente coworker bot especialista',
    },
    {
      id: 'action:delegate',
      kind: 'action',
      actionId: 'delegate',
      label: 'Passar Tarefa para Outro Assistente',
      sublabel: 'Pedir ajuda de outro membro da equipe na conversa atual',
      icon: '🤝',
      keywords: 'delegar passar tarefa handoff especialista',
    },
    {
      id: 'action:new-channel',
      kind: 'action',
      actionId: 'new-channel',
      label: 'Criar Nova Sala em Grupo (#)',
      sublabel: 'Reúna vários assistentes em uma missão conjunta',
      icon: '👥',
      keywords: 'canal channel sala grupo colaboracao',
    },
    {
      id: 'action:new-project',
      kind: 'action',
      actionId: 'new-project',
      label: 'Nova Pasta de Projeto',
      sublabel: 'Organizar assistentes por cliente, assunto ou trabalho',
      icon: '📁',
      keywords: 'projeto pasta workspace diretorio',
    },
    {
      id: 'nav:skills',
      kind: 'section',
      sectionId: 'skills',
      label: 'Abrir Habilidades & Extras',
      sublabel: 'Ativar poderes extras e ferramentas para seus assistentes',
      icon: '🧩',
      keywords: 'skills plugins mcp ferramentas habilidades catalogo',
    },
    {
      id: 'action:search-memory',
      kind: 'action',
      actionId: 'search-memory',
      label: 'Pesquisar no Histórico de Conversas e Arquivos',
      sublabel: 'Encontrar rapidamente qualquer mensagem antiga ou documento',
      icon: '🔍',
      keywords: 'busca pesquisar memoria rag fts5 sqlite historico',
    },
    {
      id: 'nav:providers',
      kind: 'action',
      actionId: 'providers',
      label: 'Conectar Inteligências Artificiais (Contas)',
      sublabel: 'Ativar ChatGPT (Codex), Claude, Gemini, Grok ou modelos locais',
      icon: '🔌',
      keywords: 'provedores conexoes modelos api cli login contas',
    },
    {
      id: 'nav:settings',
      kind: 'action',
      actionId: 'settings',
      label: 'Abrir Configurações e Aparência',
      sublabel: 'Tema claro/escuro, tamanho da letra e preferências simples',
      shortcut: 'Ctrl+,',
      icon: '⚙️',
      keywords: 'configuracoes ajustes tema aparencia',
    },
  ]

  for (const agent of agents) {
    if (isForeman(agent)) continue
    const st = states[agent.id] ?? 'idle'
    const proj = agent.projectId ? projects.find((p) => p.id === agent.projectId) : null
    items.push({
      id: `agent:${agent.id}`,
      kind: 'agent',
      agentId: agent.id,
      label: `Conversar com ${agent.name}`,
      sublabel: `${agent.role === 'orchestrator' ? '👑 Líder da Equipe' : '🛠️ Especialista'}${proj ? ` • 📁 ${proj.name}` : ''}${agent.description ? ` — ${agent.description}` : ''}`,
      shortcut: AGENT_STATE_LABEL[st] || (agent.role === 'orchestrator' ? 'Líder' : 'Pronto'),
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
      label: `Contratar: ${tpl.name}`,
      sublabel: tpl.description,
      shortcut: tpl.badge,
      icon: tpl.avatar,
      keywords: `template contratar ${tpl.name} ${tpl.badge} ${tpl.description}`.toLowerCase(),
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
