import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Attachment } from '../../shared/types'
import type { OrchbotDatabase } from './db'

export class AttachmentManager {
  private baseDir: string

  constructor(
    storageDir: string,
    private db: OrchbotDatabase,
  ) {
    this.baseDir = path.join(storageDir, 'attachments')
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true })
    }
  }

  public async saveAttachment(
    sourcePath: string,
    messageId: string,
    agentId: string,
  ): Promise<Attachment> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo não encontrado: ${sourcePath}`)
    }

    const stat = await fs.promises.stat(sourcePath)
    if (stat.size > 50 * 1024 * 1024) {
      throw new Error('Arquivo excede o limite máximo permitido de 50MB')
    }

    // Calcula SHA-256 do arquivo
    const fileBuffer = await fs.promises.readFile(sourcePath)
    const hash = createHash('sha256').update(fileBuffer).digest('hex')

    const originalName = path.basename(sourcePath)
    const agentAttachmentDir = path.join(this.baseDir, agentId)
    if (!fs.existsSync(agentAttachmentDir)) {
      await fs.promises.mkdir(agentAttachmentDir, { recursive: true })
    }

    // Nome gerenciado imutável
    const targetFileName = `${hash.slice(0, 12)}-${originalName}`
    const targetFilePath = path.join(agentAttachmentDir, targetFileName)

    // Copia para área gerenciada se ainda não existir
    if (!fs.existsSync(targetFilePath)) {
      await fs.promises.copyFile(sourcePath, targetFilePath)
    }

    const ext = path.extname(originalName).toLowerCase()
    const mimeType = this.guessMimeType(ext)

    return this.db.addAttachment(messageId, originalName, targetFilePath, stat.size, mimeType, hash)
  }

  public async removeAgentAttachments(agentId: string): Promise<void> {
    const agentAttachmentDir = path.join(this.baseDir, agentId)
    if (fs.existsSync(agentAttachmentDir)) {
      await fs.promises.rm(agentAttachmentDir, { recursive: true, force: true })
    }
  }

  private guessMimeType(ext: string): string {
    const mimes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.ts': 'text/typescript',
      '.js': 'text/javascript',
      '.zip': 'application/zip',
    }
    return mimes[ext] || 'application/octet-stream'
  }
}
