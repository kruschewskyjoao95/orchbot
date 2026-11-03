import fs from 'node:fs'
import path from 'node:path'
import { slugify } from '../backend/skills/skill-service'

/**
 * Pasta nova para um agente criado sem pasta escolhida: `<raiz>/<nome>`, com sufixo se já existir,
 * para dois agentes não dividirem o mesmo workspace sem querer.
 */
export function createDefaultAgentWorkspace(root: string, agentName: string): string {
  const base = slugify(agentName) || 'agente'
  let dir = path.join(root, base)
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(root, `${base}-${n}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
