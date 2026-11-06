import fs from 'node:fs'
import path from 'node:path'
import {
  type AgentRole,
  MAX_AGENT_INSTRUCTIONS,
  type Project,
  normalizeAvatar,
} from '../../shared/types'
import { redactSecrets } from '../browser/sanitizer'
import { isForeman } from '../orchestration/foreman'
import { type SkillService, slugify } from '../skills/skill-service'
import type { OrchbotDatabase } from '../storage/db'

export const MAX_TEAM_PACKAGE_BYTES = 2 * 1024 * 1024

interface TeamPackage {
  format: 'orchbot.team'
  version: 1
  project: { name: string; description: string }
  agents: {
    key: string
    name: string
    description: string
    avatar: string
    role: AgentRole
    instructions: string
    skills: string[]
  }[]
  skills: { key: string; name: string; description: string; body: string }[]
  channels: {
    title: string
    goal: string
    owner: string
    members: string[]
    instructions: string
  }[]
}

function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error('Objeto ou campo inválido no pacote de equipe.')
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error(`Texto inválido no pacote (máximo ${max} caracteres).`)
  return redactSecrets(value)
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`Lista inválida no pacote (máximo ${max} itens).`)
  return value
}

function unique(keys: string[]): void {
  if (new Set(keys).size !== keys.length) throw new Error('Referência duplicada no pacote.')
}

export function parseTeamPackage(source: string): TeamPackage {
  if (Buffer.byteLength(source) > MAX_TEAM_PACKAGE_BYTES) throw new Error('Pacote maior que 2 MiB.')
  const root = record(JSON.parse(source), [
    'format',
    'version',
    'project',
    'agents',
    'skills',
    'channels',
  ])
  if (root.format !== 'orchbot.team' || root.version !== 1)
    throw new Error('Formato ou versão de pacote não suportado.')
  const project = record(root.project, ['name', 'description'])
  const skills = list(root.skills, 40).map((value) => {
    const s = record(value, ['key', 'name', 'description', 'body'])
    const body = text(s.body, 40 * 1024)
    if (Buffer.byteLength(body) > 40 * 1024) throw new Error('Skill maior que 40 KiB.')
    return {
      key: text(s.key, 80),
      name: text(s.name, 100),
      description: text(s.description, 300),
      body,
    }
  })
  unique(skills.map((s) => s.key))
  const agents = list(root.agents, 20).map((value): TeamPackage['agents'][number] => {
    const a = record(value, [
      'key',
      'name',
      'description',
      'avatar',
      'role',
      'instructions',
      'skills',
    ])
    if (a.role !== 'worker' && a.role !== 'orchestrator')
      throw new Error('Papel de agente inválido.')
    const assigned = list(a.skills, 40).map((key) => text(key, 80))
    unique(assigned)
    if (assigned.some((key) => !skills.some((s) => s.key === key)))
      throw new Error('Skill referenciada não existe no pacote.')
    const avatar = text(a.avatar, 8, false)
    if (avatar && !normalizeAvatar(avatar)) throw new Error('Avatar inválido.')
    return {
      key: text(a.key, 80),
      name: text(a.name, 100),
      description: text(a.description, 300, false),
      avatar,
      role: a.role,
      instructions: text(a.instructions, MAX_AGENT_INSTRUCTIONS, false),
      skills: assigned,
    }
  })
  if (!agents.length) throw new Error('A equipe precisa de ao menos um agente.')
  unique(agents.map((a) => a.key))
  const channels = list(root.channels, 40).map((value) => {
    const c = record(value, ['title', 'goal', 'owner', 'members', 'instructions'])
    const members = list(c.members, 20).map((key) => text(key, 80))
    unique(members)
    const owner = text(c.owner, 80)
    if (!members.includes(owner) || members.some((key) => !agents.some((a) => a.key === key)))
      throw new Error('Dono ou participante do canal não existe na equipe.')
    return {
      title: text(c.title, 120),
      goal: text(c.goal, 2000, false),
      owner,
      members,
      instructions: text(c.instructions ?? '', MAX_AGENT_INSTRUCTIONS, false),
    }
  })
  return {
    format: 'orchbot.team',
    version: 1,
    project: { name: text(project.name, 100), description: text(project.description, 2000, false) },
    agents,
    skills,
    channels,
  }
}

