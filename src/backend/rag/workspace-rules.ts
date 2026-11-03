import fs from 'node:fs'
import path from 'node:path'
import type { WorkspaceRulesInfo } from '../../shared/types'

export const RULE_FILE_CANDIDATES = [
  'ORCHBOT.md',
  'orchbot.md',
  'AGENTS.md',
  'agents.md',
  '.orchbot.md',
  'CLAUDE.md',
]

/**
 * Lê automaticamente as diretrizes de arquitetura e padrões do repositório
 * a partir de arquivos padronizados no workspace (ORCHBOT.md, AGENTS.md, etc.).
 */
export function loadWorkspaceRules(workspacePath: string): WorkspaceRulesInfo {
  if (!workspacePath) {
    return { exists: false }
  }

  try {
    if (!fs.existsSync(workspacePath)) {
      return { exists: false }
    }

    for (const candidate of RULE_FILE_CANDIDATES) {
      const fullPath = path.join(workspacePath, candidate)
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath)
        if (stat.isFile() && stat.size <= 250 * 1024) {
          const content = fs.readFileSync(fullPath, 'utf-8').trim()
          if (content.length > 0) {
            return {
              exists: true,
              filename: candidate,
              filePath: fullPath,
              content,
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Erro ao inspecionar regras do workspace:', err)
  }

  return { exists: false }
}
