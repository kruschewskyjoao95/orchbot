import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  Agent,
  CreateAgentInput,
  Message,
  TaskQueueItem,
  TaskStatus,
  Thread,
} from '../../shared/types'

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
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_queue (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_task_queue_agent ON task_queue(agent_id, status);

      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `)
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
      SELECT id, thread_id AS threadId, role, text, created_at AS createdAt
      FROM messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `)
    return stmt.all(threadId) as unknown as Message[]
  }

  public addMessage(
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    text: string,
  ): Message {
    const now = new Date().toISOString()
    const id = randomUUID()
    const msg: Message = {
      id,
      threadId,
      role,
      text,
      createdAt: now,
    }

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, thread_id, role, text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(msg.id, msg.threadId, msg.role, msg.text, msg.createdAt)
    return msg
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

  public enqueueTask(agentId: string, threadId: string, prompt: string): TaskQueueItem {
    const id = randomUUID()
    const now = new Date().toISOString()
    const item: TaskQueueItem = {
      id,
      agentId,
      threadId,
      prompt,
      status: 'pending',
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    }

    const stmt = this.db.prepare(`
      INSERT INTO task_queue (id, agent_id, thread_id, prompt, status, error, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      item.id,
      item.agentId,
      item.threadId,
      item.prompt,
      item.status,
      item.error ?? null,
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
