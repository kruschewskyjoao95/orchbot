import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  Agent,
  Attachment,
  CreateAgentInput,
  CreateScheduledTaskInput,
  Message,
  ProviderConnection,
  ScheduledTask,
  SearchFileResult,
  SearchMessageResult,
  SearchResultGroup,
  SupportedProvider,
  TaskQueueItem,
  TaskStatus,
  Thread,
  UpdateAgentInput,
  UpdateConnectionInput,
  UpdateScheduledTaskInput,
} from '../../shared/types'
import { calculateNextRun, isValidCron } from '../cron/cron-parser'

export function sanitizeFtsQuery(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  const words = raw
    .replace(/[^\p{L}\p{N}\s_]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  return words.map((w) => `"${w}"*`).join(' OR ')
}

export const IGNORED_INDEX_DIRS = new Set([
  'node_modules',
  '.git',
  '.cache',
  'dist',
  'out',
  'build',
  '.idea',
  '.vscode',
  '.next',
  '.solid',
  'coverage',
])

export const INDEXABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.yaml',
  '.yml',
  '.toml',
  '.sh',
  '.py',
  '.rs',
  '.go',
  '.sql',
  '.txt',
])

export const PROVIDER_MODELS: Record<SupportedProvider, string[]> = {
  codex: [
    'gpt-6.1-astra',
    'gpt-6.1-sol',
    'gpt-6.1-terra',
    'gpt-6-luna',
    'gpt-5.4-mini',
    'o3',
    'o3-mini',
    'o1',
    'gpt-4.5-preview',
    'gpt-4o',
    'gpt-4o-mini',
  ],
  claude: [
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-3-7-sonnet',
    'claude-3-5-sonnet',
  ],
  grok: [
    'grok-7',
    'grok-7-mini',
    'grok-7-vision',
    'grok-4.7',
    'grok-4',
    'grok-3',
    'grok-3-mini',
    'grok-2',
  ],
  gemini: [
    'gemini-3.8-flash',
    'gemini-3.8-pro',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-pro-exp',
    'gemini-1.5-pro',
  ],
  muse: ['muse-spark-1.3', 'muse-pro', 'muse-standard', 'muse-code', 'muse-fast'],
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
        autonomy_level TEXT DEFAULT 'autonomous',
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

      -- FTS5: Busca Full-Text e RAG de Mensagens
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        message_id UNINDEXED,
        thread_id UNINDEXED,
        agent_id UNINDEXED,
        role UNINDEXED,
        text,
        tokenize='porter unicode61'
      );

      -- FTS5: Busca Full-Text de Arquivos do Repositório
      CREATE VIRTUAL TABLE IF NOT EXISTS workspace_files_fts USING fts5(
        agent_id UNINDEXED,
        file_path UNINDEXED,
        file_name,
        content,
        updated_at UNINDEXED,
        tokenize='porter unicode61'
      );

      -- Triggers de sincronização automática entre mensagens e FTS5
      CREATE TRIGGER IF NOT EXISTS trg_messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts (message_id, thread_id, agent_id, role, text)
        SELECT new.id, new.thread_id, t.agent_id, new.role, new.text
        FROM threads t WHERE t.id = new.thread_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
      END;

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'routine',
        target_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sched_agent ON scheduled_tasks(agent_id);
      CREATE INDEX IF NOT EXISTS idx_sched_next ON scheduled_tasks(enabled, next_run_at);
    `)

    try {
      this.db.exec(`
        ALTER TABLE messages ADD COLUMN sender_agent_id TEXT;
        ALTER TABLE messages ADD COLUMN recipient_agent_id TEXT;
        ALTER TABLE task_queue ADD COLUMN delegation_depth INTEGER DEFAULT 1;
        ALTER TABLE agents ADD COLUMN autonomy_level TEXT DEFAULT 'autonomous';
      `)
    } catch {
      // Ignora se as colunas já existirem no banco
    }

    try {
      // Backfill de mensagens existentes no FTS5 caso já haja mensagens gravadas
      this.db.exec(`
        INSERT INTO messages_fts (message_id, thread_id, agent_id, role, text)
        SELECT m.id, m.thread_id, t.agent_id, m.role, m.text
        FROM messages m
        JOIN threads t ON t.id = m.thread_id
        WHERE m.id NOT IN (SELECT message_id FROM messages_fts);
      `)
    } catch {
      // Ignora erro se a tabela estiver sincronizada
    }

    try {
      // Migração para corrigir provedores legados (ex: Muse associado erroneamente a Gemini)
      // e atualizar modelos padrão para as versões vigentes de 2026
      const nowIso = new Date().toISOString()
      this.db.exec(`
        UPDATE provider_connections 
        SET name = 'Muse Code', default_model = 'muse-spark-1.3' 
        WHERE provider_id = 'muse' AND (name LIKE '%Gemini%' OR default_model LIKE 'gemini%');

        UPDATE provider_connections 
        SET default_model = 'gpt-6.1-sol' 
        WHERE provider_id = 'codex' AND (default_model = 'gpt-4o' OR default_model = '');

        UPDATE provider_connections 
        SET name = 'Claude Code (Anthropic)', default_model = 'claude-sonnet-5-5' 
        WHERE provider_id = 'claude' AND (default_model = 'claude-3-7-sonnet' OR name = 'Claude (Anthropic)');

        UPDATE provider_connections 
        SET default_model = 'grok-7' 
        WHERE provider_id = 'grok' AND (default_model = 'grok-2' OR default_model = 'grok-3');

        UPDATE agents 
        SET model = 'muse-spark-1.3' 
        WHERE provider = 'muse' AND model LIKE 'gemini%';
      `)
    } catch {
      // Ignora erro se as tabelas ainda não existirem
    }
  }

  private seedDefaultConnections(): void {
    const defaults: Array<{
      id: SupportedProvider
      name: string
      model: string
      endpoint?: string
    }> = [
      { id: 'codex', name: 'Codex (OpenAI)', model: 'gpt-6.1-sol' },
      { id: 'claude', name: 'Claude Code (Anthropic)', model: 'claude-sonnet-5-5' },
      { id: 'grok', name: 'Grok (xAI)', model: 'grok-7', endpoint: 'https://api.x.ai/v1' },
      { id: 'gemini', name: 'Google Gemini', model: 'gemini-3.8-flash' },
      { id: 'muse', name: 'Muse Code', model: 'muse-spark-1.3' },
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
        COALESCE(autonomy_level, 'autonomous') AS autonomyLevel,
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
        COALESCE(autonomy_level, 'autonomous') AS autonomyLevel,
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
      autonomyLevel: input.autonomyLevel || 'autonomous',
      createdAt: now,
      updatedAt: now,
    }

    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, provider, model, instructions, workspace_path, autonomy_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      agent.id,
      agent.name,
      agent.provider,
      agent.model,
      agent.instructions,
      agent.workspacePath,
      agent.autonomyLevel ?? 'autonomous',
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
    const autonomyLevel = input.autonomyLevel ?? current.autonomyLevel ?? 'autonomous'

    const stmt = this.db.prepare(`
      UPDATE agents
      SET name = ?, provider = ?, model = ?, instructions = ?, workspace_path = ?, autonomy_level = ?, updated_at = ?
      WHERE id = ?
    `)

    stmt.run(name, provider, model, instructions, workspacePath, autonomyLevel, now, input.id)

    const updated = this.getAgent(input.id)
    if (!updated) {
      throw new Error(`Falha ao recuperar agente atualizado: ${input.id}`)
    }
    return updated
  }

  public deleteAgent(id: string): boolean {
    try {
      this.db.prepare('DELETE FROM workspace_files_fts WHERE agent_id = ?').run(id)
      this.db.prepare('DELETE FROM messages_fts WHERE agent_id = ?').run(id)
    } catch {
      // Ignora erro se tabelas FTS não existirem
    }
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

  public createThread(agentId: string, title = 'Nova Conversa'): Thread {
    const id = randomUUID()
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO threads (id, agent_id, title, created_at)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(id, agentId, title, now)
    return { id, agentId, title, createdAt: now }
  }

  public deleteThread(threadId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM threads WHERE id = ?')
    stmt.run(threadId)
    return true
  }

  public updateThreadTitle(threadId: string, title: string): Thread {
    const stmt = this.db.prepare('UPDATE threads SET title = ? WHERE id = ?')
    stmt.run(title, threadId)
    const getStmt = this.db.prepare(`
      SELECT id, agent_id AS agentId, title, created_at AS createdAt
      FROM threads
      WHERE id = ?
    `)
    const updated = getStmt.get(threadId) as unknown as Thread | undefined
    if (!updated) {
      throw new Error(`Thread não encontrada: ${threadId}`)
    }
    return updated
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
        COALESCE(a.autonomy_level, 'autonomous') AS autonomyLevel,
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

  public searchMessages(
    rawQuery: string,
    options?: { agentId?: string; limit?: number },
  ): SearchMessageResult[] {
    const ftsQuery = sanitizeFtsQuery(rawQuery)
    if (!ftsQuery) return []

    const limit = options?.limit ?? 20
    const agentId = options?.agentId ?? null

    const stmt = this.db.prepare(`
      SELECT 
        m.id,
        m.thread_id AS threadId,
        t.title AS threadTitle,
        m.role,
        m.text,
        snippet(messages_fts, 4, '<b>', '</b>', '...', 20) AS snippet,
        m.created_at AS createdAt
      FROM messages_fts fts
      JOIN messages m ON m.id = fts.message_id
      JOIN threads t ON t.id = m.thread_id
      WHERE messages_fts MATCH ?
        AND (? IS NULL OR t.agent_id = ?)
      ORDER BY fts.rank ASC
      LIMIT ?
    `)

    return stmt.all(ftsQuery, agentId, agentId, limit) as unknown as SearchMessageResult[]
  }

  public indexWorkspaceFiles(agentId: string, workspacePath: string, maxFiles = 150): number {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return 0
    }

    try {
      this.db.prepare('DELETE FROM workspace_files_fts WHERE agent_id = ?').run(agentId)

      const filesToIndex: Array<{ path: string; name: string; content: string }> = []

      const walk = (currentDir: string) => {
        if (filesToIndex.length >= maxFiles) return
        try {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true })
          for (const entry of entries) {
            if (filesToIndex.length >= maxFiles) break
            if (entry.isDirectory()) {
              if (!IGNORED_INDEX_DIRS.has(entry.name)) {
                walk(path.join(currentDir, entry.name))
              }
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase()
              if (INDEXABLE_EXTENSIONS.has(ext)) {
                const fullPath = path.join(currentDir, entry.name)
                try {
                  const stat = fs.statSync(fullPath)
                  if (stat.size > 0 && stat.size <= 150 * 1024) {
                    const content = fs.readFileSync(fullPath, 'utf-8')
                    filesToIndex.push({
                      path: fullPath,
                      name: entry.name,
                      content,
                    })
                  }
                } catch {
                  // Ignora arquivos que não puderem ser lidos
                }
              }
            }
          }
        } catch {
          // Ignora erros ao listar diretórios protegidos
        }
      }

      walk(workspacePath)

      const insertStmt = this.db.prepare(`
        INSERT INTO workspace_files_fts (agent_id, file_path, file_name, content, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      const now = new Date().toISOString()
      for (const f of filesToIndex) {
        insertStmt.run(agentId, f.path, f.name, f.content, now)
      }

      return filesToIndex.length
    } catch (err) {
      console.error('Erro ao indexar workspace:', err)
      return 0
    }
  }

  public searchWorkspaceFiles(agentId: string, rawQuery: string, limit = 10): SearchFileResult[] {
    const ftsQuery = sanitizeFtsQuery(rawQuery)
    if (!ftsQuery) return []

    const stmt = this.db.prepare(`
      SELECT 
        file_path AS filePath,
        file_name AS fileName,
        snippet(workspace_files_fts, 3, '<b>', '</b>', '...', 24) AS snippet
      FROM workspace_files_fts
      WHERE workspace_files_fts MATCH ?
        AND agent_id = ?
      ORDER BY rank ASC
      LIMIT ?
    `)

    return stmt.all(ftsQuery, agentId, limit) as unknown as SearchFileResult[]
  }

  public searchProjectMemory(agentId: string, rawQuery: string, limit = 15): SearchResultGroup {
    const messages = this.searchMessages(rawQuery, { agentId, limit })
    const files = this.searchWorkspaceFiles(agentId, rawQuery, limit)
    return { messages, files }
  }

  // --- Agendamentos & Tarefas em Background (Cron) ---

  public createScheduledTask(input: CreateScheduledTaskInput): ScheduledTask {
    const id = randomUUID()
    const now = new Date()
    const nowIso = now.toISOString()
    const nextRun = isValidCron(input.cronExpression)
      ? calculateNextRun(input.cronExpression, now).toISOString()
      : null

    const task: ScheduledTask = {
      id,
      agentId: input.agentId,
      threadId: input.threadId ?? null,
      title: input.title,
      prompt: input.prompt,
      cronExpression: input.cronExpression,
      taskType: input.taskType || 'routine',
      targetUrl: input.targetUrl ?? null,
      enabled: input.enabled !== false,
      lastRunAt: null,
      nextRunAt: nextRun,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const stmt = this.db.prepare(`
      INSERT INTO scheduled_tasks (
        id, agent_id, thread_id, title, prompt, cron_expression, 
        task_type, target_url, enabled, last_run_at, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      task.id,
      task.agentId,
      task.threadId ?? null,
      task.title,
      task.prompt,
      task.cronExpression,
      task.taskType,
      task.targetUrl ?? null,
      task.enabled ? 1 : 0,
      task.lastRunAt ?? null,
      task.nextRunAt ?? null,
      task.createdAt,
      task.updatedAt,
    )

    return task
  }

  public getScheduledTask(id: string): ScheduledTask | null {
    const stmt = this.db.prepare(`
      SELECT 
        id,
        agent_id AS agentId,
        thread_id AS threadId,
        title,
        prompt,
        cron_expression AS cronExpression,
        task_type AS taskType,
        target_url AS targetUrl,
        enabled,
        last_run_at AS lastRunAt,
        next_run_at AS nextRunAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scheduled_tasks
      WHERE id = ?
    `)
    const raw = stmt.get(id) as Record<string, unknown> | undefined
    if (!raw) return null
    return {
      ...(raw as unknown as ScheduledTask),
      enabled: raw.enabled === 1 || raw.enabled === true,
    }
  }

  public listScheduledTasks(agentId?: string): ScheduledTask[] {
    const query = agentId
      ? `SELECT 
          id,
          agent_id AS agentId,
          thread_id AS threadId,
          title,
          prompt,
          cron_expression AS cronExpression,
          task_type AS taskType,
          target_url AS targetUrl,
          enabled,
          last_run_at AS lastRunAt,
          next_run_at AS nextRunAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM scheduled_tasks
        WHERE agent_id = ?
        ORDER BY created_at DESC`
      : `SELECT 
          id,
          agent_id AS agentId,
          thread_id AS threadId,
          title,
          prompt,
          cron_expression AS cronExpression,
          task_type AS taskType,
          target_url AS targetUrl,
          enabled,
          last_run_at AS lastRunAt,
          next_run_at AS nextRunAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM scheduled_tasks
        ORDER BY created_at DESC`

    const stmt = this.db.prepare(query)
    const rows = (agentId ? stmt.all(agentId) : stmt.all()) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      ...(r as unknown as ScheduledTask),
      enabled: r.enabled === 1 || r.enabled === true,
    }))
  }

  public getDueScheduledTasks(referenceDateIso?: string): ScheduledTask[] {
    const ref = referenceDateIso || new Date().toISOString()
    const stmt = this.db.prepare(`
      SELECT 
        id,
        agent_id AS agentId,
        thread_id AS threadId,
        title,
        prompt,
        cron_expression AS cronExpression,
        task_type AS taskType,
        target_url AS targetUrl,
        enabled,
        last_run_at AS lastRunAt,
        next_run_at AS nextRunAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scheduled_tasks
      WHERE enabled = 1
        AND (next_run_at IS NULL OR next_run_at <= ?)
      ORDER BY next_run_at ASC
    `)
    const rows = stmt.all(ref) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      ...(r as unknown as ScheduledTask),
      enabled: true,
    }))
  }

  public updateScheduledTask(input: UpdateScheduledTaskInput): ScheduledTask {
    const current = this.getScheduledTask(input.id)
    if (!current) {
      throw new Error(`Agendamento "${input.id}" não encontrado`)
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const title = input.title ?? current.title
    const prompt = input.prompt ?? current.prompt
    const cronExpression = input.cronExpression ?? current.cronExpression
    const taskType = input.taskType ?? current.taskType
    const targetUrl = input.targetUrl !== undefined ? input.targetUrl : current.targetUrl
    const enabled = input.enabled !== undefined ? input.enabled : current.enabled
    const lastRunAt = input.lastRunAt !== undefined ? input.lastRunAt : current.lastRunAt

    let nextRunAt = input.nextRunAt !== undefined ? input.nextRunAt : current.nextRunAt
    if (input.cronExpression || (input.enabled === true && !nextRunAt)) {
      if (isValidCron(cronExpression)) {
        nextRunAt = calculateNextRun(cronExpression, now).toISOString()
      }
    }

    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks
      SET 
        title = ?,
        prompt = ?,
        cron_expression = ?,
        task_type = ?,
        target_url = ?,
        enabled = ?,
        last_run_at = ?,
        next_run_at = ?,
        updated_at = ?
      WHERE id = ?
    `)

    stmt.run(
      title,
      prompt,
      cronExpression,
      taskType,
      targetUrl ?? null,
      enabled ? 1 : 0,
      lastRunAt ?? null,
      nextRunAt ?? null,
      nowIso,
      input.id,
    )

    const updated = this.getScheduledTask(input.id)
    if (!updated) {
      throw new Error('Falha ao atualizar agendamento')
    }
    return updated
  }

  public recordScheduledTaskRun(id: string, runTimeIso: string, nextRunIso: string): void {
    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks
      SET last_run_at = ?, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(runTimeIso, nextRunIso, runTimeIso, id)
  }

  public deleteScheduledTask(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?')
    stmt.run(id)
    return true
  }

  public isOpen(): boolean {
    return this.open
  }

  public close(): void {
    this.open = false
    this.db.close()
  }
}
