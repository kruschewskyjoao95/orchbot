import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Agent, CreateAgentInput, Message, Thread } from '../../shared/types'

export class OrchbotDatabase {
  private db: DatabaseSync

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

  public close(): void {
    this.db.close()
  }
}
