import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AttachmentManager } from '../src/backend/storage/attachment-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'

describe('Fase 4: Anexos Gerenciados (AttachmentManager)', () => {
  let db: OrchbotDatabase
  let attachmentManager: AttachmentManager
  const testDir = path.resolve(__dirname, '../.test-attachments-tmp')
  const testDbPath = path.join(testDir, 'attach-test.db')
  const sampleFilePath = path.join(testDir, 'sample-code.ts')

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
    // Cria arquivo de teste
    fs.writeFileSync(sampleFilePath, 'export const greeting = "Olá Orchbot";\n')

    db = new OrchbotDatabase(testDbPath)
    attachmentManager = new AttachmentManager(testDir, db)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('deve copiar arquivo para área gerenciada, calcular hash sha256 e associar à mensagem', async () => {
    const agent = db.createAgent({
      name: 'AttachBot',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/tmp/attach-bot',
    })

    const threads = db.listThreads(agent.id)
    const msg = db.addMessage(threads[0].id, 'user', 'Aqui está o arquivo')

    const attachment = await attachmentManager.saveAttachment(sampleFilePath, msg.id, agent.id)

    expect(attachment.id).toBeDefined()
    expect(attachment.fileName).toBe('sample-code.ts')
    expect(attachment.mimeType).toBe('text/typescript')
    expect(attachment.hash).toBeDefined()
    expect(fs.existsSync(attachment.filePath)).toBe(true)

    // O arquivo copiado deve conter o conteúdo original
    const content = fs.readFileSync(attachment.filePath, 'utf-8')
    expect(content).toContain('Olá Orchbot')

    // Deve vir anexado na lista de mensagens
    const messages = db.listMessages(threads[0].id)
    expect(messages.length).toBe(1)
    expect(messages[0].attachments?.length).toBe(1)
    expect(messages[0].attachments?.[0].id).toBe(attachment.id)
  })

  it('deve rejeitar arquivo inexistente', async () => {
    const fakePath = path.join(testDir, 'nao-existe.txt')
    await expect(attachmentManager.saveAttachment(fakePath, 'msg-1', 'agent-1')).rejects.toThrow(
      'Arquivo não encontrado',
    )
  })

  it('deve limpar pasta de anexos do agente quando solicitado', async () => {
    const agent = db.createAgent({
      name: 'CleanBot',
      provider: 'claude',
      model: 'claude-3-7-sonnet',
      workspacePath: '/tmp/clean',
    })
    const threads = db.listThreads(agent.id)
    const msg = db.addMessage(threads[0].id, 'user', 'Arquivo para limpar')

    const attachment = await attachmentManager.saveAttachment(sampleFilePath, msg.id, agent.id)
    expect(fs.existsSync(attachment.filePath)).toBe(true)

    await attachmentManager.removeAgentAttachments(agent.id)
    expect(fs.existsSync(attachment.filePath)).toBe(false)
  })
})
