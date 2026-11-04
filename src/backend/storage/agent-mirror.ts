import fs from 'node:fs'
import path from 'node:path'
import type { Agent, AgentMemory } from '../../shared/types'

/**
 * `<workspace>/.orchbot/<sub>`, criada na hora. O `.gitignore` com `*` tira a pasta
 * inteira do `git status` do agente sem mexer em nenhum arquivo do repositório.
 */
export function orchbotDir(workspace: string, ...sub: string[]): string {
  const base = path.join(path.resolve(workspace), '.orchbot')
  const dir = path.join(base, ...sub)
  fs.mkdirSync(dir, { recursive: true })
  const ignore = path.join(base, '.gitignore')
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n')
  return dir
}

/**
 * Cópia legível da identidade e da memória do agente em `<workspace>/.orchbot/agent/`.
 * Só de leitura: o SQLite continua sendo o dono, editar o arquivo não muda o agente.
 * Só escreve se o workspace já existe e engole erro (disco cheio, sem permissão).
 */
export function mirrorAgent(agent: Agent, memories: AgentMemory[]): void {
  try {
    const root = agent.workspacePath?.trim()
    if (!root || !fs.existsSync(root)) return
    const dir = orchbotDir(root, 'agent')
    const soul = [
      `# ${agent.name}`,
      '',
      agent.description ? `${agent.description}\n` : '',
      '## Instruções',
      '',
      agent.instructions.trim() || '(sem instruções)',
      '',
    ].join('\n')
    const memory = [
      `# Memória de ${agent.name}`,
      '',
      ...(memories.length
        ? memories.map(
            (m) =>
              `- [${m.kind === 'task' ? 'tarefa' : 'preferência'}] ${m.text.replace(/\s+/g, ' ')}`,
          )
        : ['(vazia)']),
      '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'SOUL.md'), soul)
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), memory)
  } catch {
    // shortcut: espelho é cortesia; se falhar o app segue, a próxima mudança tenta de novo.
  }
}
