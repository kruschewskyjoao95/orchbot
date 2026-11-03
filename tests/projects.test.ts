import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { validateCreateAgentInput } from '../src/shared/types'

describe('Projetos (pastas) e robôs com descrição/esforço', () => {
  let tmpDir: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-projects-test-'))
    db = new OrchbotDatabase(path.join(tmpDir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('cria projeto com pasta no disco e robô dentro dele', () => {
    const folder = path.join(tmpDir, 'meu-projeto')
    const project = db.createProject({
      name: 'Meu Projeto',
      description: 'Robôs deste cliente',
      workspacePath: folder,
    })
    expect(fs.existsSync(folder)).toBe(true)
    expect(db.listProjects().map((x) => x.id)).toContain(project.id)

    const agent = db.createAgent({
      name: 'Revisor',
      description: 'Revisa PRs e aponta riscos',
      projectId: project.id,
      provider: 'antigravity',
      model: 'gemini-3.8-flash-medium',
      effort: 'high',
      instructions: 'Seja rigoroso.',
      workspacePath: folder,
    })
    expect(agent.projectId).toBe(project.id)
    expect(agent.description).toBe('Revisa PRs e aponta riscos')
    expect(agent.effort).toBe('high')
    expect(db.getAgent(agent.id)?.effort).toBe('high')
  })

  it('robô sem projeto e sem esforço continua válido (padrão do provedor)', () => {
    const agent = db.createAgent({
      name: 'Solto',
      provider: 'codex',
      model: 'gpt-6.1-sol',
      workspacePath: tmpDir,
    })
    expect(agent.projectId).toBeUndefined()
    expect(agent.effort).toBeUndefined()
  })

  it('rejeita robô com projeto inexistente', () => {
    expect(() =>
      db.createAgent({
        name: 'Órfão',
        projectId: 'projeto-que-nao-existe',
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        workspacePath: tmpDir,
      }),
    ).toThrow(/não encontrado/)
  })

  it('apagar projeto não apaga os robôs: eles ficam sem projeto', () => {
    const project = db.createProject({ name: 'Temporário', workspacePath: tmpDir })
    const agent = db.createAgent({
      name: 'Sobrevivente',
      projectId: project.id,
      provider: 'grok',
      model: 'grok-7',
      workspacePath: tmpDir,
    })
    expect(db.deleteProject(project.id)).toBe(true)
    expect(db.getAgent(agent.id)?.projectId ?? undefined).toBeUndefined()
    expect(db.deleteProject(project.id)).toBe(false)
  })

  it('atualiza esforço e descrição do robô', () => {
    const agent = db.createAgent({
      name: 'Ajustável',
      provider: 'claude',
      model: 'claude-sonnet-5-5',
      workspacePath: tmpDir,
    })
    const updated = db.updateAgent({ id: agent.id, description: 'Escreve testes', effort: 'max' })
    expect(updated.description).toBe('Escreve testes')
    expect(updated.effort).toBe('max')
    const cleared = db.updateAgent({ id: agent.id, effort: null })
    expect(cleared.effort).toBeUndefined()
  })

  it('validateCreateAgentInput aceita projeto, descrição e esforço', () => {
    const input = validateCreateAgentInput({
      name: 'Validador',
      description: 'Valida coisas',
      projectId: 'p1',
      provider: 'kimi',
      model: 'kimi-k2',
      effort: 'low',
      workspacePath: '/tmp',
    })
    expect(input.description).toBe('Valida coisas')
    expect(input.projectId).toBe('p1')
    expect(input.effort).toBe('low')
  })
})
