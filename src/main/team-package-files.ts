import fs from 'node:fs'
import path from 'node:path'
import { type BrowserWindow, app, dialog } from 'electron'
import {
  MAX_TEAM_PACKAGE_BYTES,
  exportTeamPackage,
  importTeamPackage,
  parseTeamPackage,
} from '../backend/collaboration/team-package'
import { type SkillService, slugify } from '../backend/skills/skill-service'
import type { OrchbotDatabase } from '../backend/storage/db'

export async function exportTeamPackageFile(
  mainWindow: BrowserWindow,
  database: OrchbotDatabase,
  skills: SkillService,
  projectId: unknown,
): Promise<string | null> {
  if (projectId !== null && typeof projectId !== 'string') throw new Error('Projeto inválido.')
  const source = exportTeamPackage(database, skills, projectId)
  const pkg = parseTeamPackage(source)
  const preview = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Exportar equipe',
    message: `${pkg.project.name}: ${pkg.agents.length} agentes, ${pkg.channels.length} grupos e ${pkg.skills.length} skills.`,
    detail: `Revise o conteúdo antes de compartilhar. Grupos com participantes de outras equipes ficam fora. Segredos conhecidos são mascarados; revise também dados privados escritos nas instruções.\n\n${source}`,
    buttons: ['Cancelar', 'Salvar arquivo'],
    defaultId: 0,
    cancelId: 0,
  })
  if (preview.response !== 1) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar pacote de equipe',
    defaultPath: `${slugify(pkg.project.name) || 'equipe'}.orchbot-team.json`,
    filters: [{ name: 'Pacote de equipe JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  const staging = fs.mkdtempSync(path.join(path.dirname(result.filePath), '.orchbot-team-'))
  try {
    const file = path.join(staging, 'package.json')
    fs.writeFileSync(file, source, { mode: 0o600 })
    fs.renameSync(file, result.filePath)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
  return result.filePath
}

export async function importTeamPackageFile(
  mainWindow: BrowserWindow,
  database: OrchbotDatabase,
  skills: SkillService,
) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar equipe',
    properties: ['openFile'],
    filters: [{ name: 'Pacote de equipe JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const file = fs.openSync(result.filePaths[0], 'r')
  let source: string
  try {
    if (!fs.fstatSync(file).isFile()) throw new Error('Escolha um arquivo JSON.')
    const buffer = Buffer.alloc(MAX_TEAM_PACKAGE_BYTES + 1)
    const bytes = fs.readSync(file, buffer, 0, buffer.length, 0)
    if (bytes > MAX_TEAM_PACKAGE_BYTES) throw new Error('Pacote maior que 2 MiB.')
    source = buffer.subarray(0, bytes).toString('utf8')
  } finally {
    fs.closeSync(file)
  }
  const pkg = parseTeamPackage(source)
  const preview = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Revisar equipe',
    message: `Importar ${pkg.project.name}?`,
    detail: `${pkg.agents.length} agentes, ${pkg.channels.length} grupos e ${pkg.skills.length} skills. Será criado um projeto novo com o provedor e modelo locais. Agentes cautelosos, sem navegador, scripts, computador ou MCP. Skills vinculadas são instruções: revise seu conteúdo. Grupos chegam parados.\n\n${JSON.stringify(pkg, null, 2)}`,
    buttons: ['Cancelar', 'Importar equipe'],
    defaultId: 0,
    cancelId: 0,
  })
  if (preview.response !== 1) return null
  return importTeamPackage(database, skills, source, path.join(app.getPath('home'), 'Orchbot'))
}
