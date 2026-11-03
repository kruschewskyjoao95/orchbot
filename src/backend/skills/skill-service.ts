import fs from 'node:fs'
import path from 'node:path'
import type {
  Agent,
  SkillCatalogEntry,
  SkillDetail,
  SkillInfo,
  SkillSource,
} from '../../shared/types'
import type { OrchbotDatabase } from '../storage/db'
import { type SkillDirective, buildSkillInstructions } from './skill-protocol'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_BODY = 40 * 1024
const MAX_FOLDER_BYTES = 1024 * 1024
const MAX_FOLDER_FILES = 50
const MAX_LIBRARY = 200
const MAX_PROMPT_SKILLS = 40
const META = '.orchbot.json'

interface Meta {
  source: SkillSource
  version: number
  createdBy?: string
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Lê o front matter `--- name/description ---` de um SKILL.md. */
export function parseSkillFile(content: string): {
  name?: string
  description?: string
  body: string
} {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { body: content.trim() }
  const field = (key: string) =>
    m[1]
      .match(new RegExp(`^${key}:\\s*(.*)$`, 'mi'))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '')
  return { name: field('name'), description: field('description'), body: m[2].trim() }
}

const render = (name: string, description: string, body: string) =>
  `---\nname: ${name.replace(/\n/g, ' ')}\ndescription: ${description.replace(/\n/g, ' ')}\n---\n\n${body.trim()}\n`

export class SkillService {
  constructor(
    private db: OrchbotDatabase,
    private libraryDir: string,
    private bundledDir?: string,
  ) {
    fs.mkdirSync(libraryDir, { recursive: true })
    // Sobras de instalações interrompidas (queda do app no meio da cópia).
    for (const e of fs.readdirSync(libraryDir))
      if (e.startsWith('.staging-'))
        fs.rmSync(path.join(libraryDir, e), { recursive: true, force: true })
  }

  /** Monta a skill numa pasta temporária e só então a move para a biblioteca: nunca fica pela metade. */
  private commit(finalDir: string, build: (tmp: string) => void): void {
    const tmp = fs.mkdtempSync(path.join(this.libraryDir, '.staging-'))
    try {
      build(tmp)
      fs.renameSync(tmp, finalDir)
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw err
    }
  }

