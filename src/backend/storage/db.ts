import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  Agent,
  Attachment,
  CreateAgentInput,
  Message,
  ProviderConnection,
  SupportedProvider,
  TaskQueueItem,
  TaskStatus,
  Thread,
  UpdateAgentInput,
  UpdateConnectionInput,
} from '../../shared/types'

export const PROVIDER_MODELS: Record<SupportedProvider, string[]> = {
  codex: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini', 'codex-preview'],
  claude: ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus'],
  grok: ['grok-2', 'grok-2-1212', 'grok-beta', 'grok-2-vision-1212'],
  muse: [
    'gemini-2.0-flash',
    'gemini-2.0-pro-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'muse-thinking',
  ],
}

export class OrchbotDatabase {
  private db: DatabaseSync
  private open = true

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA foreign_keys = ON;')
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;')
    }

    this.initMigrations()
    this.seedDefaultConnections()
  }

  private initMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        instructions TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        avatar TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        sender_agent_id TEXT,
        recipient_agent_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_msg ON attachments(message_id);

      CREATE TABLE IF NOT EXISTS task_queue (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        delegation_depth INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_task_queue_agent ON task_queue(agent_id, status);

      CREATE TABLE IF NOT EXISTS provider_connections (
        provider_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        api_key TEXT,
        endpoint TEXT,
        default_model TEXT NOT NULL,
        custom_config_json TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `)

    try {
      this.db.exec(`
        ALTER TABLE messages ADD COLUMN sender_agent_id TEXT;
        ALTER TABLE messages ADD COLUMN recipient_agent_id TEXT;
        ALTER TABLE task_queue ADD COLUMN delegation_depth INTEGER DEFAULT 1;
      `)
    } catch {
      // Ignora se as colunas já existirem no banco
    }
  }

  private seedDefaultConnections(): void {
    const defaults: Array<{
      id: SupportedProvider
      name: string
      model: string
      endpoint?: string
    }> = [
      { id: 'codex', name: 'Codex (OpenAI)', model: 'gpt-4o' },
      { id: 'claude', name: 'Claude (Anthropic)', model: 'claude-3-7-sonnet' },
      { id: 'grok', name: 'Grok (xAI)', model: 'grok-2', endpoint: 'https://api.x.ai/v1' },
      { id: 'muse', name: 'Muse (Google Gemini)', model: 'gemini-2.0-flash' },
    ]

    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO provider_connections (provider_id, name, enabled, api_key, endpoint, default_model, updated_at)
      VALUES (?, ?, 1, NULL, ?, ?, ?)
    `)

    for (const d of defaults) {
      stmt.run(d.id, d.name, d.endpoint ?? null, d.model, now)
    }
  }

  public listConnections(): ProviderConnection[] {
    const stmt = this.db.prepare(`
      SELECT 
        provider_id AS providerId,
        name,
        enabled,
        api_key AS apiKey,
        endpoint,
        default_model AS defaultModel,
        updated_at AS updatedAt
      FROM provider_connections
      ORDER BY rowid ASC
    `)
    const rows = stmt.all() as unknown as Array<{
      providerId: SupportedProvider
      name: string
      enabled: number
      apiKey: string | null
      endpoint: string | null
      defaultModel: string
      updatedAt: string
    }>

    return rows.map((r) => ({
      providerId: r.providerId,
      name: r.name,
      enabled: Boolean(r.enabled),
      apiKey: r.apiKey ?? undefined,
      endpoint: r.endpoint ?? undefined,
      defaultModel: r.defaultModel,
      available: false,
      models: PROVIDER_MODELS[r.providerId] || [r.defaultModel],
      updatedAt: r.updatedAt,
    }))
  }

  public getConnection(providerId: SupportedProvider): ProviderConnection | null {
    const stmt = this.db.prepare(`
      SELECT 
        provider_id AS providerId,
        name,
        enabled,
        api_key AS apiKey,
        endpoint,
        default_model AS defaultModel,
        updated_at AS updatedAt
      FROM provider_connections
      WHERE provider_id = ?
    `)
    const r = stmt.get(providerId) as unknown as
      | {
          providerId: SupportedProvider
          name: string
          enabled: number
          apiKey: string | null
          endpoint: string | null
          defaultModel: string
          updatedAt: string
        }
      | undefined

    if (!r) return null

    return {
      providerId: r.providerId,
      name: r.name,
      enabled: Boolean(r.enabled),
      apiKey: r.apiKey ?? undefined,
      endpoint: r.endpoint ?? undefined,
      defaultModel: r.defaultModel,
      available: false,
      models: PROVIDER_MODELS[r.providerId] || [r.defaultModel],
      updatedAt: r.updatedAt,
    }
  }

  public updateConnection(input: UpdateConnectionInput): ProviderConnection {
    const current = this.getConnection(input.providerId)
    if (!current) {
      throw new Error(`Conexão do provedor "${input.providerId}" não encontrada`)
    }

    const now = new Date().toISOString()
    const newEnabled =
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled ? 1 : 0
    const newApiKey = input.apiKey !== undefined ? input.apiKey : (current.apiKey ?? null)
    const newEndpoint = input.endpoint !== undefined ? input.endpoint : (current.endpoint ?? null)
    const newModel = input.defaultModel !== undefined ? input.defaultModel : current.defaultModel

    const stmt = this.db.prepare(`
      UPDATE provider_connections
      SET enabled = ?, api_key = ?, endpoint = ?, default_model = ?, updated_at = ?
      WHERE provider_id = ?
    `)

    stmt.run(newEnabled, newApiKey, newEndpoint, newModel, now, input.providerId)

    const updated = this.getConnection(input.providerId)
    if (!updated) {
      throw new Error(`Falha ao recuperar conexão atualizada: ${input.providerId}`)
    }
    return updated
  }

  public listAgents(): Agent[] {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        name, 
        provider, 
        model, 
        instructions, 
        workspace_path AS workspacePath, 
        avatar, 
        created_at AS createdAt, 
        updated_at AS updatedAt 
      FROM agents 
      ORDER BY created_at DESC
    `)
    return stmt.all() as unknown as Agent[]
  }

  public getAgent(id: string): Agent | null {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        name, 
        provider, 
        model, 
        instructions, 
        workspace_path AS workspacePath, 
        avatar, 
        created_at AS createdAt, 
        updated_at AS updatedAt 
      FROM agents 
      WHERE id = ?
    `)
    const result = stmt.get(id) as unknown as Agent | undefined
    return result ?? null
  }

  public createAgent(input: CreateAgentInput): Agent {
    const now = new Date().toISOString()
    const id = randomUUID()
    const agent: Agent = {
      id,
      name: input.name,
      provider: input.provider,
      model: input.model,
      instructions: input.instructions || '',
      workspacePath: input.workspacePath,
      createdAt: now,
      updatedAt: now,
    }

    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, provider, model, instructions, workspace_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      agent.id,
      agent.name,
      agent.provider,
      agent.model,
      agent.instructions,
      agent.workspacePath,
      agent.createdAt,
      agent.updatedAt,
    )

    // Cria thread inicial default para o agente
    const threadId = randomUUID()
    const threadStmt = this.db.prepare(`
      INSERT INTO threads (id, agent_id, title, created_at)
      VALUES (?, ?, ?, ?)
    `)
    threadStmt.run(threadId, agent.id, 'Conversa Inicial', now)

    return agent
  }

  public updateAgent(input: UpdateAgentInput): Agent {
    const current = this.getAgent(input.id)
    if (!current) {
      throw new Error(`Agente com ID ${input.id} não encontrado`)
    }

    const now = new Date().toISOString()
    const name = input.name ?? current.name
    const provider = input.provider ?? current.provider
    const model = input.model ?? current.model
    const instructions = input.instructions ?? current.instructions
    const workspacePath = input.workspacePath ?? current.workspacePath

    const stmt = this.db.prepare(`
      UPDATE agents
      SET name = ?, provider = ?, model = ?, instructions = ?, workspace_path = ?, updated_at = ?
      WHERE id = ?
    `)

    stmt.run(name, provider, model, instructions, workspacePath, now, input.id)

    const updated = this.getAgent(input.id)
    if (!updated) {
      throw new Error(`Falha ao recuperar agente atualizado: ${input.id}`)
    }
    return updated
  }

  public deleteAgent(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM agents WHERE id = ?')
    stmt.run(id)
    return true
  }

  public listThreads(agentId: string): Thread[] {
    const stmt = this.db.prepare(`
      SELECT id, agent_id AS agentId, title, created_at AS createdAt
      FROM threads
      WHERE agent_id = ?
      ORDER BY created_at ASC
    `)
    return stmt.all(agentId) as unknown as Thread[]
  }

  public listMessages(threadId: string): Message[] {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        thread_id AS threadId, 
        role, 
        text, 
        sender_agent_id AS senderAgentId, 
        recipient_agent_id AS recipientAgentId, 
        created_at AS createdAt
      FROM messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `)
    const rows = stmt.all(threadId) as unknown as Message[]
    for (const msg of rows) {
      msg.attachments = this.getAttachments(msg.id)
    }
    return rows
  }

  public addMessage(
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    text: string,
    senderAgentId?: string,
    recipientAgentId?: string,
  ): Message {
    const now = new Date().toISOString()
    const id = randomUUID()
    const msg: Message = {
      id,
      threadId,
      role,
      text,
      senderAgentId,
      recipientAgentId,
      createdAt: now,
      attachments: [],
    }

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, thread_id, role, text, sender_agent_id, recipient_agent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      msg.id,
      msg.threadId,
      msg.role,
      msg.text,
      msg.senderAgentId ?? null,
      msg.recipientAgentId ?? null,
      msg.createdAt,
    )
    return msg
  }

  public addAttachment(
    messageId: string,
    fileName: string,
    filePath: string,
    fileSize: number,
    mimeType: string,
    hash: string,
  ): Attachment {
    const id = randomUUID()
    const now = new Date().toISOString()
    const attachment: Attachment = {
      id,
      messageId,
      fileName,
      filePath,
      fileSize,
      mimeType,
      hash,
      createdAt: now,
    }

    const stmt = this.db.prepare(`
      INSERT INTO attachments (id, message_id, file_name, file_path, file_size, mime_type, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      attachment.id,
      attachment.messageId,
      attachment.fileName,
      attachment.filePath,
      attachment.fileSize,
      attachment.mimeType,
      attachment.hash,
      attachment.createdAt,
    )
    return attachment
  }

  public getAttachments(messageId: string): Attachment[] {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        message_id AS messageId, 
        file_name AS fileName, 
        file_path AS filePath, 
        file_size AS fileSize, 
        mime_type AS mimeType, 
        hash, 
        created_at AS createdAt
      FROM attachments
      WHERE message_id = ?
      ORDER BY created_at ASC
    `)
    return stmt.all(messageId) as unknown as Attachment[]
  }

  public getThread(threadId: string): Thread | null {
    const stmt = this.db.prepare(`
      SELECT id, agent_id AS agentId, title, created_at AS createdAt
      FROM threads
      WHERE id = ?
    `)
    const result = stmt.get(threadId) as unknown as Thread | undefined
    return result ?? null
  }

  public getAgentByThreadId(threadId: string): Agent | null {
    const stmt = this.db.prepare(`
      SELECT 
        a.id, 
        a.name, 
        a.provider, 
        a.model, 
        a.instructions, 
        a.workspace_path AS workspacePath, 
        a.avatar, 
        a.created_at AS createdAt, 
        a.updated_at AS updatedAt
      FROM agents a
      JOIN threads t ON t.agent_id = a.id
      WHERE t.id = ?
    `)
    const result = stmt.get(threadId) as unknown as Agent | undefined
    return result ?? null
  }

  public enqueueTask(
    agentId: string,
    threadId: string,
    prompt: string,
    delegationDepth = 1,
  ): TaskQueueItem {
    const id = randomUUID()
    const now = new Date().toISOString()
    const item: TaskQueueItem = {
      id,
      agentId,
      threadId,
      prompt,
      status: 'pending',
      error: null,
      delegationDepth,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    }

    const stmt = this.db.prepare(`
      INSERT INTO task_queue (id, agent_id, thread_id, prompt, status, error, delegation_depth, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      item.id,
      item.agentId,
      item.threadId,
      item.prompt,
      item.status,
      item.error ?? null,
      item.delegationDepth ?? 1,
      item.createdAt,
      item.startedAt ?? null,
      item.completedAt ?? null,
    )
    return item
  }

  public getTask(id: string): TaskQueueItem | null {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        agent_id AS agentId, 
        thread_id AS threadId, 
        prompt, 
        status, 
        error, 
        delegation_depth AS delegationDepth, 
        created_at AS createdAt, 
        started_at AS startedAt, 
        completed_at AS completedAt
      FROM task_queue
      WHERE id = ?
    `)
    const result = stmt.get(id) as unknown as TaskQueueItem | undefined
    return result ?? null
  }

  public getNextPendingTask(agentId: string): TaskQueueItem | null {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        agent_id AS agentId, 
        thread_id AS threadId, 
        prompt, 
        status, 
        error, 
        delegation_depth AS delegationDepth, 
        created_at AS createdAt, 
        started_at AS startedAt, 
        completed_at AS completedAt
      FROM task_queue
      WHERE agent_id = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `)
    const result = stmt.get(agentId) as unknown as TaskQueueItem | undefined
    return result ?? null
  }

  public updateTaskStatus(id: string, status: TaskStatus, error?: string | null): TaskQueueItem {
    const now = new Date().toISOString()
    if (status === 'running') {
      const stmt = this.db.prepare(`
        UPDATE task_queue 
        SET status = ?, started_at = COALESCE(started_at, ?), error = ?
        WHERE id = ?
      `)
      stmt.run(status, now, error ?? null, id)
    } else {
      const stmt = this.db.prepare(`
        UPDATE task_queue 
        SET status = ?, completed_at = ?, error = ?
        WHERE id = ?
      `)
      stmt.run(status, now, error ?? null, id)
    }

    const updated = this.getTask(id)
    if (!updated) {
      throw new Error(`Tarefa ${id} não encontrada para atualização`)
    }
    return updated
  }

  public listTasks(agentId: string): TaskQueueItem[] {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        agent_id AS agentId, 
        thread_id AS threadId, 
        prompt, 
        status, 
        error, 
        delegation_depth AS delegationDepth, 
        created_at AS createdAt, 
        started_at AS startedAt, 
        completed_at AS completedAt
      FROM task_queue
      WHERE agent_id = ?
      ORDER BY created_at DESC
    `)
    return stmt.all(agentId) as unknown as TaskQueueItem[]
  }

  public reconcileRunningTasks(): number {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      UPDATE task_queue
      SET status = 'interrupted',
          completed_at = ?,
          error = 'Interrompido por encerramento inesperado do aplicativo'
      WHERE status = 'running'
    `)
    const info = stmt.run(now)
    return Number(info.changes)
  }

  public isOpen(): boolean {
    return this.open
  }

  public close(): void {
    this.open = false
    this.db.close()
  }
}