export function exportTeamPackage(
  db: OrchbotDatabase,
  skills: SkillService,
  projectId: string | null,
): string {
  const project = projectId === null ? null : db.getProject(projectId)
  if (projectId !== null && !project) throw new Error('Projeto não encontrado.')
  const agents = db.listAgents().filter((a) => !isForeman(a) && (a.projectId ?? null) === projectId)
  const agentKeys = new Map(agents.map((a, i) => [a.id, `agent-${i + 1}`]))
  const assigned = new Map(agents.map((a) => [a.id, skills.activeFor(a.id)]))
  const slugs = [...new Set([...assigned.values()].flat().map((s) => s.slug))]
  const skillKeys = new Map(slugs.map((slug, i) => [slug, `skill-${i + 1}`]))
  const pkg: TeamPackage = {
    format: 'orchbot.team',
    version: 1,
    project: { name: project?.name ?? 'Sua Equipe', description: project?.description ?? '' },
    agents: agents.map((a) => ({
      key: agentKeys.get(a.id) ?? '',
      name: a.name,
      description: a.description ?? '',
      avatar: a.avatar ?? '',
      role: a.role ?? 'worker',
      instructions: a.instructions,
      skills: (assigned.get(a.id) ?? []).map((s) => skillKeys.get(s.slug) ?? ''),
    })),
    skills: slugs.map((slug) => {
      const s = skills.get(slug)
      return {
        key: skillKeys.get(slug) ?? '',
        name: s.name,
        description: s.description,
        body: s.body,
      }
    }),
    channels: db
      .listChannels(true)
      .filter(
        (c) =>
          c.ownerAgentId &&
          agentKeys.has(c.ownerAgentId) &&
          c.members.every((m) => agentKeys.has(m.agentId)),
      )
      .map((c) => ({
        title: c.title,
        goal: c.goal,
        owner: agentKeys.get(c.ownerAgentId ?? '') ?? '',
        members: c.members.map((m) => agentKeys.get(m.agentId) ?? ''),
        instructions: c.instructions,
      })),
  }
  return JSON.stringify(parseTeamPackage(JSON.stringify(pkg)), null, 2)
}

function freeName(name: string, taken: Set<string>, max: number, separator = ' '): string {
  let candidate = name.slice(0, max)
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = `${separator}${n}`
    candidate = name.slice(0, max - suffix.length) + suffix
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

export function importTeamPackage(
  db: OrchbotDatabase,
  skills: SkillService,
  source: string,
  workspaceRoot: string,
): Project {
  const pkg = parseTeamPackage(source)
  const connections = db.listConnections().filter((c) => c.enabled)
  const connection =
    connections.find((c) => c.providerId === db.getSettings().defaultProvider) ?? connections[0]
  if (!connection) throw new Error('Conecte um provedor local antes de importar a equipe.')
  fs.mkdirSync(workspaceRoot, { recursive: true })
  const workspace = fs.mkdtempSync(path.join(workspaceRoot, 'equipe-'))
  // shortcut: queda do processo pode deixar arquivos sem vínculo; use diário de importação se recuperação automática for necessária.
  const installed = new Map<string, string>()
  try {
    return db.transaction(() => {
      const project = db.createProject({
        name: freeName(
          pkg.project.name,
          new Set(db.listProjects().map((p) => p.name.toLowerCase())),
          100,
        ),
        description: pkg.project.description,
        workspacePath: workspace,
      })
      const takenSkills = new Set([
        ...skills.list().map((s) => s.slug),
        ...db.listAgents().flatMap((a) => db.listAgentSkills(a.id)),
      ])
      for (const s of pkg.skills) {
        const slug = freeName(slugify(s.name) || 'skill', takenSkills, 64, '-')
        skills.create({ slug, name: s.name, description: s.description, body: s.body }, 'installed')
        installed.set(s.key, slug)
      }
      const takenAgents = new Set(db.listAgents().map((a) => a.name.toLowerCase()))
      const ids = new Map<string, string>()
      for (const a of pkg.agents) {
        const folder = fs.mkdtempSync(path.join(workspace, 'agente-'))
        const agent = db.createAgent({
          name: freeName(a.name, takenAgents, 100),
          description: a.description,
          avatar: a.avatar,
          role: a.role,
          instructions: a.instructions,
          projectId: project.id,
          workspacePath: folder,
          provider: connection.providerId,
          model: connection.defaultModel,
          autonomyLevel: 'cautious',
          browserAccess: false,
          localScripts: false,
          startsNewChats: false,
          computerUse: false,
          showPlanBeforeLongTasks: true,
          steerMode: 'fila',
        })
        ids.set(a.key, agent.id)
        db.setAgentSkills(
          agent.id,
          a.skills.map((key) => installed.get(key) ?? ''),
        )
      }
      const titles = new Set(db.listChannels(true).map((c) => c.title.toLowerCase()))
      for (const c of pkg.channels) {
        const channel = db.createChannel({
          title: freeName(c.title, titles, 120),
          goal: c.goal,
          ownerAgentId: ids.get(c.owner) ?? '',
          memberIds: c.members.map((key) => ids.get(key) ?? ''),
          instructions: c.instructions,
        })
        db.updateChannel(channel.id, { status: 'stopped' })
      }
      return project
    })
  } catch (error) {
    const failures: unknown[] = [error]
    for (const slug of installed.values()) {
      try {
        skills.remove(slug)
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
    }
    try {
      fs.rmSync(workspace, { recursive: true, force: true })
    } catch (cleanupError) {
      failures.push(cleanupError)
    }
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Importação falhou; não foi possível remover todos os arquivos criados.',
      )
    throw error
  }
}