  private replaceFile(file: string, content: string): void {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, file)
  }

  private dir(slug: string): string {
    if (!SLUG_RE.test(slug))
      throw new Error('Nome de skill inválido (use minúsculas, números e "-").')
    return path.join(this.libraryDir, slug)
  }

  private readMeta(dir: string): Meta {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8')) as Meta
    } catch {
      return { source: 'installed', version: 1 }
    }
  }

  private info(slug: string): SkillInfo | null {
    const dir = path.join(this.libraryDir, slug)
    const file = path.join(dir, 'SKILL.md')
    if (!SLUG_RE.test(slug) || !fs.existsSync(file)) return null
    const parsed = parseSkillFile(fs.readFileSync(file, 'utf8'))
    const meta = this.readMeta(dir)
    return {
      slug,
      name: parsed.name || slug,
      description: parsed.description || '',
      version: meta.version,
      source: meta.source,
      createdBy: meta.createdBy,
      updatedAt: fs.statSync(file).mtime.toISOString(),
    }
  }

  public list(): SkillInfo[] {
    return fs
      .readdirSync(this.libraryDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => this.info(e.name))
      .filter((s): s is SkillInfo => s !== null)
      .sort((a, b) => a.slug.localeCompare(b.slug))
  }

  public get(slug: string): SkillDetail {
    const info = this.info(slug)
    if (!info) throw new Error(`Skill "${slug}" não encontrada.`)
    const body = parseSkillFile(fs.readFileSync(path.join(this.dir(slug), 'SKILL.md'), 'utf8')).body
    return { ...info, body }
  }

  private write(
    slug: string,
    name: string,
    description: string,
    body: string,
    meta: Meta,
  ): SkillInfo {
    if (!name.trim()) throw new Error('Dê um nome à skill.')
    if (!description.trim()) throw new Error('Descreva quando a skill deve ser usada (uma linha).')
    if (!body.trim()) throw new Error('A skill está sem instruções.')
    if (Buffer.byteLength(body) > MAX_BODY)
      throw new Error('Instruções grandes demais (máx. 40 KB).')
    const dir = this.dir(slug)
    const content = render(name, description.slice(0, 300), body)
    if (fs.existsSync(dir)) {
      this.replaceFile(path.join(dir, 'SKILL.md'), content)
      this.replaceFile(path.join(dir, META), JSON.stringify(meta))
    } else {
      this.commit(dir, (tmp) => {
        fs.writeFileSync(path.join(tmp, 'SKILL.md'), content)
        fs.writeFileSync(path.join(tmp, META), JSON.stringify(meta))
      })
    }
    return this.info(slug) as SkillInfo
  }

  public create(
    input: { slug?: string; name: string; description: string; body: string },
    source: SkillSource = 'user',
    createdBy?: string,
  ): SkillInfo {
    const slug = input.slug || slugify(input.name)
    if (fs.existsSync(path.join(this.libraryDir, slug, 'SKILL.md')))
      throw new Error(`Já existe a skill "${slug}".`)
    if (this.list().length >= MAX_LIBRARY) throw new Error('Biblioteca cheia (200 skills).')
    return this.write(slug, input.name, input.description, input.body, {
      source,
      version: 1,
      createdBy,
    })
  }

  /** Nova versão; a anterior vai para `.history/vN.md`. */
  public revise(
    slug: string,
    input: { name?: string; description: string; body: string },
  ): SkillInfo {
    const current = this.get(slug)
    const dir = this.dir(slug)
    const history = path.join(dir, '.history')
    fs.mkdirSync(history, { recursive: true })
    fs.copyFileSync(path.join(dir, 'SKILL.md'), path.join(history, `v${current.version}.md`))
    const meta = this.readMeta(dir)
    return this.write(slug, input.name ?? current.name, input.description, input.body, {
      ...meta,
      version: current.version + 1,
    })
  }

  public remove(slug: string): boolean {
    const dir = this.dir(slug)
    if (!fs.existsSync(dir)) return false
    fs.rmSync(dir, { recursive: true, force: true })
    this.db.removeSkillAssignments(slug)
    return true
  }

  /** Copia uma pasta com SKILL.md para a biblioteca (sem symlinks, com limites de tamanho). */
  public installFolder(
    source: string,
    source_: SkillSource = 'installed',
    createdBy?: string,
  ): SkillInfo {
    const root = fs.realpathSync(source)
    const stat = fs.statSync(root)
    if (!stat.isDirectory()) throw new Error('Escolha uma pasta que contenha um SKILL.md.')
    const file = path.join(root, 'SKILL.md')
    if (!fs.existsSync(file)) throw new Error('A pasta não tem SKILL.md.')

    const files: string[] = []
    let bytes = 0
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === META || entry.name === '.history') continue
        const full = path.join(dir, entry.name)
        if (entry.isSymbolicLink())
          throw new Error(`Links simbólicos não são permitidos (${entry.name}).`)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) {
          files.push(full)
          bytes += fs.statSync(full).size
          if (files.length > MAX_FOLDER_FILES || bytes > MAX_FOLDER_BYTES)
            throw new Error('Pasta grande demais (máx. 50 arquivos e 1 MB).')
        }
      }
    }
    walk(root)

    const parsed = parseSkillFile(fs.readFileSync(file, 'utf8'))
    const slug = slugify(parsed.name || path.basename(root))
    if (!slug) throw new Error('Não foi possível determinar o nome da skill.')
    if (!parsed.description) throw new Error('O SKILL.md precisa de "description" no cabeçalho.')
    if (fs.existsSync(path.join(this.libraryDir, slug)))
      throw new Error(`Já existe a skill "${slug}".`)
    if (this.list().length >= MAX_LIBRARY) throw new Error('Biblioteca cheia (200 skills).')

    this.commit(this.dir(slug), (tmp) => {
      for (const f of files) {
        const target = path.join(tmp, path.relative(root, f))
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(f, target)
      }
      fs.writeFileSync(
        path.join(tmp, META),
        JSON.stringify({ source: source_, version: 1, createdBy }),
      )
    })
    return this.info(slug) as SkillInfo
  }

  // --- Catálogo embutido no app (funciona offline) ---

  public catalog(): SkillCatalogEntry[] {
    if (!this.bundledDir || !fs.existsSync(this.bundledDir)) return []
    const installed = new Set(this.list().map((s) => s.slug))
    return fs
      .readdirSync(this.bundledDir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          fs.existsSync(path.join(this.bundledDir as string, e.name, 'SKILL.md')),
      )
      .map((e) => {
        const p = parseSkillFile(
          fs.readFileSync(path.join(this.bundledDir as string, e.name, 'SKILL.md'), 'utf8'),
        )
        return {
          slug: e.name,
          name: p.name || e.name,
          description: p.description || '',
          installed: installed.has(e.name),
        }
      })
  }

  public installBundled(slug: string): SkillInfo {
    if (!this.bundledDir || !SLUG_RE.test(slug))
      throw new Error('Skill do catálogo não encontrada.')
    const src = path.join(this.bundledDir, slug)
    if (!fs.existsSync(src)) throw new Error('Skill do catálogo não encontrada.')
    return this.installFolder(src, 'bundled')
  }

  // --- Agentes ---

  /** Skills ativas do agente que ainda existem na biblioteca. */
  public activeFor(agentId: string): SkillInfo[] {
    return this.db
      .listAgentSkills(agentId)
      .map((slug) => this.info(slug))
      .filter((s): s is SkillInfo => s !== null)
  }

  public contextSection(agentId: string): string {
    const active = this.activeFor(agentId).slice(0, MAX_PROMPT_SKILLS)
    return buildSkillInstructions(active.map((s) => ({ slug: s.slug, description: s.description })))
  }

  /** Executa os blocos do agente; devolve linhas de resultado para o modelo. */
  public run(agent: Agent, directives: SkillDirective[]): string[] {
    return directives.map((d) => {
      const label = `skill:${d.action}`
      try {
        if (d.action === 'list') {
          const all = this.list()
          const mine = new Set(this.db.listAgentSkills(agent.id))
          return `[${label}] ${all.length ? all.map((s) => `- ${s.slug}${mine.has(s.slug) ? ' (ativa)' : ''}: ${s.description}`).join('\n') : 'a biblioteca está vazia.'}`
        }
        if (d.action === 'load') {
          if (!this.db.listAgentSkills(agent.id).includes(d.target))
            return `[${label}] a skill "${d.target}" não está ativa para você.`
          const s = this.get(d.target)
          return `[${label}] ${s.name} (v${s.version})\n${s.body}`
        }
        if (d.action === 'install') {
          const root = fs.realpathSync(agent.workspacePath)
          const src = fs.realpathSync(path.resolve(root, d.target))
          if (src !== root && !src.startsWith(root + path.sep))
            return `[${label}] a pasta precisa estar dentro do seu workspace.`
          const s = this.installFolder(src, 'agent', agent.name)
          this.activate(agent.id, s.slug)
          return `[${label}] instalada "${s.slug}" e ativada para você.`
        }
        const [first, ...rest] = d.body.split('\n')
        const description = first.trim()
        const body = rest.join('\n').trim()
        if (d.action === 'create') {
          const slug = slugify(d.target)
          const s = this.create({ slug, name: d.target, description, body }, 'agent', agent.name)
          this.activate(agent.id, s.slug)
          return `[${label}] skill "${s.slug}" criada e ativada para você.`
        }
        const slug = slugify(d.target)
        if (!this.db.listAgentSkills(agent.id).includes(slug))
          return `[${label}] a skill "${slug}" não está ativa para você.`
        const s = this.revise(slug, { description, body })
        return `[${label}] skill "${s.slug}" atualizada para a v${s.version}.`
      } catch (err) {
        return `[${label}] erro: ${err instanceof Error ? err.message : String(err)}`
      }
    })
  }

  private activate(agentId: string, slug: string): void {
    this.db.setAgentSkills(agentId, [...new Set([...this.db.listAgentSkills(agentId), slug])])
  }
}
