import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_TEAM_PACKAGE_BYTES,
  exportTeamPackage,
  parseTeamPackage,
} from '../src/backend/collaboration/team-package'
import { SkillService } from '../src/backend/skills/skill-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { exportTeamPackageFile, importTeamPackageFile } from '../src/main/team-package-files'

const ui = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  getPath: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: ui.getPath },
  dialog: {
    showMessageBox: ui.showMessageBox,
    showOpenDialog: ui.showOpenDialog,
    showSaveDialog: ui.showSaveDialog,
  },
}))

describe('arquivos de equipe e revisão antes de gravar', () => {
  let dir: string
  let db: OrchbotDatabase
  let skills: SkillService
  let file: string
  let source: string
  let projectId: string
  const parent = new BrowserWindow()

  beforeEach(() => {
    vi.resetAllMocks()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-team-files-'))
    ui.getPath.mockReturnValue(dir)
    db = new OrchbotDatabase(':memory:')
    skills = new SkillService(db, path.join(dir, 'skills'))
    db.updateConnection({ providerId: 'codex', enabled: true })
    const project = db.createProject({ name: 'Loja' })
    projectId = project.id
    db.createAgent({
      name: 'Ana',
      provider: 'codex',
      model: 'local',
      projectId,
      workspacePath: '',
      instructions: 'Revisar pedidos',
    })
    source = exportTeamPackage(db, skills, projectId)
    file = path.join(dir, 'equipe.json')
    fs.writeFileSync(file, source)
    ui.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] })
    ui.showMessageBox.mockResolvedValue({ response: 1 })
    ui.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: path.join(dir, 'exportado.json'),
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('cancelar a escolha do arquivo não cria equipe nem abre revisão', async () => {
    ui.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await importTeamPackageFile(parent, db, skills)).toBeNull()
    expect(ui.showMessageBox).not.toHaveBeenCalled()
    expect(db.listProjects()).toHaveLength(1)
  })

  it('cancelar a revisão não altera banco, skills ou pastas', async () => {
    ui.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await importTeamPackageFile(parent, db, skills)).toBeNull()
    expect(db.listProjects()).toHaveLength(1)
    expect(db.listAgents()).toHaveLength(1)
    expect(skills.list()).toEqual([])
    expect(fs.existsSync(path.join(dir, 'Orchbot'))).toBe(false)
    expect(ui.showMessageBox.mock.calls[0][1].detail).toContain('Revisar pedidos')
    expect(ui.showMessageBox.mock.calls[0][1].cancelId).toBe(0)
  })

  it('importa o conteúdo revisado mesmo se o arquivo mudar enquanto o diálogo estiver aberto', async () => {
    ui.showMessageBox.mockImplementationOnce(async () => {
      fs.writeFileSync(file, '{"accountId":"não importar"}')
      return { response: 1 }
    })
    const imported = await importTeamPackageFile(parent, db, skills)
    expect(imported?.name).toBe('Loja 2')
    expect(db.listAgents().filter((a) => a.projectId === imported?.id)).toHaveLength(1)
    expect(ui.showMessageBox.mock.calls[0][1].detail).toContain('Revisar pedidos')
  })

  it('rejeita arquivo inválido ou grande antes de abrir revisão e criar pastas', async () => {
    fs.writeFileSync(file, '{}')
    await expect(importTeamPackageFile(parent, db, skills)).rejects.toThrow()
    fs.writeFileSync(file, 'x'.repeat(MAX_TEAM_PACKAGE_BYTES + 1))
    await expect(importTeamPackageFile(parent, db, skills)).rejects.toThrow('2 MiB')
    expect(ui.showMessageBox).not.toHaveBeenCalled()
    expect(db.listProjects()).toHaveLength(1)
    expect(fs.existsSync(path.join(dir, 'Orchbot'))).toBe(false)
  })

  it('cancelar exportação antes ou depois da revisão não grava arquivo', async () => {
    ui.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await exportTeamPackageFile(parent, db, skills, projectId)).toBeNull()
    expect(ui.showSaveDialog).not.toHaveBeenCalled()
    ui.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await exportTeamPackageFile(parent, db, skills, projectId)).toBeNull()
    expect(fs.existsSync(path.join(dir, 'exportado.json'))).toBe(false)
  })

  it('salva exatamente o pacote revisado, com permissões de arquivo privadas', async () => {
    const saved = await exportTeamPackageFile(parent, db, skills, projectId)
    expect(saved).toBe(path.join(dir, 'exportado.json'))
    const content = fs.readFileSync(saved ?? '', 'utf8')
    expect(content).toBe(source)
    expect(ui.showMessageBox.mock.calls[0][1].detail).toContain(content)
    expect(parseTeamPackage(content).agents).toHaveLength(1)
    if (process.platform !== 'win32') expect(fs.statSync(saved ?? '').mode & 0o777).toBe(0o600)
  })

  it('propaga erro de gravação sem anunciar arquivo salvo', async () => {
    ui.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(dir, 'inexistente', 'equipe.json'),
    })
    await expect(exportTeamPackageFile(parent, db, skills, projectId)).rejects.toThrow()
    expect(db.listProjects()).toHaveLength(1)
  })

  it('falha ao substituir a exportação preserva o arquivo existente e remove staging', async () => {
    const target = path.join(dir, 'exportado.json')
    fs.writeFileSync(target, 'conteúdo anterior')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disco indisponível')
    })
    await expect(exportTeamPackageFile(parent, db, skills, projectId)).rejects.toThrow(
      'disco indisponível',
    )
    expect(fs.readFileSync(target, 'utf8')).toBe('conteúdo anterior')
    expect(fs.readdirSync(dir).some((name) => name.startsWith('.orchbot-team-'))).toBe(false)
  })
})
