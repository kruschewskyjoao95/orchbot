import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assertMcpToolSupport, hasMcpRestriction, parseMcpToolPolicy } from '../../shared/authority'
import { isCustomProvider, validateCustomProviderInput } from '../../shared/custom-providers'
import { tokensFromChars } from '../../shared/tokens'
import { isProviderEffort } from '../../shared/types'
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  MAX_AGENT_INSTRUCTIONS,
  type MemoryKind,
  normalizeAvatar,
} from '../../shared/types'
import type {
  Agent,
  AgentMcpToolPolicy,
  AgentMemory,
  AgentReaction,
  Approval,
  Attachment,
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelStatus,
  CreateAgentInput,
  CreateChannelInput,
  CreateCustomProviderInput,
  CreateProjectInput,
  CreateProviderAccountInput,
  CreateScheduledTaskInput,
  McpServerInfo,
  Message,
  ProfileStats,
  Project,
  ProviderAccount,
  ProviderConnection,
  SaveMcpServerInput,
  ScheduledTask,
  SearchFileResult,
  SearchMessageResult,
  SearchResultGroup,
  SkillProposal,
  SupportedProvider,
  TaskQueueItem,
  TaskStatus,
  Thread,
  UpdateAgentInput,
  UpdateConnectionInput,
  UpdateProjectInput,
  UpdateProviderAccountInput,
  UpdateScheduledTaskInput,
  WebhookTrigger,
} from '../../shared/types'
import { calculateNextRun, isValidCron } from '../cron/cron-parser'
import { isSafeEnvKey } from '../mcp/mcp-launch'
import { memoryFreshness } from '../memory/decay'
import { FOREMAN_INSTRUCTIONS, isForeman } from '../orchestration/foreman'
import { PROVIDER_CATALOG } from '../providers/catalog'
import { isCliSessionId } from '../providers/session-cli'
import type { McpLaunchServer, TurnUsage } from '../providers/types'
import { mirrorAgent } from './agent-mirror'
import {
  ENCRYPTED_KEY_PREFIX,
  KEY_STORAGE_ERROR,
  type SecretStorage,
  canStoreSecrets,
  decryptApiKey,
  encryptApiKey,
} from './secrets'

/** O coordenador tem texto fixo do sistema; o resto passa pelo limite. */
function checkInstructionsLength(instructions: string | undefined): void {
  if (
    instructions &&
    instructions !== FOREMAN_INSTRUCTIONS &&
    instructions.length > MAX_AGENT_INSTRUCTIONS
  )
    throw new Error(
      `As instruções passam de ${MAX_AGENT_INSTRUCTIONS} caracteres (${instructions.length}).`,
    )
}

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
  // espelho do agente e caixa de entrada: já estão no banco ou são do colega
  '.orchbot',
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

export const PROVIDER_MODELS: Record<SupportedProvider, string[]> = Object.fromEntries(
  Object.entries(PROVIDER_CATALOG).map(([id, entry]) => [id, entry.models]),
) as Record<SupportedProvider, string[]>

interface ConnectionCustomConfig {
  cliPath?: string
  cliArgs?: string[]
  apiKeyEnv?: string
  effort?: ProviderConnection['effort']
}

function parseCustomConfig(raw: string | null | undefined): ConnectionCustomConfig {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      cliPath: typeof parsed.cliPath === 'string' ? parsed.cliPath : undefined,
      cliArgs:
        Array.isArray(parsed.cliArgs) && parsed.cliArgs.every((arg) => typeof arg === 'string')
          ? parsed.cliArgs
          : undefined,
      apiKeyEnv: typeof parsed.apiKeyEnv === 'string' ? parsed.apiKeyEnv : undefined,
      effort: isProviderEffort(parsed.effort)
        ? (parsed.effort as ProviderConnection['effort'])
        : undefined,
    }
  } catch {
    return {}
  }
}

function normalizeTask(row: TaskQueueItem): TaskQueueItem {
  return {
    ...row,
    originThreadId: row.originThreadId ?? undefined,
    originAgentId: row.originAgentId ?? undefined,
  }
}

function triState(value: unknown): boolean | undefined {
  if (value === 1 || value === true) return true
  if (value === 0 || value === false) return false
  return undefined
}

function triToDb(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0
}

function normalizeThread(row: Thread): Thread {
  return { ...row, projectId: row.projectId || undefined }
}

function normalizeAgent(row: Agent): Agent {
  return {
    ...row,
    accountId: row.accountId ?? undefined,
    role: row.role === 'orchestrator' ? 'orchestrator' : 'worker',
    description: row.description ?? undefined,
    projectId: row.projectId ?? undefined,
    effort: row.effort ?? undefined,
    contextMode:
      row.contextMode === 'economico' || row.contextMode === 'completo'
        ? row.contextMode
        : 'padrao',
    browserAccess: row.browserAccess !== false && (row.browserAccess as unknown) !== 0,
    localScripts: triState(row.localScripts as unknown),
    startsNewChats: triState(row.startsNewChats as unknown),
    showPlanBeforeLongTasks: triState(row.showPlanBeforeLongTasks as unknown),
    steerMode: row.steerMode === 'imediato' || row.steerMode === 'fila' ? row.steerMode : undefined,
    computerUse: triState(row.computerUse as unknown),
    handoffAgentId: row.handoffAgentId ?? undefined,
    systemRole: row.systemRole === 'foreman' ? 'foreman' : undefined,
  }
}

export interface BrainStoredPage {
  id: string
  projectId: string
  slug: string
  title: string
  type: string
  content: string
  updatedAt: string
}

export interface BrainStoredProposal {
  id: string
  projectId: string
  agentId: string | null
  slug: string
  title: string
  type: string
  content: string
  reason: string
  source: string
  status: string
  createdAt: string
  decidedAt: string | null
}

const BRAIN_PROPOSAL_COLUMNS = `id, project_id AS projectId, agent_id AS agentId, slug, title, type,
  content, reason, source, status, created_at AS createdAt, decided_at AS decidedAt`

export class OrchbotDatabase {
  private db: DatabaseSync
  private open = true

  public transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  constructor(
    private readonly dbPath: string,
    private readonly secretStorage?: SecretStorage,
  ) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;')
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;')
    }

    this.initMigrations()
    this.seedDefaultConnections()
    try {
      this.migrateApiKeys()
    } catch (error) {
      this.db.close()
      this.open = false
      throw error
    }
    // Antes do coordenador nascer no boot: um agente criado agora não pode esconder a escolha inicial.
    this.migrateProvidersSetup()
  }

  /** Banco que já tem uso não reabre a escolha de provedor. A chave ausente numa instalação vazia continua falsa. */
  private migrateProvidersSetup(): void {
    const marked = this.db
      .prepare('SELECT 1 AS ok FROM app_settings WHERE key = ?')
      .get('providersSetupDone')
    if (marked) return
    const used = this.db
      .prepare(
        `SELECT 1 AS ok FROM agents
         UNION ALL SELECT 1 FROM threads
         UNION ALL SELECT 1 FROM messages
         LIMIT 1`,
      )
      .get()
    if (!used) return
    this.db
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('providersSetupDone', JSON.stringify(true))
  }

  private initMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        workspace_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS provider_sessions (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        session_id TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS provider_accounts (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES provider_connections(provider_id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        auth_mode TEXT NOT NULL CHECK(auth_mode IN ('api_key', 'cli_profile')),
        api_key TEXT,
        profile_path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider ON provider_accounts(provider_id);

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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        task_id TEXT,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        note TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS webhook_triggers (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS control_requests (
        request_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        accepted_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_receipts (
        trigger_id TEXT NOT NULL REFERENCES webhook_triggers(id) ON DELETE CASCADE,
        delivery_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        accepted_at INTEGER NOT NULL,
        PRIMARY KEY (trigger_id, delivery_id)
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_receipts_accepted ON webhook_receipts(accepted_at);

      CREATE TABLE IF NOT EXISTS agent_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id, created_at);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        memory_id UNINDEXED,
        agent_id UNINDEXED,
        text,
        tokenize='porter unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS trg_memories_ai AFTER INSERT ON agent_memories BEGIN
        INSERT INTO memories_fts (memory_id, agent_id, text) VALUES (new.id, new.agent_id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS trg_memories_ad AFTER DELETE ON agent_memories BEGIN
        DELETE FROM memories_fts WHERE memory_id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_memories_au AFTER UPDATE OF text ON agent_memories BEGIN
        DELETE FROM memories_fts WHERE memory_id = old.id;
        INSERT INTO memories_fts (memory_id, agent_id, text) VALUES (new.id, new.agent_id, new.text);
      END;

      CREATE TABLE IF NOT EXISTS skill_proposals (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS brain_pages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, slug)
      );

      CREATE TABLE IF NOT EXISTS brain_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_brain_proposals_project
        ON brain_proposals(project_id, status, created_at);

      CREATE TABLE IF NOT EXISTS agent_skills (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        PRIMARY KEY (agent_id, slug)
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        transport TEXT NOT NULL,
        command TEXT,
        args TEXT NOT NULL DEFAULT '[]',
        url TEXT,
        secrets TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_mcp (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, server_id)
      );

      CREATE TABLE IF NOT EXISTS agent_dm (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        from_agent_id TEXT NOT NULL,
        from_thread_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        to_thread_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, agent_id, emoji)
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT NOT NULL DEFAULT '',
        owner_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        archived INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        PRIMARY KEY (channel_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_channel_members_thread ON channel_members(thread_id);

      CREATE TABLE IF NOT EXISTS channel_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        author_agent_id TEXT,
        kind TEXT NOT NULL DEFAULT 'message',
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channel_messages ON channel_messages(channel_id, created_at);

      CREATE TABLE IF NOT EXISTS usage_cumulative (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        session_id TEXT,
        input INTEGER NOT NULL,
        cached INTEGER NOT NULL,
        output INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_summaries (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        covers_until TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)

    // Cada ALTER roda isolado: em banco novo, colunas do CREATE TABLE já
    // existem e um erro não pode impedir as colunas seguintes.
    for (const alter of [
      'ALTER TABLE messages ADD COLUMN sender_agent_id TEXT',
      'ALTER TABLE messages ADD COLUMN recipient_agent_id TEXT',
      'ALTER TABLE task_queue ADD COLUMN delegation_depth INTEGER DEFAULT 1',
      "ALTER TABLE agents ADD COLUMN autonomy_level TEXT DEFAULT 'autonomous'",
      'ALTER TABLE agents ADD COLUMN project_id TEXT',
      'ALTER TABLE agents ADD COLUMN description TEXT',
      'ALTER TABLE agents ADD COLUMN effort TEXT',
      "ALTER TABLE agents ADD COLUMN role TEXT DEFAULT 'worker'",
      "ALTER TABLE agents ADD COLUMN context_mode TEXT DEFAULT 'padrao'",
      'ALTER TABLE agents ADD COLUMN browser_access INTEGER DEFAULT 1',
      'ALTER TABLE agents ADD COLUMN local_scripts INTEGER',
      'ALTER TABLE agents ADD COLUMN starts_new_chats INTEGER',
      'ALTER TABLE agents ADD COLUMN show_plan INTEGER',
      'ALTER TABLE agents ADD COLUMN steer_mode TEXT',
      'ALTER TABLE agents ADD COLUMN computer_use INTEGER',
      "ALTER TABLE agents ADD COLUMN runtime TEXT NOT NULL DEFAULT 'host'",
      'ALTER TABLE webhook_triggers ADD COLUMN github_repository TEXT',
      'ALTER TABLE task_queue ADD COLUMN required_runtime TEXT',
      'ALTER TABLE agents ADD COLUMN account_id TEXT',
      'ALTER TABLE agents ADD COLUMN paused INTEGER DEFAULT 0',
      'ALTER TABLE messages ADD COLUMN input_tokens INTEGER',
      'ALTER TABLE messages ADD COLUMN output_tokens INTEGER',
      'ALTER TABLE messages ADD COLUMN cached_tokens INTEGER',
      'ALTER TABLE messages ADD COLUMN context_tokens INTEGER',
      'ALTER TABLE messages ADD COLUMN context_window INTEGER',
      'ALTER TABLE messages ADD COLUMN context_session_id TEXT',
      'ALTER TABLE provider_connections ADD COLUMN default_account_enabled INTEGER NOT NULL DEFAULT 1',
      'ALTER TABLE task_queue ADD COLUMN browser_rounds INTEGER DEFAULT 0',
      'ALTER TABLE task_queue ADD COLUMN computer_rounds INTEGER DEFAULT 0',
      'ALTER TABLE task_queue ADD COLUMN memory_rounds INTEGER DEFAULT 0',
      'ALTER TABLE task_queue ADD COLUMN origin_thread_id TEXT',
      'ALTER TABLE task_queue ADD COLUMN origin_agent_id TEXT',
      'ALTER TABLE agents ADD COLUMN handoff_agent_id TEXT',
      'ALTER TABLE agents ADD COLUMN system_role TEXT',
      'ALTER TABLE agent_mcp ADD COLUMN tool_policy TEXT',
      'ALTER TABLE threads ADD COLUMN project_id TEXT',
      'ALTER TABLE approvals ADD COLUMN payload_json TEXT',
      "ALTER TABLE agent_memories ADD COLUMN kind TEXT DEFAULT 'preference'",
      'ALTER TABLE agent_memories ADD COLUMN touched_at TEXT',
    ]) {
      try {
        this.db.exec(alter)
      } catch {
        // Ignora se a coluna já existir no banco
      }
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
      this.db.exec(`
        INSERT INTO memories_fts (memory_id, agent_id, text)
        SELECT id, agent_id, text FROM agent_memories
        WHERE id NOT IN (SELECT memory_id FROM memories_fts);
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
        SET default_model = 'grok-4.7' 
        WHERE provider_id = 'grok' AND (default_model IN ('grok-2','grok-3','grok-7'));

        -- Antigravity passou a falar ACP: os ids "<modelo>-low|medium|high" viraram modelo + esforço.
        UPDATE agents SET effort = COALESCE(effort, substr(model, 16)), model = 'gemini-4-argon'
          WHERE provider = 'antigravity' AND model IN ('gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high');
        UPDATE provider_connections SET default_model = 'gemini-4-argon'
          WHERE provider_id = 'antigravity' AND default_model IN ('gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high');
        UPDATE agents SET effort = COALESCE(effort, substr(model, 18)), model = 'gemini-3.8-flash'
          WHERE provider = 'antigravity' AND model IN ('gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high');
        UPDATE provider_connections SET default_model = 'gemini-3.8-flash'
          WHERE provider_id = 'antigravity' AND default_model IN ('gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high');
        UPDATE agents SET effort = COALESCE(effort, substr(model, 17)), model = 'claude-opus-5-5'
          WHERE provider = 'antigravity' AND model IN ('claude-opus-5-5-low', 'claude-opus-5-5-medium', 'claude-opus-5-5-high');
        UPDATE provider_connections SET default_model = 'claude-opus-5-5'
          WHERE provider_id = 'antigravity' AND default_model IN ('claude-opus-5-5-low', 'claude-opus-5-5-medium', 'claude-opus-5-5-high');
        UPDATE agents SET effort = COALESCE(effort, substr(model, 19)), model = 'claude-sonnet-5-5'
          WHERE provider = 'antigravity' AND model IN ('claude-sonnet-5-5-low', 'claude-sonnet-5-5-medium', 'claude-sonnet-5-5-high');
        UPDATE provider_connections SET default_model = 'claude-sonnet-5-5'
          WHERE provider_id = 'antigravity' AND default_model IN ('claude-sonnet-5-5-low', 'claude-sonnet-5-5-medium', 'claude-sonnet-5-5-high');

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
    }> = Object.values(PROVIDER_CATALOG).map((entry) => ({
      id: entry.providerId,
      name: entry.name,
      model: entry.defaultModel,
      endpoint: entry.providerId === 'grok' ? 'https://api.x.ai/v1' : undefined,
    }))

    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO provider_connections (provider_id, name, enabled, api_key, endpoint, default_model, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
    `)

    for (const d of defaults) {
      stmt.run(d.id, d.name, d.id === 'acp' ? 0 : 1, d.endpoint ?? null, d.model, now)
    }
  }

  private compactSecrets(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);')
  }

  private migrateApiKeys(): void {
    if (!canStoreSecrets(this.secretStorage)) return
    const rows = this.db
      .prepare(
        "SELECT provider_id, api_key FROM provider_connections WHERE api_key IS NOT NULL AND api_key != ''",
      )
      .all() as Array<{ provider_id: string; api_key: string }>
    const legacy = rows.filter((r) => !r.api_key.startsWith(ENCRYPTED_KEY_PREFIX))
    if (!legacy.length) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const update = this.db.prepare(
        'UPDATE provider_connections SET api_key = ? WHERE provider_id = ?',
      )
      for (const row of legacy)
        update.run(encryptApiKey(row.api_key, this.secretStorage), row.provider_id)
      this.db.exec('COMMIT')
    } catch {
      this.db.exec('ROLLBACK')
      throw new Error('Não foi possível proteger as chaves existentes no cofre do sistema.')
    }
    this.compactSecrets()
  }

  public getConnectionApiKey(providerId: SupportedProvider): string | undefined {
    const row = this.db
      .prepare('SELECT api_key FROM provider_connections WHERE provider_id = ?')
      .get(providerId) as { api_key: string | null } | undefined
    if (!row?.api_key) return undefined
    if (!canStoreSecrets(this.secretStorage)) throw new Error(KEY_STORAGE_ERROR)
    if (!row.api_key.startsWith(ENCRYPTED_KEY_PREFIX)) {
      this.migrateApiKeys()
      return this.getConnectionApiKey(providerId)
    }
    return decryptApiKey(row.api_key, this.secretStorage)
  }

  private keyStorageError(providerId: SupportedProvider): string | undefined {
    if (!canStoreSecrets(this.secretStorage)) return KEY_STORAGE_ERROR
    try {
      this.getConnectionApiKey(providerId)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : KEY_STORAGE_ERROR
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
        custom_config_json AS customConfigJson,
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
      customConfigJson: string | null
      updatedAt: string
    }>

    return rows.map((r) => {
      const custom = parseCustomConfig(r.customConfigJson)
      const entry = PROVIDER_CATALOG[r.providerId]
      return {
        providerId: r.providerId,
        name: r.name,
        enabled: Boolean(r.enabled),
        hasApiKey: Boolean(r.apiKey),
        keyStorageError: this.keyStorageError(r.providerId),
        endpoint: r.endpoint ?? undefined,
        defaultModel: r.defaultModel,
        cliPath: custom.cliPath,
        cliArgs: custom.cliArgs,
        apiKeyEnv: custom.apiKeyEnv,
        effort: custom.effort,
        available: false,
        installHint: entry?.installHint,
        docsUrl: entry?.docsUrl,
        cliCommand: entry?.cliCommand,
        supportsEffort: entry?.supportsEffort,
        models: PROVIDER_MODELS[r.providerId] || [r.defaultModel],
        updatedAt: r.updatedAt,
      }
    })
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
        custom_config_json AS customConfigJson,
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
          customConfigJson: string | null
          updatedAt: string
        }
      | undefined

    if (!r) return null

    const custom = parseCustomConfig(r.customConfigJson)
    const entry = PROVIDER_CATALOG[r.providerId]
    return {
      providerId: r.providerId,
      name: r.name,
      enabled: Boolean(r.enabled),
      hasApiKey: Boolean(r.apiKey),
      keyStorageError: this.keyStorageError(r.providerId),
      endpoint: r.endpoint ?? undefined,
      defaultModel: r.defaultModel,
      cliPath: custom.cliPath,
      cliArgs: custom.cliArgs,
      apiKeyEnv: custom.apiKeyEnv,
      effort: custom.effort,
      available: false,
      installHint: entry?.installHint,
      docsUrl: entry?.docsUrl,
      cliCommand: entry?.cliCommand,
      supportsEffort: entry?.supportsEffort,
      models: PROVIDER_MODELS[r.providerId] || [r.defaultModel],
      updatedAt: r.updatedAt,
    }
  }

  public getAccountProfilesDirectory(): string | undefined {
    return this.dbPath === ':memory:'
      ? undefined
      : path.join(path.dirname(path.resolve(this.dbPath)), 'accounts')
  }

  public listProviderAccounts(providerId: SupportedProvider): ProviderAccount[] {
    if (typeof providerId !== 'string') throw new Error('Provedor inválido.')
    const connection = this.getConnection(providerId)
    if (!connection) throw new Error('Provedor não cadastrado.')
    const defaults = this.db
      .prepare(
        'SELECT default_account_enabled AS enabled FROM provider_connections WHERE provider_id = ?',
      )
      .get(providerId) as { enabled: number }
    const rows = this.db
      .prepare(
        'SELECT id, label, enabled, auth_mode AS authMode, api_key AS apiKey, profile_path AS profilePath FROM provider_accounts WHERE provider_id = ? ORDER BY rowid',
      )
      .all(providerId) as Array<{
      id: string
      label: string
      enabled: number
      authMode: 'api_key' | 'cli_profile'
      apiKey: string | null
      profilePath: string | null
    }>
    return [
      {
        id: providerId,
        providerId,
        label: 'Padrão',
        authMode: 'inherit',
        enabled: Boolean(defaults.enabled),
        isDefault: true,
        hasApiKey: connection.hasApiKey,
        keyStorageError: connection.keyStorageError,
        available: false,
      },
      ...rows.map((row): ProviderAccount => {
        let keyStorageError: string | undefined
        if (row.apiKey) {
          try {
            decryptApiKey(row.apiKey, this.secretStorage)
          } catch (error) {
            keyStorageError = error instanceof Error ? error.message : KEY_STORAGE_ERROR
          }
        }
        return {
          id: row.id,
          providerId,
          label: row.label,
          authMode: row.authMode,
          enabled: Boolean(row.enabled),
          isDefault: false,
          hasApiKey: Boolean(row.apiKey),
          keyStorageError,
          profilePath: row.profilePath ?? undefined,
          available: false,
        }
      }),
    ]
  }

  public getProviderAccount(
    providerId: SupportedProvider,
    id?: string,
  ): ProviderAccount | undefined {
    const accounts = this.listProviderAccounts(providerId)
    if (id !== undefined)
      return typeof id === 'string' && id
        ? accounts.find((account) => account.id === id)
        : undefined
    return accounts.find((account) => account.enabled)
  }

  public getProviderAccountApiKey(providerId: SupportedProvider, id: string): string | undefined {
    if (id === providerId) return this.getConnectionApiKey(providerId)
    const row = this.db
      .prepare('SELECT api_key FROM provider_accounts WHERE id = ? AND provider_id = ?')
      .get(id, providerId) as { api_key: string | null } | undefined
    if (!row) throw new Error('Conta não pertence ao provedor selecionado.')
    return row.api_key ? decryptApiKey(row.api_key, this.secretStorage) : undefined
  }

  private validateAccountLabel(label: unknown): string {
    if (typeof label !== 'string' || !label.trim() || label.length > 100)
      throw new Error('Informe um nome de conta de até 100 caracteres.')
    return label.trim()
  }

  private validateAccountProfile(
    providerId: SupportedProvider,
    directory: unknown,
    exceptId?: string,
  ): string {
    if (providerId !== 'codex' && providerId !== 'claude')
      throw new Error('Perfis de CLI separados estão disponíveis para Codex e Claude.')
    if (
      typeof directory !== 'string' ||
      !path.isAbsolute(directory) ||
      directory.includes('\0') ||
      directory.length > 4096
    )
      throw new Error('Informe um diretório absoluto válido para o perfil do CLI.')
    if (fs.existsSync(directory) && !fs.statSync(directory).isDirectory())
      throw new Error('O perfil do CLI deve ser um diretório.')
    const resolved = fs.existsSync(directory) ? fs.realpathSync(directory) : path.resolve(directory)
    if (
      this.db
        .prepare(
          'SELECT id FROM provider_accounts WHERE provider_id = ? AND profile_path = ? AND id != ?',
        )
        .get(providerId, resolved, exceptId ?? '')
    )
      throw new Error('Este diretório já está cadastrado em outra conta do provedor.')
    return resolved
  }

  public createProviderAccount(input: CreateProviderAccountInput): ProviderAccount {
    if (!input || typeof input.providerId !== 'string' || !this.getConnection(input.providerId))
      throw new Error('Provedor não cadastrado.')
    const label = this.validateAccountLabel(input.label)
    if (input.authMode !== 'api_key' && input.authMode !== 'cli_profile')
      throw new Error('Tipo de autenticação inválido.')
    let key: string | null = null
    let profile: string | null = null
    if (input.authMode === 'api_key') {
      if (input.profilePath)
        throw new Error('Contas de API key usam um perfil gerenciado pelo app.')
      if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || /[\r\n]/.test(input.apiKey))
        throw new Error('Informe a chave de API desta conta.')
      key = encryptApiKey(input.apiKey.trim(), this.secretStorage)
    } else {
      if (input.apiKey)
        throw new Error('Um perfil de CLI usa seu próprio login; não informe uma API key.')
      profile = this.validateAccountProfile(input.providerId, input.profilePath)
      fs.mkdirSync(profile, { recursive: true, mode: 0o700 })
    }
    const id = `account:${randomUUID()}`
    this.db
      .prepare(
        'INSERT INTO provider_accounts (id, provider_id, label, auth_mode, api_key, profile_path) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.providerId, label, input.authMode, key, profile)
    return this.getProviderAccount(input.providerId, id) as ProviderAccount
  }

  public updateProviderAccount(input: UpdateProviderAccountInput): ProviderAccount {
    if (!input || typeof input.id !== 'string' || !input.id) throw new Error('Conta inválida.')
    const current = this.getProviderAccount(input.providerId, input.id)
    if (!current) throw new Error('Conta não encontrada no provedor selecionado.')
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      throw new Error('Estado da conta inválido.')
    if (current.isDefault) {
      if (
        input.apiKey !== undefined ||
        input.profilePath !== undefined ||
        input.label !== undefined
      )
        throw new Error('Edite as credenciais da conta Padrão na configuração do provedor.')
      this.db
        .prepare(
          'UPDATE provider_connections SET default_account_enabled = ? WHERE provider_id = ?',
        )
        .run((input.enabled ?? current.enabled) ? 1 : 0, input.providerId)
    } else {
      const label = this.validateAccountLabel(input.label ?? current.label)
      const profile =
        input.profilePath !== undefined
          ? this.validateAccountProfile(input.providerId, input.profilePath, input.id)
          : current.profilePath
      if (input.profilePath !== undefined && current.authMode === 'cli_profile' && profile)
        fs.mkdirSync(profile, { recursive: true, mode: 0o700 })
      const row = this.db
        .prepare('SELECT api_key FROM provider_accounts WHERE id = ? AND provider_id = ?')
        .get(input.id, input.providerId) as { api_key: string | null }
      let key = row.api_key
      if (input.apiKey !== undefined) {
        if (
          current.authMode !== 'api_key' ||
          typeof input.apiKey !== 'string' ||
          /[\r\n]/.test(input.apiKey)
        )
          throw new Error('Chave de API inválida para esta conta.')
        key = input.apiKey.trim() ? encryptApiKey(input.apiKey.trim(), this.secretStorage) : null
      }
      if (input.profilePath !== undefined && current.authMode !== 'cli_profile')
        throw new Error('Esta conta usa API key, não um perfil de CLI.')
      const enabled =
        current.authMode === 'api_key' && !key ? false : (input.enabled ?? current.enabled)
      this.db
        .prepare(
          'UPDATE provider_accounts SET label = ?, enabled = ?, api_key = ?, profile_path = ? WHERE id = ? AND provider_id = ?',
        )
        .run(label, enabled ? 1 : 0, key, profile ?? null, input.id, input.providerId)
      if (input.apiKey !== undefined) this.compactSecrets()
    }
    return this.getProviderAccount(input.providerId, input.id) as ProviderAccount
  }

  public deleteProviderAccount(providerId: SupportedProvider, id: string): boolean {
    if (typeof id !== 'string' || !id) throw new Error('Conta inválida.')
    if (id === providerId) throw new Error('A conta Padrão pode ser desativada, mas não removida.')
    const automatic = this.getProviderAccount(providerId)
    const users = this.db
      .prepare('SELECT id, account_id AS accountId FROM agents WHERE provider = ?')
      .all(providerId) as Array<{ id: string; accountId: string | null }>
    if (users.some((agent) => agent.accountId === id || (!agent.accountId && automatic?.id === id)))
      throw new Error(
        'Esta conta está em uso por um robô. Selecione outra conta antes de removê-la.',
      )
    const result = this.db
      .prepare('DELETE FROM provider_accounts WHERE id = ? AND provider_id = ?')
      .run(id, providerId)
    if (result.changes) this.compactSecrets()
    return Boolean(result.changes)
  }

  public createCustomProvider(input: CreateCustomProviderInput): ProviderConnection {
    const values = validateCustomProviderInput(input)
    const providerId = `custom:${randomUUID()}` as const
    const encrypted = values.apiKey ? encryptApiKey(values.apiKey, this.secretStorage) : null
    this.db
      .prepare(`INSERT INTO provider_connections (provider_id, name, enabled, api_key, endpoint, default_model, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)`)
      .run(
        providerId,
        values.name,
        encrypted,
        values.endpoint,
        values.defaultModel,
        new Date().toISOString(),
      )
    return this.getConnection(providerId) as ProviderConnection
  }

  public deleteCustomProvider(providerId: string): boolean {
    if (!isCustomProvider(providerId))
      throw new Error('Somente provedores cadastrados podem ser removidos.')
    if (this.db.prepare('SELECT id FROM agents WHERE provider = ? LIMIT 1').get(providerId)) {
      throw new Error('Este provedor está em uso. Troque o provedor dos robôs antes de removê-lo.')
    }
    const result = this.db
      .prepare('DELETE FROM provider_connections WHERE provider_id = ?')
      .run(providerId)
    if (result.changes) this.compactSecrets()
    return Boolean(result.changes)
  }

  public updateConnection(input: UpdateConnectionInput): ProviderConnection {
    const current = this.getConnection(input.providerId)
    if (!current) {
      throw new Error(`Conexão do provedor "${input.providerId}" não encontrada`)
    }

    if (
      input.cliPath !== undefined &&
      (typeof input.cliPath !== 'string' || input.cliPath.includes('\0'))
    ) {
      throw new Error('Comando da CLI inválido.')
    }
    if (
      input.cliArgs !== undefined &&
      (!Array.isArray(input.cliArgs) ||
        input.cliArgs.length > 100 ||
        input.cliArgs.some(
          (arg) => typeof arg !== 'string' || arg.includes('\0') || arg.length > 10000,
        ))
    ) {
      throw new Error('Argumentos da CLI devem ser uma lista JSON de textos (até 100 argumentos).')
    }
    if (
      input.apiKeyEnv !== undefined &&
      (typeof input.apiKeyEnv !== 'string' ||
        (input.apiKeyEnv !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.apiKeyEnv)))
    ) {
      throw new Error('Nome de variável de ambiente inválido para a chave de API.')
    }
    let customValues: CreateCustomProviderInput | undefined
    if (isCustomProvider(input.providerId)) {
      customValues = validateCustomProviderInput({
        name: input.name ?? current.name,
        endpoint: input.endpoint ?? current.endpoint ?? '',
        defaultModel: input.defaultModel ?? current.defaultModel,
        apiKey: input.apiKey,
      })
      if (
        current.hasApiKey &&
        input.apiKey === undefined &&
        new URL(customValues.endpoint).origin !== new URL(current.endpoint as string).origin
      ) {
        throw new Error('Ao mudar o host da API, informe uma nova chave ou remova a chave salva.')
      }
    }
    const now = new Date().toISOString()
    const newEnabled =
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled ? 1 : 0
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') {
      throw new Error('Chave de API inválida')
    }
    const stored = this.db
      .prepare('SELECT api_key FROM provider_connections WHERE provider_id = ?')
      .get(input.providerId) as { api_key: string | null }
    const newApiKey =
      input.apiKey === undefined
        ? stored.api_key
        : input.apiKey
          ? encryptApiKey(input.apiKey, this.secretStorage)
          : null
    const newEndpoint =
      customValues?.endpoint ??
      (input.endpoint !== undefined ? input.endpoint : (current.endpoint ?? null))
    const newModel =
      customValues?.defaultModel ??
      (input.defaultModel !== undefined ? input.defaultModel : current.defaultModel)
    const newCustom: ConnectionCustomConfig = {
      cliPath: input.cliPath !== undefined ? input.cliPath || undefined : current.cliPath,
      cliArgs: input.cliArgs !== undefined ? input.cliArgs : current.cliArgs,
      apiKeyEnv: input.apiKeyEnv !== undefined ? input.apiKeyEnv || undefined : current.apiKeyEnv,
      effort: input.effort !== undefined ? input.effort : current.effort,
    }

    const stmt = this.db.prepare(`
      UPDATE provider_connections
      SET name = ?, enabled = ?, api_key = ?, endpoint = ?, default_model = ?, custom_config_json = ?, updated_at = ?
      WHERE provider_id = ?
    `)

    stmt.run(
      customValues?.name ?? current.name,
      newEnabled,
      newApiKey,
      newEndpoint,
      newModel,
      JSON.stringify(newCustom),
      now,
      input.providerId,
    )

    if (input.apiKey !== undefined) this.compactSecrets()

    const updated = this.getConnection(input.providerId)
    if (!updated) {
      throw new Error(`Falha ao recuperar conexão atualizada: ${input.providerId}`)
    }
    return updated
  }

  public getSettings(): AppSettings {
    const stmt = this.db.prepare('SELECT key, value FROM app_settings')
    const rows = stmt.all() as unknown as Array<{ key: string; value: string }>
    const stored: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value)
      } catch {
        stored[row.key] = row.value
      }
    }
    return { ...DEFAULT_APP_SETTINGS, ...(stored as Partial<AppSettings>) }
  }

  public updateSettings(patch: Partial<AppSettings>): AppSettings {
    const stmt = this.db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      stmt.run(key, JSON.stringify(value))
    }
    return this.getSettings()
  }

  public getProfileStats(): ProfileStats {
    const since = new Date()
    since.setDate(since.getDate() - 364)
    const sinceIso = since.toISOString()

    const rows = this.db
      .prepare(
        `SELECT m.created_at AS createdAt, length(m.text) AS chars,
                m.thread_id AS threadId, m.role AS role, m.input_tokens AS inTok,
                m.output_tokens AS outTok, m.cached_tokens AS cachedTok,
                a.provider AS provider, a.model AS model, a.id AS agentId, a.name AS agentName
         FROM messages m
         JOIN threads th ON th.id = m.thread_id
         JOIN agents a ON a.id = th.agent_id
         WHERE m.created_at >= ?
         ORDER BY m.created_at ASC`,
      )
      .all(sinceIso) as unknown as Array<{
      createdAt: string
      chars: number
      threadId: string
      role: string
      inTok: number | null
      outTok: number | null
      cachedTok: number | null
      provider: string
      model: string
      agentId: string
      agentName: string
    }>

    const tokensOf = tokensFromChars
    const byDay = new Map<string, { messages: number; tokens: number }>()
    const byProvider = new Map<string, number>()
    const byModel = new Map<string, number>()
    const byAgent = new Map<string, { name: string; tokens: number; messages: number }>()
    const byWeekday = new Map<number, number>()
    let totalTokens = 0
    let cost = 0

    // Turnos com uso informado pela CLI valem o número real (entrada + saída); a mensagem do usuário
    // que o originou já está dentro da entrada, então não conta de novo. O resto segue estimado.
    const tok = rows.map((r) => tokensOf(r.chars))
    const billable = rows.map((r) => tokensOf(r.chars))
    const lastUser = new Map<string, number>()
    let measuredTokens = 0
    rows.forEach((r, i) => {
      if (r.role === 'user') lastUser.set(r.threadId, i)
      else if (r.role === 'assistant' && r.inTok !== null) {
        const cached = r.cachedTok ?? 0
        tok[i] = r.inTok + (r.outTok ?? 0)
        billable[i] = r.inTok - cached + cached * 0.1 + (r.outTok ?? 0)
        measuredTokens += tok[i]
        const u = lastUser.get(r.threadId)
        if (u !== undefined) {
          tok[u] = 0
          billable[u] = 0
          lastUser.delete(r.threadId)
        }
      }
    })

    for (const [i, r] of rows.entries()) {
      const day = r.createdAt.slice(0, 10)
      const tokens = tok[i]
      totalTokens += tokens
      cost += (billable[i] / 1_000_000) * costPer1M(r.model)
      const d = byDay.get(day) ?? { messages: 0, tokens: 0 }
      d.messages += 1
      d.tokens += tokens
      byDay.set(day, d)
      byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1)
      byModel.set(r.model, (byModel.get(r.model) ?? 0) + tokens)
      const ag = byAgent.get(r.agentId) ?? { name: r.agentName, tokens: 0, messages: 0 }
      ag.tokens += tokens
      ag.messages += 1
      byAgent.set(r.agentId, ag)
      const wd = new Date(`${day}T12:00:00`).getDay()
      byWeekday.set(wd, (byWeekday.get(wd) ?? 0) + 1)
    }

    // Série diária completa (inclui dias zerados para o heatmap)
    const daily: ProfileStats['daily'] = []
    for (let i = 364; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const v = byDay.get(key) ?? { messages: 0, tokens: 0 }
      daily.push({ date: key, messages: v.messages, tokens: v.tokens })
    }

    const record = daily.reduce<{ date: string; tokens: number } | null>(
      (acc, d) => (d.tokens > (acc?.tokens ?? 0) ? { date: d.date, tokens: d.tokens } : acc),
      null,
    )

    const activeSet = new Set(daily.filter((d) => d.messages > 0).map((d) => d.date))
    const dayKey = (offset: number) => {
      const d = new Date()
      d.setDate(d.getDate() - offset)
      return d.toISOString().slice(0, 10)
    }
    let currentStreak = 0
    // Sequência atual: hoje ou ontem como último dia ativo
    let cursor = activeSet.has(dayKey(0)) ? 0 : 1
    while (activeSet.has(dayKey(cursor))) {
      currentStreak += 1
      cursor += 1
    }
    let longest = 0
    let longestEnd: string | null = null
    let run = 0
    for (const d of daily) {
      run = d.messages > 0 ? run + 1 : 0
      if (run > longest) {
        longest = run
        longestEnd = d.date
      }
    }

    const totalMsgs = rows.length
    const top = <K>(map: Map<K, number>) =>
      [...map.entries()].sort((a, b) => b[1] - a[1])[0] as [K, number] | undefined
    const provTop = top(byProvider)
    const providerNames: Record<string, string> = {
      codex: 'Codex CLI',
      claude: 'Claude Code',
      grok: 'Grok',
      gemini: 'Gemini',
      muse: 'Muse Code',
      antigravity: 'Antigravity',
      opencode: 'OpenCode',
      copilot: 'Copilot',
      pi: 'Pi',
      kimi: 'Kimi Code',
    }
    const weekdayNames = [
      'domingo',
      'segunda-feira',
      'terça-feira',
      'quarta-feira',
      'quinta-feira',
      'sexta-feira',
      'sábado',
    ]
    const wdTop = top(byWeekday)
    const modelSorted = [...byModel.entries()]
      .map(([model, tokens]) => ({
        model,
        tokens,
        percent: totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)

    return {
      totalTokens,
      measuredTokens,
      totalMessages: totalMsgs,
      recordDay: record && record.tokens > 0 ? record : null,
      currentStreakDays: currentStreak,
      longestStreak: longest > 0 && longestEnd ? { days: longest, endDate: longestEnd } : null,
      activeDaysLastYear: activeSet.size,
      daily,
      topProvider: provTop
        ? {
            provider: provTop[0],
            name: providerNames[provTop[0]] ?? provTop[0],
            percent: totalMsgs > 0 ? Math.round((provTop[1] / totalMsgs) * 100) : 0,
          }
        : null,
      topModel: modelSorted[0]
        ? { model: modelSorted[0].model, percent: modelSorted[0].percent }
        : null,
      topWeekday: wdTop ? weekdayNames[wdTop[0]] : null,
      estimatedCostUsd: Math.round(cost * 10000) / 10000,
      topAgents: [...byAgent.entries()]
        .map(([agentId, v]) => ({ agentId, name: v.name, tokens: v.tokens, messages: v.messages }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 6),
      modelUsage: modelSorted.slice(0, 8),
    }
  }

  public listProjects(): Project[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        name,
        description,
        workspace_path AS workspacePath,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM projects
      ORDER BY created_at ASC
    `)
    const rows = stmt.all() as unknown as Array<{
      id: string
      name: string
      description: string | null
      workspacePath: string | null
      createdAt: string
      updatedAt: string
    }>
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      workspacePath: r.workspacePath ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
  }

  public getProject(id: string): Project | null {
    return this.listProjects().find((proj) => proj.id === id) ?? null
  }

  public createProject(input: CreateProjectInput): Project {
    const name = input.name?.trim()
    if (!name) throw new Error('O nome do projeto é obrigatório')
    const now = new Date().toISOString()
    const project: Project = {
      id: randomUUID(),
      name,
      description: input.description?.trim() || undefined,
      workspacePath: input.workspacePath?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
    if (project.workspacePath && input.createFolder !== false) {
      fs.mkdirSync(project.workspacePath, { recursive: true })
    }
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.description ?? null,
        project.workspacePath ?? null,
        now,
        now,
      )
    return project
  }

  public updateProject(input: UpdateProjectInput): Project {
    const current = this.getProject(input.id)
    if (!current) throw new Error(`Projeto "${input.id}" não encontrado`)
    const now = new Date().toISOString()
    const name = input.name?.trim() || current.name
    const description =
      input.description !== undefined ? input.description?.trim() || undefined : current.description
    const workspacePath =
      input.workspacePath !== undefined
        ? input.workspacePath?.trim() || undefined
        : current.workspacePath
    this.db
      .prepare(
        'UPDATE projects SET name = ?, description = ?, workspace_path = ?, updated_at = ? WHERE id = ?',
      )
      .run(name, description ?? null, workspacePath ?? null, now, input.id)
    const updated = this.getProject(input.id)
    if (!updated) throw new Error(`Falha ao recuperar projeto atualizado: ${input.id}`)
    return updated
  }

  public deleteProject(id: string): boolean {
    if (!this.getProject(id)) return false
    // Robôs do projeto ficam sem projeto (não são apagados)
    this.db.prepare('UPDATE agents SET project_id = NULL WHERE project_id = ?').run(id)
    this.db.prepare('UPDATE threads SET project_id = NULL WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM brain_proposals WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM brain_pages WHERE project_id = ?').run(id)
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  public listAgents(): Agent[] {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        name, 
        role,
        description,
        project_id AS projectId,
        provider,
        account_id AS accountId,
        model, 
        effort,
        instructions, 
        runtime,
        workspace_path AS workspacePath, 
        avatar, 
        COALESCE(autonomy_level, 'autonomous') AS autonomyLevel,
        context_mode AS contextMode,
        browser_access AS browserAccess,
        local_scripts AS localScripts,
        starts_new_chats AS startsNewChats,
        show_plan AS showPlanBeforeLongTasks,
        steer_mode AS steerMode,
        computer_use AS computerUse,
        handoff_agent_id AS handoffAgentId,
        system_role AS systemRole,
        created_at AS createdAt, 
        updated_at AS updatedAt 
      FROM agents 
      ORDER BY created_at DESC
    `)
    return (stmt.all() as unknown as Agent[]).map(normalizeAgent)
  }

  public getAgent(id: string): Agent | null {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        name, 
        role,
        description,
        project_id AS projectId,
        provider,
        account_id AS accountId,
        model, 
        effort,
        instructions, 
        runtime,
        workspace_path AS workspacePath, 
        avatar, 
        COALESCE(autonomy_level, 'autonomous') AS autonomyLevel,
        context_mode AS contextMode,
        browser_access AS browserAccess,
        local_scripts AS localScripts,
        starts_new_chats AS startsNewChats,
        show_plan AS showPlanBeforeLongTasks,
        steer_mode AS steerMode,
        computer_use AS computerUse,
        handoff_agent_id AS handoffAgentId,
        system_role AS systemRole,
        created_at AS createdAt, 
        updated_at AS updatedAt 
      FROM agents 
      WHERE id = ?
    `)
    const result = stmt.get(id) as unknown as Agent | undefined
    return result ? normalizeAgent(result) : null
  }

  public setAgentRuntime(id: string, runtime: unknown): Agent {
    const agent = this.getAgent(id)
    if (!agent || (runtime !== 'host' && runtime !== 'docker')) throw new Error('Runtime inválido.')
    if (
      runtime === 'docker' &&
      (agent.systemRole ||
        agent.role === 'orchestrator' ||
        !['codex', 'claude'].includes(agent.provider))
    )
      throw new Error('Runtime configurável apenas para colegas Codex/Claude.')
    if (this.listTasks(id).some((task) => task.status === 'running'))
      throw new Error('Espere o turno terminar antes de trocar o runtime.')
    this.db.prepare('UPDATE agents SET runtime = ? WHERE id = ?').run(runtime, id)
    this.db
      .prepare(
        'DELETE FROM provider_sessions WHERE thread_id IN (SELECT id FROM threads WHERE agent_id = ?)',
      )
      .run(id)
    return { ...agent, runtime }
  }

  public createAgent(input: CreateAgentInput): Agent {
    if (!this.getConnection(input.provider)) throw new Error('Provedor não cadastrado.')
    if (input.accountId !== undefined && !this.getProviderAccount(input.provider, input.accountId))
      throw new Error('Conta não pertence ao provedor selecionado.')
    const now = new Date().toISOString()
    const id = randomUUID()
    if (input.projectId && !this.getProject(input.projectId)) {
      throw new Error(`Projeto "${input.projectId}" não encontrado`)
    }
    checkInstructionsLength(input.instructions)

    const agent: Agent = {
      runtime: 'host',
      id,
      name: input.name,
      role: input.role === 'orchestrator' ? 'orchestrator' : 'worker',
      description: input.description || undefined,
      projectId: input.projectId || undefined,
      provider: input.provider,
      accountId: input.accountId,
      model: input.model,
      effort: input.effort,
      instructions: input.instructions || '',
      workspacePath: input.workspacePath,
      autonomyLevel: input.autonomyLevel || 'autonomous',
      contextMode: input.contextMode ?? 'padrao',
      browserAccess: input.browserAccess !== false,
      localScripts: input.localScripts,
      startsNewChats: input.startsNewChats,
      showPlanBeforeLongTasks: input.showPlanBeforeLongTasks,
      steerMode: input.steerMode,
      computerUse: input.computerUse,
      createdAt: now,
      updatedAt: now,
    }

    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, role, description, project_id, provider, account_id, model, effort, instructions, workspace_path, autonomy_level, context_mode, browser_access, local_scripts, starts_new_chats, show_plan, steer_mode, computer_use, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      agent.id,
      agent.name,
      agent.role ?? 'worker',
      agent.description ?? null,
      agent.projectId ?? null,
      agent.provider,
      agent.accountId ?? null,
      agent.model,
      agent.effort ?? null,
      agent.instructions,
      agent.workspacePath,
      agent.autonomyLevel ?? 'autonomous',
      agent.contextMode ?? 'padrao',
      agent.browserAccess === false ? 0 : 1,
      triToDb(agent.localScripts),
      triToDb(agent.startsNewChats),
      triToDb(agent.showPlanBeforeLongTasks),
      agent.steerMode ?? null,
      triToDb(agent.computerUse),
      agent.createdAt,
      agent.updatedAt,
    )

    if (input.avatar) {
      this.db.prepare('UPDATE agents SET avatar = ? WHERE id = ?').run(input.avatar, id)
      agent.avatar = input.avatar
    }

    // Cria thread inicial default para o agente
    const threadId = randomUUID()
    const threadStmt = this.db.prepare(`
      INSERT INTO threads (id, agent_id, title, created_at)
      VALUES (?, ?, ?, ?)
    `)
    threadStmt.run(threadId, agent.id, 'Conversa Inicial', now)

    this.mirror(agent.id)
    return agent
  }

  public updateAgent(input: UpdateAgentInput): Agent {
    const current = this.getAgent(input.id)
    if (!current) {
      throw new Error(`Agente com ID ${input.id} não encontrado`)
    }

    const now = new Date().toISOString()
    if (input.projectId && !this.getProject(input.projectId)) {
      throw new Error(`Projeto "${input.projectId}" não encontrado`)
    }
    if (isForeman(current)) {
      if (input.role === 'worker') throw new Error('O coordenador não vira colega.')
      if (input.accountId) throw new Error('O coordenador não tem conta própria.')
      if (input.projectId) throw new Error('O coordenador não entra numa pasta.')
      if (input.handoffAgentId) throw new Error('O coordenador não entra numa cadeia.')
      if (input.instructions !== undefined && input.instructions !== FOREMAN_INSTRUCTIONS) {
        throw new Error('O coordenador é reescrito a cada início. As instruções não mudam.')
      }
    }
    const name = input.name ?? current.name
    const role = input.role ?? current.role ?? 'worker'
    const description = input.description !== undefined ? input.description : current.description
    const projectId =
      input.projectId !== undefined ? (input.projectId ?? undefined) : current.projectId
    const provider = input.provider ?? current.provider
    if (!this.getConnection(provider)) throw new Error('Provedor não cadastrado.')
    const accountId =
      input.accountId !== undefined
        ? (input.accountId ?? undefined)
        : provider === current.provider
          ? current.accountId
          : undefined
    if (
      accountId !== undefined &&
      (typeof accountId !== 'string' || !this.getProviderAccount(provider, accountId))
    )
      throw new Error('Conta não pertence ao provedor selecionado.')
    const model = input.model ?? current.model
    const effort = input.effort !== undefined ? (input.effort ?? undefined) : current.effort
    if (input.instructions !== current.instructions) checkInstructionsLength(input.instructions)
    const instructions = input.instructions ?? current.instructions
    const workspacePath = input.workspacePath ?? current.workspacePath
    const autonomyLevel = input.autonomyLevel ?? current.autonomyLevel ?? 'autonomous'
    const contextMode = input.contextMode ?? current.contextMode ?? 'padrao'
    const browserAccess =
      input.browserAccess !== undefined ? input.browserAccess : current.browserAccess !== false
    const localScripts =
      input.localScripts !== undefined ? (input.localScripts ?? undefined) : current.localScripts
    const startsNewChats =
      input.startsNewChats !== undefined
        ? (input.startsNewChats ?? undefined)
        : current.startsNewChats
    const showPlanBeforeLongTasks =
      input.showPlanBeforeLongTasks !== undefined
        ? (input.showPlanBeforeLongTasks ?? undefined)
        : current.showPlanBeforeLongTasks
    const steerMode =
      input.steerMode !== undefined ? (input.steerMode ?? undefined) : current.steerMode
    const computerUse =
      input.computerUse !== undefined ? (input.computerUse ?? undefined) : current.computerUse
    if (
      input.handoffAgentId &&
      (input.handoffAgentId === input.id || !this.getAgent(input.handoffAgentId))
    )
      throw new Error('Robô da cadeia inválido.')
    // Robô da cadeia apagado: a cadeia some em silêncio em vez de travar a edição.
    const handoffAgentId =
      input.handoffAgentId !== undefined
        ? (input.handoffAgentId ?? undefined)
        : current.handoffAgentId && this.getAgent(current.handoffAgentId)
          ? current.handoffAgentId
          : undefined

    const stmt = this.db.prepare(`
      UPDATE agents
      SET name = ?, role = ?, description = ?, project_id = ?, provider = ?, account_id = ?, model = ?, effort = ?, instructions = ?, workspace_path = ?, autonomy_level = ?, context_mode = ?, browser_access = ?, local_scripts = ?, starts_new_chats = ?, show_plan = ?, steer_mode = ?, computer_use = ?, handoff_agent_id = ?, updated_at = ?
      WHERE id = ?
    `)

    stmt.run(
      name,
      role,
      description ?? null,
      projectId ?? null,
      provider,
      accountId ?? null,
      model,
      effort ?? null,
      instructions,
      workspacePath,
      autonomyLevel,
      contextMode,
      browserAccess ? 1 : 0,
      triToDb(localScripts),
      triToDb(startsNewChats),
      triToDb(showPlanBeforeLongTasks),
      steerMode ?? null,
      triToDb(computerUse),
      handoffAgentId ?? null,
      now,
      input.id,
    )

    if (input.avatar !== undefined) {
      this.db
        .prepare('UPDATE agents SET avatar = ? WHERE id = ?')
        .run(normalizeAvatar(input.avatar) ?? null, input.id)
    }

    const updated = this.getAgent(input.id)
    if (!updated) {
      throw new Error(`Falha ao recuperar agente atualizado: ${input.id}`)
    }
    if (
      provider !== current.provider ||
      workspacePath !== current.workspacePath ||
      accountId !== current.accountId
    ) {
      this.db
        .prepare(
          'DELETE FROM provider_sessions WHERE thread_id IN (SELECT id FROM threads WHERE agent_id = ?)',
        )
        .run(input.id)
    }

    this.mirror(input.id)
    return updated
  }

  public deleteAgent(id: string): boolean {
    if (isForeman(this.getAgent(id))) throw new Error('O coordenador não sai da equipe.')
    try {
      this.db.prepare('DELETE FROM workspace_files_fts WHERE agent_id = ?').run(id)
      this.db.prepare('DELETE FROM messages_fts WHERE agent_id = ?').run(id)
      this.db.prepare('DELETE FROM memories_fts WHERE agent_id = ?').run(id)
    } catch {
      // Ignora erro se tabelas FTS não existirem
    }
    const stmt = this.db.prepare('DELETE FROM agents WHERE id = ?')
    stmt.run(id)
    return true
  }

  public findForeman(): Agent | null {
    const row = this.db
      .prepare(
        `SELECT id FROM agents WHERE system_role = 'foreman' ORDER BY created_at ASC LIMIT 1`,
      )
      .get() as { id: string } | undefined
    return row ? this.getAgent(row.id) : null
  }

  public markForeman(id: string): void {
    if (!this.getAgent(id)) throw new Error('Agente não encontrado.')
    this.db.prepare(`UPDATE agents SET system_role = 'foreman' WHERE id = ?`).run(id)
  }

  /** Zera preferência, skill, agenda, conta e conector. Não apaga a conversa. */
  public stripPersonalState(agentId: string): void {
    this.db.prepare('DELETE FROM agent_memories WHERE agent_id = ?').run(agentId)
    try {
      this.db.prepare('DELETE FROM memories_fts WHERE agent_id = ?').run(agentId)
    } catch {
      // FTS pode não existir neste banco
    }
    this.db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(agentId)
    this.db.prepare('DELETE FROM agent_mcp WHERE agent_id = ?').run(agentId)
    this.db.prepare('DELETE FROM scheduled_tasks WHERE agent_id = ?').run(agentId)
    this.db
      .prepare(
        `UPDATE skill_proposals SET status = 'dismissed', decided_at = ? WHERE agent_id = ? AND status = 'open'`,
      )
      .run(new Date().toISOString(), agentId)
    this.db
      .prepare(
        'UPDATE agents SET account_id = NULL, project_id = NULL, handoff_agent_id = NULL WHERE id = ?',
      )
      .run(agentId)
  }

  public listThreads(agentId: string): Thread[] {
    const stmt = this.db.prepare(`
      SELECT id, agent_id AS agentId, title, project_id AS projectId, created_at AS createdAt
      FROM threads
      WHERE agent_id = ?
      ORDER BY created_at ASC
    `)
    return (stmt.all(agentId) as unknown as Thread[]).map(normalizeThread)
  }

  /**
   * Conversa para onde chegam mensagens de fora (rotinas, delegação, outros agentes): a de atividade
   * mais recente, ignorando conversas de canal. Sem nenhuma, devolve null.
   */
  public getActiveThread(agentId: string): Thread | null {
    const row = this.db
      .prepare(
        `SELECT t.id, t.agent_id AS agentId, t.title, t.project_id AS projectId, t.created_at AS createdAt FROM threads t
         WHERE t.agent_id = ? AND NOT EXISTS (SELECT 1 FROM channel_members cm WHERE cm.thread_id = t.id)
         ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id), t.created_at) DESC,
                  COALESCE((SELECT MAX(m.rowid) FROM messages m WHERE m.thread_id = t.id), 0) DESC, t.rowid DESC
         LIMIT 1`,
      )
      .get(agentId) as unknown as Thread | undefined
    return row ? normalizeThread(row) : null
  }

  public getProviderSession(
    threadId: string,
    providerId: SupportedProvider,
    scope: string,
  ): string | undefined {
    const row = this.db
      .prepare(
        'SELECT session_id FROM provider_sessions WHERE thread_id = ? AND provider_id = ? AND scope = ?',
      )
      .get(threadId, providerId, scope) as { session_id: string } | undefined
    return row && isCliSessionId(row.session_id) ? row.session_id : undefined
  }

  public saveProviderSession(
    threadId: string,
    providerId: SupportedProvider,
    scope: string,
    sessionId: string,
  ): void {
    if (!isCliSessionId(sessionId)) throw new Error('ID da sessão CLI inválido.')
    this.db
      .prepare(`INSERT INTO provider_sessions (thread_id, provider_id, scope, session_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET provider_id = excluded.provider_id, scope = excluded.scope, session_id = excluded.session_id`)
      .run(threadId, providerId, scope, sessionId)
  }

  /** Descarta a sessão nativa sem a checagem de turno em andamento (usado na compactação). */
  public clearProviderSession(threadId: string): void {
    this.db.prepare('DELETE FROM provider_sessions WHERE thread_id = ?').run(threadId)
  }

  public resetProviderSession(threadId: string): boolean {
    if (
      this.db
        .prepare("SELECT id FROM task_queue WHERE thread_id = ? AND status = 'running' LIMIT 1")
        .get(threadId)
    )
      throw new Error('Interrompa o turno antes de reiniciar a sessão CLI.')
    return Boolean(
      this.db.prepare('DELETE FROM provider_sessions WHERE thread_id = ?').run(threadId).changes,
    )
  }

  public createThread(agentId: string, title = 'Nova Conversa', projectId?: string): Thread {
    if (projectId && !this.getProject(projectId)) {
      throw new Error(`Projeto "${projectId}" não encontrado`)
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO threads (id, agent_id, title, project_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(id, agentId, title, projectId ?? null, now)
    return { id, agentId, title, projectId: projectId || undefined, createdAt: now }
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
      SELECT id, agent_id AS agentId, title, project_id AS projectId, created_at AS createdAt
      FROM threads
      WHERE id = ?
    `)
    const updated = getStmt.get(threadId) as unknown as Thread | undefined
    if (!updated) {
      throw new Error(`Thread não encontrada: ${threadId}`)
    }
    return normalizeThread(updated)
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
      SELECT id, agent_id AS agentId, title, project_id AS projectId, created_at AS createdAt
      FROM threads
      WHERE id = ?
    `)
    const result = stmt.get(threadId) as unknown as Thread | undefined
    return result ? normalizeThread(result) : null
  }

  public getAgentByThreadId(threadId: string): Agent | null {
    const stmt = this.db.prepare(`
      SELECT 
        a.id,
        a.name,
        a.role,
        a.description,
        a.project_id AS projectId,
        a.provider,
        a.account_id AS accountId,
        a.model,
        a.effort,
        a.instructions,
        a.runtime,
        a.workspace_path AS workspacePath,
        a.avatar,
        COALESCE(a.autonomy_level, 'autonomous') AS autonomyLevel,
        a.context_mode AS contextMode,
        a.browser_access AS browserAccess,
        a.local_scripts AS localScripts,
        a.starts_new_chats AS startsNewChats,
        a.show_plan AS showPlanBeforeLongTasks,
        a.steer_mode AS steerMode,
        a.computer_use AS computerUse,
        a.handoff_agent_id AS handoffAgentId,
        a.system_role AS systemRole,
        a.created_at AS createdAt, 
        a.updated_at AS updatedAt
      FROM agents a
      JOIN threads t ON t.agent_id = a.id
      WHERE t.id = ?
    `)
    const result = stmt.get(threadId) as unknown as Agent | undefined
    return result ? normalizeAgent(result) : null
  }

  public enqueueTask(
    agentId: string,
    threadId: string,
    prompt: string,
    delegationDepth = 1,
    origin?: { originThreadId?: string; originAgentId?: string },
    browserRounds = 0,
    createdAt?: string,
    computerRounds = 0,
    memoryRounds = 0,
  ): TaskQueueItem {
    const requiredRuntime =
      this.getAgent(agentId)?.runtime === 'docker' ||
      this.db
        .prepare(
          "SELECT 1 FROM task_queue WHERE thread_id = ? AND required_runtime = 'docker' LIMIT 1",
        )
        .get(threadId)
        ? 'docker'
        : null
    const id = randomUUID()
    const now = createdAt ?? new Date().toISOString()
    const item: TaskQueueItem = {
      requiredRuntime,
      id,
      agentId,
      threadId,
      originThreadId: origin?.originThreadId,
      originAgentId: origin?.originAgentId,
      browserRounds,
      computerRounds,
      memoryRounds,
      prompt,
      status: 'pending',
      error: null,
      delegationDepth,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    }

    const stmt = this.db.prepare(`
      INSERT INTO task_queue (id, agent_id, thread_id, origin_thread_id, origin_agent_id, browser_rounds, computer_rounds, memory_rounds, prompt, status, error, delegation_depth, created_at, started_at, completed_at, required_runtime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      item.id,
      item.agentId,
      item.threadId,
      item.originThreadId ?? null,
      item.originAgentId ?? null,
      item.browserRounds ?? 0,
      item.computerRounds ?? 0,
      item.memoryRounds ?? 0,
      item.prompt,
      item.status,
      item.error ?? null,
      item.delegationDepth ?? 1,
      item.createdAt,
      item.startedAt ?? null,
      item.completedAt ?? null,
      requiredRuntime,
    )
    return item
  }

  public getTask(id: string): TaskQueueItem | null {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        agent_id AS agentId, 
        thread_id AS threadId, 
        origin_thread_id AS originThreadId,
        origin_agent_id AS originAgentId,
        required_runtime AS requiredRuntime,
        browser_rounds AS browserRounds,
        computer_rounds AS computerRounds,
        memory_rounds AS memoryRounds,
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
    return result ? normalizeTask(result) : null
  }

  public getNextPendingTask(agentId: string): TaskQueueItem | null {
    const stmt = this.db.prepare(`
      SELECT 
        id, 
        agent_id AS agentId, 
        thread_id AS threadId, 
        origin_thread_id AS originThreadId,
        origin_agent_id AS originAgentId,
        required_runtime AS requiredRuntime,
        browser_rounds AS browserRounds,
        computer_rounds AS computerRounds,
        memory_rounds AS memoryRounds,
        prompt, 
        status, 
        error, 
        delegation_depth AS delegationDepth, 
        created_at AS createdAt, 
        started_at AS startedAt, 
        completed_at AS completedAt
      FROM task_queue
      WHERE agent_id = ? AND status = 'pending'
      ORDER BY created_at ASC, rowid ASC
      LIMIT 1
    `)
    const rawResult = stmt.get(agentId) as unknown as TaskQueueItem | undefined
    const result = rawResult ? normalizeTask(rawResult) : undefined
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
        origin_thread_id AS originThreadId,
        origin_agent_id AS originAgentId,
        required_runtime AS requiredRuntime,
        browser_rounds AS browserRounds,
        computer_rounds AS computerRounds,
        memory_rounds AS memoryRounds,
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
    return (stmt.all(agentId) as unknown as TaskQueueItem[]).map(normalizeTask)
  }

  // --- Skills por agente ---

  public listAgentSkills(agentId: string): string[] {
    return (
      this.db
        .prepare('SELECT slug FROM agent_skills WHERE agent_id = ? ORDER BY slug')
        .all(agentId) as {
        slug: string
      }[]
    ).map((r) => r.slug)
  }

  public setAgentSkills(agentId: string, slugs: string[]): string[] {
    const agent = this.getAgent(agentId)
    if (!agent) throw new Error('Agente não encontrado.')
    if (isForeman(agent) && slugs.length > 0) throw new Error('O coordenador não tem skill.')
    this.db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(agentId)
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO agent_skills (agent_id, slug) VALUES (?, ?)',
    )
    for (const slug of slugs) insert.run(agentId, slug)
    return this.listAgentSkills(agentId)
  }

  public removeSkillAssignments(slug: string): void {
    this.db.prepare('DELETE FROM agent_skills WHERE slug = ?').run(slug)
  }

  // --- Servidores MCP (segredos criptografados no cofre do sistema) ---

  private mcpSecrets(raw: string | null): { env: Record<string, string>; bearer?: string } {
    if (!raw) return { env: {} }
    return JSON.parse(decryptApiKey(raw, this.secretStorage))
  }

  private mcpInfo(row: {
    id: string
    name: string
    transport: string
    command: string | null
    args: string
    url: string | null
    secrets: string | null
  }): McpServerInfo {
    const secrets = this.mcpSecrets(row.secrets)
    return {
      id: row.id,
      name: row.name,
      transport: row.transport === 'http' ? 'http' : 'stdio',
      command: row.command ?? undefined,
      args: JSON.parse(row.args) as string[],
      url: row.url ?? undefined,
      envKeys: Object.keys(secrets.env),
      hasBearer: Boolean(secrets.bearer),
    }
  }

  public listMcpServers(): McpServerInfo[] {
    return (
      this.db.prepare('SELECT * FROM mcp_servers ORDER BY name').all() as unknown as Parameters<
        OrchbotDatabase['mcpInfo']
      >[0][]
    ).map((r) => this.mcpInfo(r))
  }

  public saveMcpServer(input: SaveMcpServerInput): McpServerInfo {
    const name = input.name?.trim()
    if (!name || !/^[A-Za-z0-9_-]{1,40}$/.test(name))
      throw new Error('Nome inválido: use letras, números, "-" ou "_" (até 40).')
    const args = (input.args ?? []).map(String)
    if (args.length > 50 || args.some((a) => a.length > 500))
      throw new Error('Argumentos demais ou longos demais.')
    if (input.transport === 'stdio' && !input.command?.trim())
      throw new Error('Informe o comando do servidor.')
    if (input.transport === 'http' && !/^https?:\/\//i.test(input.url ?? ''))
      throw new Error('A URL precisa começar com http:// ou https://.')
    if (input.transport !== 'stdio' && input.transport !== 'http')
      throw new Error('Transporte inválido.')

    const existingRow = input.id
      ? (this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(input.id) as
          | Parameters<OrchbotDatabase['mcpInfo']>[0]
          | undefined)
      : undefined
    if (input.id && !existingRow) throw new Error('Servidor MCP não encontrado.')
    const old = existingRow
      ? this.mcpSecrets(existingRow.secrets)
      : { env: {} as Record<string, string>, bearer: undefined }

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(input.env ?? {})) {
      if (!isSafeEnvKey(key)) throw new Error(`Variável "${key}" não permitida.`)
      const v = value === '' ? old.env[key] : value
      if (v === undefined || v === '') throw new Error(`Informe o valor de "${key}".`)
      env[key] = v
    }
    const bearer =
      input.bearerToken === undefined
        ? old.bearer
        : input.bearerToken === null || input.bearerToken === ''
          ? undefined
          : input.bearerToken
    const hasSecrets = Object.keys(env).length > 0 || Boolean(bearer)
    const secrets = hasSecrets
      ? encryptApiKey(JSON.stringify({ env, bearer }), this.secretStorage)
      : null

    const id = input.id ?? randomUUID()
    const dup = this.db
      .prepare('SELECT id FROM mcp_servers WHERE name = ? AND id != ?')
      .get(name, id)
    if (dup) throw new Error('Já existe um servidor MCP com esse nome.')
    if (existingRow) {
      this.db
        .prepare(
          'UPDATE mcp_servers SET name = ?, transport = ?, command = ?, args = ?, url = ?, secrets = ? WHERE id = ?',
        )
        .run(
          name,
          input.transport,
          input.command?.trim() ?? null,
          JSON.stringify(args),
          input.url?.trim() ?? null,
          secrets,
          id,
        )
    } else {
      this.db
        .prepare(
          'INSERT INTO mcp_servers (id, name, transport, command, args, url, secrets, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          name,
          input.transport,
          input.command?.trim() ?? null,
          JSON.stringify(args),
          input.url?.trim() ?? null,
          secrets,
          new Date().toISOString(),
        )
    }
    return this.listMcpServers().find((s) => s.id === id) as McpServerInfo
  }

  public removeMcpServer(id: string): boolean {
    return this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id).changes > 0
  }

  public listAgentMcp(agentId: string): string[] {
    return (
      this.db.prepare('SELECT server_id AS id FROM agent_mcp WHERE agent_id = ?').all(agentId) as {
        id: string
      }[]
    ).map((r) => r.id)
  }

  public setAgentMcp(agentId: string, serverIds: string[]): string[] {
    const agent = this.getAgent(agentId)
    if (!agent) throw new Error('Agente não encontrado.')
    if (isForeman(agent) && serverIds.length > 0) {
      throw new Error('O coordenador não tem conector próprio.')
    }
    this.requireMcpIdle(agentId)
    const known = new Set(this.listMcpServers().map((s) => s.id))
    const saved = new Map(this.getAgentMcpToolPolicies(agentId).map((p) => [p.serverId, p.policy]))
    this.transaction(() => {
      this.db.prepare('DELETE FROM agent_mcp WHERE agent_id = ?').run(agentId)
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO agent_mcp (agent_id, server_id, tool_policy) VALUES (?, ?, ?)',
      )
      for (const id of serverIds) {
        const policy = saved.get(id)
        if (known.has(id))
          insert.run(
            agentId,
            id,
            policy && hasMcpRestriction(policy) ? JSON.stringify(policy) : null,
          )
      }
    })
    return this.listAgentMcp(agentId)
  }

  private requireMcpIdle(agentId: string): void {
    if (
      this.db
        .prepare("SELECT 1 FROM task_queue WHERE agent_id = ? AND status = 'running'")
        .get(agentId)
    )
      throw new Error('Pare o turno em andamento antes de alterar as permissões MCP.')
  }

  public getAgentMcpToolPolicies(agentId: string): AgentMcpToolPolicy[] {
    const rows = this.db
      .prepare(
        'SELECT server_id AS serverId, tool_policy AS policy FROM agent_mcp WHERE agent_id = ?',
      )
      .all(agentId) as { serverId: string; policy: string | null }[]
    return rows.map((r) => ({
      serverId: r.serverId,
      policy: r.policy === null ? { deny: [] } : parseMcpToolPolicy(JSON.parse(r.policy)),
    }))
  }

  public setAgentMcpToolPolicy(
    agentId: string,
    serverId: string,
    raw: unknown,
  ): AgentMcpToolPolicy[] {
    const agent = this.getAgent(agentId)
    if (!agent || !this.listAgentMcp(agentId).includes(serverId))
      throw new Error('Servidor MCP não vinculado ao agente.')
    this.requireMcpIdle(agentId)
    const policy = parseMcpToolPolicy(raw)
    assertMcpToolSupport(agent.provider, policy)
    this.db
      .prepare('UPDATE agent_mcp SET tool_policy = ? WHERE agent_id = ? AND server_id = ?')
      .run(hasMcpRestriction(policy) ? JSON.stringify(policy) : null, agentId, serverId)
    return this.getAgentMcpToolPolicies(agentId)
  }

  /** Servidores do agente com segredos abertos, para montar a linha de comando do CLI. */
  public getAgentMcpLaunch(agentId: string): McpLaunchServer[] {
    const rows = this.db
      .prepare(
        'SELECT s.*, a.tool_policy FROM mcp_servers s JOIN agent_mcp a ON a.server_id = s.id WHERE a.agent_id = ? ORDER BY s.name',
      )
      .all(agentId) as unknown as (Parameters<OrchbotDatabase['mcpInfo']>[0] & {
      secrets: string | null
      tool_policy: string | null
    })[]
    return rows.map((r) => {
      const secrets = this.mcpSecrets(r.secrets)
      return {
        name: r.name,
        transport: r.transport === 'http' ? 'http' : 'stdio',
        command: r.command ?? undefined,
        args: JSON.parse(r.args) as string[],
        url: r.url ?? undefined,
        env: secrets.env,
        bearerToken: secrets.bearer,
        ...(r.tool_policy === null
          ? {}
          : { toolPolicy: parseMcpToolPolicy(JSON.parse(r.tool_policy)) }),
      }
    })
  }

  // --- Conversa direta entre agentes ---

  public recordDirectMessage(
    messageId: string,
    fromAgentId: string,
    fromThreadId: string,
    toAgentId: string,
    toThreadId: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO agent_dm (message_id, from_agent_id, from_thread_id, to_agent_id, to_thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(messageId, fromAgentId, fromThreadId, toAgentId, toThreadId, new Date().toISOString())
  }

  /** Mensagem direta recebida por `toAgentId`, achada pelo id (ou prefixo único). */
  public findDirectMessage(
    toAgentId: string,
    idOrPrefix: string,
  ): {
    messageId: string
    fromAgentId: string
    fromThreadId: string
    text: string
  } | null {
    const rows = this.db
      .prepare(
        `SELECT d.message_id AS messageId, d.from_agent_id AS fromAgentId, d.from_thread_id AS fromThreadId, m.text AS text
         FROM agent_dm d JOIN messages m ON m.id = d.message_id
         WHERE d.to_agent_id = ? AND d.message_id LIKE ?`,
      )
      .all(toAgentId, `${idOrPrefix.replace(/[%_]/g, '')}%`) as {
      messageId: string
      fromAgentId: string
      fromThreadId: string
      text: string
    }[]
    return rows.length === 1 ? rows[0] : null
  }

  public addReaction(messageId: string, agentId: string, emoji: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO message_reactions (message_id, agent_id, emoji, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(messageId, agentId, emoji, new Date().toISOString())
  }

  public listReactions(messageIds: string[]): AgentReaction[] {
    if (messageIds.length === 0) return []
    return this.db
      .prepare(
        `SELECT message_id AS messageId, agent_id AS agentId, emoji FROM message_reactions WHERE message_id IN (${messageIds.map(() => '?').join(',')})`,
      )
      .all(...messageIds) as unknown as AgentReaction[]
  }

  public listOpenTasksForThread(threadId: string): TaskQueueItem[] {
    const ids = this.db
      .prepare("SELECT id FROM task_queue WHERE thread_id = ? AND status IN ('pending','running')")
      .all(threadId) as { id: string }[]
    return ids.map((r) => this.getTask(r.id)).filter((t): t is TaskQueueItem => t !== null)
  }

  // --- Canais ---

  private channelFromRow(row: {
    id: string
    title: string
    goal: string
    ownerAgentId: string | null
    status: string
    archived: number
    projectId: string | null
    createdAt: string
    updatedAt: string
  }): Channel {
    const members = this.db
      .prepare(
        'SELECT agent_id AS agentId, thread_id AS threadId FROM channel_members WHERE channel_id = ? ORDER BY rowid',
      )
      .all(row.id) as unknown as ChannelMember[]
    return {
      ...row,
      status: row.status === 'stopped' ? 'stopped' : 'active',
      archived: row.archived === 1,
      projectId: row.projectId ?? undefined,
      members,
    }
  }

  private static CHANNEL_SELECT =
    `SELECT id, title, goal, owner_agent_id AS ownerAgentId, status, archived,
    project_id AS projectId, created_at AS createdAt, updated_at AS updatedAt FROM channels`

  public createChannel(input: CreateChannelInput): Channel {
    const title = input.title?.trim()
    if (!title) throw new Error('O canal precisa de um título.')
    const owner = this.getAgent(input.ownerAgentId)
    if (!owner) throw new Error('Dono da tarefa não encontrado.')
    const memberIds = [...new Set([owner.id, ...(input.memberIds ?? [])])]
    const agents = memberIds.map((id) => this.getAgent(id))
    if (agents.some((a) => !a)) throw new Error('Participante não encontrado.')
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO channels (id, title, goal, owner_agent_id, status, archived, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
      )
      .run(
        id,
        title.slice(0, 120),
        (input.goal ?? '').trim().slice(0, 2000),
        owner.id,
        'active',
        owner.projectId ?? null,
        now,
        now,
      )
    for (const agent of agents as Agent[]) {
      const threadId = randomUUID()
      this.db
        .prepare('INSERT INTO threads (id, agent_id, title, created_at) VALUES (?, ?, ?, ?)')
        .run(threadId, agent.id, `# ${title.slice(0, 80)}`, now)
      this.db
        .prepare('INSERT INTO channel_members (channel_id, agent_id, thread_id) VALUES (?, ?, ?)')
        .run(id, agent.id, threadId)
    }
    this.addChannelMessage(id, null, `Canal criado. Dono da tarefa: ${owner.name}.`, 'system')
    return this.getChannel(id) as Channel
  }

  public getChannel(id: string): Channel | null {
    const row = this.db.prepare(`${OrchbotDatabase.CHANNEL_SELECT} WHERE id = ?`).get(id) as
      | Parameters<OrchbotDatabase['channelFromRow']>[0]
      | undefined
    return row ? this.channelFromRow(row) : null
  }

  public listChannels(includeArchived = false): Channel[] {
    const rows = this.db
      .prepare(
        `${OrchbotDatabase.CHANNEL_SELECT} WHERE (? = 1 OR archived = 0) ORDER BY updated_at DESC`,
      )
      .all(includeArchived ? 1 : 0) as Parameters<OrchbotDatabase['channelFromRow']>[0][]
    return rows.map((r) => this.channelFromRow(r))
  }

  public getChannelByThread(threadId: string): { channel: Channel; agentId: string } | null {
    const row = this.db
      .prepare(
        'SELECT channel_id AS channelId, agent_id AS agentId FROM channel_members WHERE thread_id = ?',
      )
      .get(threadId) as { channelId: string; agentId: string } | undefined
    const channel = row ? this.getChannel(row.channelId) : null
    return row && channel ? { channel, agentId: row.agentId } : null
  }

  public addChannelMessage(
    channelId: string,
    authorAgentId: string | null,
    text: string,
    kind: 'message' | 'system' = 'message',
  ): ChannelMessage {
    const message: ChannelMessage = {
      id: randomUUID(),
      channelId,
      authorAgentId,
      kind,
      text,
      createdAt: new Date().toISOString(),
    }
    this.db
      .prepare(
        'INSERT INTO channel_messages (id, channel_id, author_agent_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(message.id, channelId, authorAgentId, kind, text, message.createdAt)
    this.db
      .prepare('UPDATE channels SET updated_at = ? WHERE id = ?')
      .run(message.createdAt, channelId)
    return message
  }

  public listChannelMessages(channelId: string, limit = 300): ChannelMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, channel_id AS channelId, author_agent_id AS authorAgentId, kind, text, created_at AS createdAt
         FROM channel_messages WHERE channel_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(channelId, limit) as unknown as ChannelMessage[]
    return rows.reverse()
  }

  public updateChannel(
    id: string,
    patch: { status?: ChannelStatus; archived?: boolean; ownerAgentId?: string },
  ): void {
    const now = new Date().toISOString()
    if (patch.status)
      this.db
        .prepare('UPDATE channels SET status = ?, updated_at = ? WHERE id = ?')
        .run(patch.status, now, id)
    if (patch.archived !== undefined)
      this.db
        .prepare('UPDATE channels SET archived = ?, updated_at = ? WHERE id = ?')
        .run(patch.archived ? 1 : 0, now, id)
    if (patch.ownerAgentId)
      this.db
        .prepare('UPDATE channels SET owner_agent_id = ?, updated_at = ? WHERE id = ?')
        .run(patch.ownerAgentId, now, id)
  }

  /** Reatribuir para quem ainda não participa: entra no canal com uma conversa própria. */
  public ensureChannelMember(channelId: string, agentId: string): ChannelMember {
    const existing = this.db
      .prepare(
        'SELECT agent_id AS agentId, thread_id AS threadId FROM channel_members WHERE channel_id = ? AND agent_id = ?',
      )
      .get(channelId, agentId) as ChannelMember | undefined
    if (existing) return existing
    const channel = this.getChannel(channelId)
    if (!channel || !this.getAgent(agentId)) throw new Error('Canal ou agente não encontrado.')
    const threadId = randomUUID()
    this.db
      .prepare('INSERT INTO threads (id, agent_id, title, created_at) VALUES (?, ?, ?, ?)')
      .run(threadId, agentId, `# ${channel.title.slice(0, 80)}`, new Date().toISOString())
    this.db
      .prepare('INSERT INTO channel_members (channel_id, agent_id, thread_id) VALUES (?, ?, ?)')
      .run(channelId, agentId, threadId)
    return { agentId, threadId }
  }

  // --- Uso real de tokens (informado pelas CLIs) ---

  /** Contadores acumulados da sessão (Codex) viram o consumo só deste turno. */
  public perTurnUsage(threadId: string, sessionId: string | undefined, u: TurnUsage): TurnUsage {
    if (!u.cumulative) return u
    const prev = this.db
      .prepare(
        'SELECT session_id AS sessionId, input, cached, output FROM usage_cumulative WHERE thread_id = ?',
      )
      .get(threadId) as
      | { sessionId: string | null; input: number; cached: number; output: number }
      | undefined
    const same =
      prev &&
      prev.sessionId === (sessionId ?? null) &&
      prev.input <= u.inputTokens &&
      prev.output <= u.outputTokens
    const base = same ? prev : { input: 0, cached: 0, output: 0 }
    this.db
      .prepare(
        `INSERT INTO usage_cumulative (thread_id, session_id, input, cached, output) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET session_id = excluded.session_id, input = excluded.input, cached = excluded.cached, output = excluded.output`,
      )
      .run(threadId, sessionId ?? null, u.inputTokens, u.cachedTokens ?? 0, u.outputTokens)
    return {
      ...u,
      cumulative: false,
      inputTokens: u.inputTokens - base.input,
      cachedTokens: (u.cachedTokens ?? 0) - base.cached,
      outputTokens: u.outputTokens - base.output,
    }
  }

  /** `sessionId`: sessão nativa que a medição de contexto descreve (só vale enquanto ela continuar). */
  public setMessageUsage(messageId: string, u: TurnUsage, sessionId?: string): void {
    this.db
      .prepare(
        'UPDATE messages SET input_tokens = ?, output_tokens = ?, cached_tokens = ?, context_tokens = ?, context_window = ?, context_session_id = ? WHERE id = ?',
      )
      .run(
        u.inputTokens,
        u.outputTokens,
        u.cachedTokens ?? 0,
        u.contextTokens ?? null,
        u.contextWindow ?? null,
        sessionId ?? null,
        messageId,
      )
  }

  /** Sessão nativa atual da conversa (uma por conversa; trocar de provedor/conta a substitui). */
  public getThreadSession(
    threadId: string,
  ): { providerId: string; scope: string; sessionId: string } | undefined {
    return this.db
      .prepare(
        'SELECT provider_id AS providerId, scope, session_id AS sessionId FROM provider_sessions WHERE thread_id = ?',
      )
      .get(threadId) as { providerId: string; scope: string; sessionId: string } | undefined
  }

  /** Último turno da conversa com contexto medido pela CLI. */
  public lastMeasuredContext(threadId: string): {
    messageId: string
    createdAt: string
    contextTokens: number
    contextWindow?: number
    sessionId?: string
  } | null {
    const row = this.db
      .prepare(
        `SELECT id AS messageId, created_at AS createdAt, context_tokens AS contextTokens, context_window AS contextWindow,
                context_session_id AS sessionId
         FROM messages WHERE thread_id = ? AND role = 'assistant' AND context_tokens IS NOT NULL
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(threadId) as
      | {
          messageId: string
          createdAt: string
          contextTokens: number
          contextWindow: number | null
          sessionId: string | null
        }
      | undefined
    return row
      ? {
          ...row,
          contextWindow: row.contextWindow ?? undefined,
          sessionId: row.sessionId ?? undefined,
        }
      : null
  }

  // --- Memórias do agente (locais) ---

  private mirror(agentId: string): void {
    const agent = this.getAgent(agentId)
    if (agent && agent.runtime !== 'docker') mirrorAgent(agent, this.listMemories(agentId))
  }

  public addMemory(
    agentId: string,
    text: string,
    kind: MemoryKind = 'preference',
    touchedAt?: string,
  ): AgentMemory {
    if (isForeman(this.getAgent(agentId))) {
      throw new Error('O coordenador não guarda preferência pessoal.')
    }
    const now = touchedAt ?? new Date().toISOString()
    const memory: AgentMemory = {
      id: randomUUID(),
      agentId,
      text: text.trim(),
      kind: kind === 'task' ? 'task' : 'preference',
      createdAt: now,
      touchedAt: now,
    }
    const dup = this.db
      .prepare(
        `SELECT ${OrchbotDatabase.MEMORY_COLS} FROM agent_memories WHERE agent_id = ? AND text = ?`,
      )
      .get(agentId, memory.text) as AgentMemory | undefined
    if (dup) return OrchbotDatabase.normalizeMemory(dup)
    this.db
      .prepare(
        'INSERT INTO agent_memories (id, agent_id, text, kind, created_at, touched_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(memory.id, agentId, memory.text, memory.kind, memory.createdAt, memory.touchedAt)
    this.mirror(agentId)
    return memory
  }

  private static readonly MEMORY_COLS =
    'id, agent_id AS agentId, text, kind, created_at AS createdAt, touched_at AS touchedAt'

  private static normalizeMemory(row: AgentMemory): AgentMemory {
    return {
      ...row,
      kind: row.kind === 'task' ? 'task' : 'preference',
      touchedAt: row.touchedAt || row.createdAt,
    }
  }

  public listMemories(agentId: string, limit = 200): AgentMemory[] {
    return (
      this.db
        .prepare(
          `SELECT ${OrchbotDatabase.MEMORY_COLS} FROM agent_memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(agentId, limit) as unknown as AgentMemory[]
    ).map(OrchbotDatabase.normalizeMemory)
  }

  /** Troca o texto de uma memória (id completo ou prefixo único) e renova o prazo na busca. */
  public updateMemory(agentId: string, idOrPrefix: string, text: string): boolean {
    const clean = text.trim()
    if (!clean) return false
    const ids = this.db
      .prepare('SELECT id FROM agent_memories WHERE agent_id = ? AND id LIKE ?')
      .all(agentId, `${idOrPrefix.replace(/[%_]/g, '')}%`) as { id: string }[]
    if (ids.length !== 1) return false
    this.db
      .prepare('UPDATE agent_memories SET text = ?, touched_at = ? WHERE id = ?')
      .run(clean, new Date().toISOString(), ids[0].id)
    this.mirror(agentId)
    return true
  }

  /** Aceita o id completo ou um prefixo único (os agentes veem ids curtos). */
  public deleteMemory(agentId: string, idOrPrefix: string): boolean {
    const ids = this.db
      .prepare('SELECT id FROM agent_memories WHERE agent_id = ? AND id LIKE ?')
      .all(agentId, `${idOrPrefix.replace(/[%_]/g, '')}%`) as { id: string }[]
    if (ids.length !== 1) return false
    this.db.prepare('DELETE FROM agent_memories WHERE id = ?').run(ids[0].id)
    this.mirror(agentId)
    return true
  }

  public listBrainPages(projectId: string): BrainStoredPage[] {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, slug, title, type, content, updated_at AS updatedAt
         FROM brain_pages WHERE project_id = ?
         ORDER BY CASE WHEN slug = 'company' OR type = 'company' THEN 0 ELSE 1 END, title`,
      )
      .all(projectId) as unknown as BrainStoredPage[]
  }

  public getBrainPage(projectId: string, slug: string): BrainStoredPage | null {
    const row = this.db
      .prepare(
        `SELECT id, project_id AS projectId, slug, title, type, content, updated_at AS updatedAt
         FROM brain_pages WHERE project_id = ? AND slug = ?`,
      )
      .get(projectId, slug) as BrainStoredPage | undefined
    return row ?? null
  }

  public upsertBrainPage(input: {
    projectId: string
    slug: string
    title: string
    type: string
    content: string
  }): BrainStoredPage {
    const now = new Date().toISOString()
    const existing = this.getBrainPage(input.projectId, input.slug)
    if (existing) {
      this.db
        .prepare(
          'UPDATE brain_pages SET title = ?, type = ?, content = ?, updated_at = ? WHERE id = ?',
        )
        .run(input.title, input.type, input.content, now, existing.id)
    } else {
      this.db
        .prepare(
          `INSERT INTO brain_pages (id, project_id, slug, title, type, content, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), input.projectId, input.slug, input.title, input.type, input.content, now)
    }
    const saved = this.getBrainPage(input.projectId, input.slug)
    if (!saved) throw new Error('Falha ao gravar a página do cérebro.')
    return saved
  }

  public deleteBrainPage(projectId: string, slug: string): boolean {
    const result = this.db
      .prepare('DELETE FROM brain_pages WHERE project_id = ? AND slug = ?')
      .run(projectId, slug)
    return Number(result.changes) > 0
  }

  public insertBrainProposal(input: {
    projectId: string
    agentId: string
    slug: string
    title: string
    type: string
    content: string
    reason: string
    source: string
  }): BrainStoredProposal {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO brain_proposals (
           id, project_id, agent_id, slug, title, type, content, reason, source, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        input.projectId,
        input.agentId,
        input.slug,
        input.title,
        input.type,
        input.content,
        input.reason,
        input.source,
        now,
      )
    const saved = this.findBrainProposal(id, input.projectId)
    if (!saved) throw new Error('Falha ao gravar a proposta do cérebro.')
    return saved
  }

  public listBrainProposals(projectId: string, status?: string): BrainStoredProposal[] {
    const sql = status
      ? `SELECT ${BRAIN_PROPOSAL_COLUMNS} FROM brain_proposals
         WHERE project_id = ? AND status = ? ORDER BY created_at DESC`
      : `SELECT ${BRAIN_PROPOSAL_COLUMNS} FROM brain_proposals
         WHERE project_id = ? ORDER BY created_at DESC`
    const stmt = this.db.prepare(sql)
    return (status
      ? stmt.all(projectId, status)
      : stmt.all(projectId)) as unknown as BrainStoredProposal[]
  }

  public countOpenBrainProposals(projectId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM brain_proposals WHERE project_id = ? AND status = 'open'`)
      .get(projectId) as { n: number }
    return Number(row?.n ?? 0)
  }

  /** Id completo ou prefixo único. Com projectId, não atravessa outro projeto. */
  public findBrainProposal(idOrPrefix: string, projectId?: string): BrainStoredProposal | null {
    const prefix = idOrPrefix.replace(/[%_]/g, '')
    if (!prefix) return null
    const rows = (projectId
      ? this.db
          .prepare(
            `SELECT ${BRAIN_PROPOSAL_COLUMNS} FROM brain_proposals
               WHERE project_id = ? AND id LIKE ?`,
          )
          .all(projectId, `${prefix}%`)
      : this.db
          .prepare(`SELECT ${BRAIN_PROPOSAL_COLUMNS} FROM brain_proposals WHERE id LIKE ?`)
          .all(`${prefix}%`)) as unknown as BrainStoredProposal[]
    return rows.length === 1 ? rows[0] : null
  }

  public setBrainProposalStatus(id: string, status: 'accepted' | 'dismissed'): BrainStoredProposal {
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE brain_proposals SET status = ?, decided_at = ? WHERE id = ?')
      .run(status, now, id)
    const saved = this.findBrainProposal(id)
    if (!saved) throw new Error('Proposta não encontrada.')
    return saved
  }

  /**
   * FTS5 e depois o decaimento: preferência dura meses, tarefa dura dias.
   * shortcut: reordena só os 40 primeiros do FTS; se a palavra for comum demais, um fato antigo pode ficar de fora.
   */
  public searchMemories(
    agentId: string,
    query: string,
    limit = 10,
    now = Date.now(),
  ): AgentMemory[] {
    const ftsQuery = sanitizeFtsQuery(query)
    if (!ftsQuery) return []
    const rows = this.db
      .prepare(
        `SELECT m.id, m.agent_id AS agentId, m.text, m.kind, m.created_at AS createdAt,
                m.touched_at AS touchedAt, memories_fts.rank AS rank
         FROM memories_fts
         JOIN agent_memories m ON m.id = memories_fts.memory_id
         WHERE memories_fts MATCH ? AND m.agent_id = ?
         ORDER BY memories_fts.rank
         LIMIT ?`,
      )
      .all(ftsQuery, agentId, Math.min(Math.max(limit, 1) * 8, 40)) as unknown as Array<
      AgentMemory & { rank: number }
    >
    return rows
      .map((row) => {
        const { rank: rawRank, ...rest } = row
        const memory = OrchbotDatabase.normalizeMemory(rest)
        const rank = Number(rawRank)
        return {
          memory,
          score:
            -(Number.isFinite(rank) ? rank : 0) *
            memoryFreshness(memory.kind, memory.touchedAt, now),
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.memory)
  }

  public createSkillProposal(input: {
    agentId: string
    slug: string
    name: string
    description: string
    body: string
  }): SkillProposal {
    if (isForeman(this.getAgent(input.agentId))) throw new Error('O coordenador não tem skill.')
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.slug))
      throw new Error('Nome de skill inválido (use minúsculas, números e "-").')
    const description = input.description.trim()
    const body = input.body.trim()
    if (!description || !body) throw new Error('A proposta precisa de descrição e instruções.')
    const open = this.listSkillProposals().find(
      (item) => item.agentId === input.agentId && item.slug === input.slug,
    )
    if (open) return open
    const proposal: SkillProposal = {
      id: randomUUID(),
      agentId: input.agentId,
      slug: input.slug,
      name: input.name.trim().slice(0, 80) || input.slug,
      description: description.slice(0, 300),
      body,
      status: 'open',
      createdAt: new Date().toISOString(),
    }
    this.db
      .prepare(
        `INSERT INTO skill_proposals (id, agent_id, slug, name, description, body, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposal.id,
        proposal.agentId,
        proposal.slug,
        proposal.name,
        proposal.description,
        proposal.body,
        proposal.status,
        proposal.createdAt,
      )
    return proposal
  }

  private static readonly SKILL_PROPOSAL_COLS =
    'id, agent_id AS agentId, slug, name, description, body, status, created_at AS createdAt, decided_at AS decidedAt'

  private static normalizeSkillProposal(row: SkillProposal): SkillProposal {
    return { ...row, decidedAt: row.decidedAt ?? undefined }
  }

  public listSkillProposals(status = 'open'): SkillProposal[] {
    return (
      this.db
        .prepare(
          `SELECT ${OrchbotDatabase.SKILL_PROPOSAL_COLS} FROM skill_proposals WHERE status = ? ORDER BY created_at`,
        )
        .all(status) as unknown as SkillProposal[]
    ).map(OrchbotDatabase.normalizeSkillProposal)
  }

  public getSkillProposal(id: string): SkillProposal | null {
    const row = this.db
      .prepare(`SELECT ${OrchbotDatabase.SKILL_PROPOSAL_COLS} FROM skill_proposals WHERE id = ?`)
      .get(id) as SkillProposal | undefined
    return row ? OrchbotDatabase.normalizeSkillProposal(row) : null
  }

  public setSkillProposalStatus(id: string, status: 'accepted' | 'dismissed'): SkillProposal {
    const current = this.getSkillProposal(id)
    if (!current) throw new Error('Proposta não encontrada.')
    if (current.status !== 'open') throw new Error('Esta proposta já foi respondida.')
    this.db
      .prepare('UPDATE skill_proposals SET status = ?, decided_at = ? WHERE id = ? AND status = ?')
      .run(status, new Date().toISOString(), id, 'open')
    return this.getSkillProposal(id) as SkillProposal
  }

  /** Mensagem (id ou prefixo) do agente com `radius` vizinhas de cada lado, na mesma conversa. */
  public readMessageContext(agentId: string, idOrPrefix: string, radius = 2): Message[] {
    const hit = this.db
      .prepare(
        `SELECT m.id, m.thread_id AS threadId FROM messages m JOIN threads t ON t.id = m.thread_id
         WHERE t.agent_id = ? AND m.id LIKE ?`,
      )
      .all(agentId, `${idOrPrefix.replace(/[%_]/g, '')}%`) as { id: string; threadId: string }[]
    if (hit.length !== 1) return []
    const all = this.listMessages(hit[0].threadId)
    const i = all.findIndex((m) => m.id === hit[0].id)
    return all.slice(Math.max(0, i - radius), i + radius + 1)
  }

  public getThreadSummary(
    threadId: string,
  ): { summary: string; coversUntil: string; updatedAt: string } | undefined {
    return this.db
      .prepare(
        'SELECT summary, covers_until AS coversUntil, updated_at AS updatedAt FROM thread_summaries WHERE thread_id = ?',
      )
      .get(threadId) as { summary: string; coversUntil: string; updatedAt: string } | undefined
  }

  public saveThreadSummary(threadId: string, summary: string, coversUntil: string): void {
    this.db
      .prepare(`INSERT INTO thread_summaries (thread_id, summary, covers_until, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET summary = excluded.summary, covers_until = excluded.covers_until, updated_at = excluded.updated_at`)
      .run(threadId, summary, coversUntil, new Date().toISOString())
  }

  // --- Aprovações ---

  public createApproval(input: {
    agentId: string
    threadId: string
    taskId?: string
    text: string
    payloadJson?: string
  }): Approval {
    const approval: Approval = {
      id: randomUUID(),
      ...input,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    this.db
      .prepare(
        'INSERT INTO approvals (id, agent_id, thread_id, task_id, text, status, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        approval.id,
        approval.agentId,
        approval.threadId,
        approval.taskId ?? null,
        approval.text,
        approval.status,
        approval.createdAt,
        approval.payloadJson ?? null,
      )
    return approval
  }

  private static readonly APPROVAL_COLS =
    'id, agent_id AS agentId, thread_id AS threadId, task_id AS taskId, text, status, note, payload_json AS payloadJson, created_at AS createdAt, decided_at AS decidedAt'

  private static normalizeApproval(row: Approval): Approval {
    return {
      ...row,
      taskId: row.taskId ?? undefined,
      note: row.note ?? undefined,
      payloadJson: row.payloadJson ?? undefined,
      decidedAt: row.decidedAt ?? undefined,
    }
  }

  public getApproval(id: string): Approval | null {
    const row = this.db
      .prepare(`SELECT ${OrchbotDatabase.APPROVAL_COLS} FROM approvals WHERE id = ?`)
      .get(id) as unknown as Approval | undefined
    return row ? OrchbotDatabase.normalizeApproval(row) : null
  }

  public listPendingApprovals(): Approval[] {
    const rows = this.db
      .prepare(
        `SELECT ${OrchbotDatabase.APPROVAL_COLS} FROM approvals WHERE status = 'pending' ORDER BY created_at`,
      )
      .all() as unknown as Approval[]
    return rows.map(OrchbotDatabase.normalizeApproval)
  }

  /** Só decide pedidos pendentes: clicar duas vezes não dispara dois turnos. */
  public decideApproval(id: string, status: 'approved' | 'declined', note?: string): Approval {
    const result = this.db
      .prepare(
        "UPDATE approvals SET status = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(status, note ?? null, new Date().toISOString(), id)
    const approval = this.getApproval(id)
    if (!approval) throw new Error('Pedido de aprovação não encontrado.')
    if (result.changes === 0) throw new Error('Este pedido já foi respondido.')
    return approval
  }

  // --- Gatilhos por webhook ---

  public acceptControl(
    requestId: string,
    agentId: string,
    prompt: string,
  ): { threadId: string; taskId: string; task: TaskQueueItem | null } {
    return this.transaction(() => {
      this.db
        .prepare('DELETE FROM control_requests WHERE accepted_at <= ?')
        .run(Date.now() - 7 * 86400000)
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([agentId, prompt]))
        .digest('hex')
      const receipt = this.db
        .prepare(
          'SELECT fingerprint, thread_id AS threadId, task_id AS taskId FROM control_requests WHERE request_id = ?',
        )
        .get(requestId) as { fingerprint: string; threadId: string; taskId: string } | undefined
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new Error('requestId já usado com outro conteúdo.')
        return { threadId: receipt.threadId, taskId: receipt.taskId, task: null }
      }
      const agent = this.getAgent(agentId)
      if (!agent || agent.systemRole) throw new Error('Colega não encontrado.')
      const thread = this.createThread(agentId, 'Controle externo')
      this.addMessage(thread.id, 'user', prompt)
      const task = this.enqueueTask(agentId, thread.id, prompt)
      this.db
        .prepare('INSERT INTO control_requests VALUES (?, ?, ?, ?, ?)')
        .run(requestId, fingerprint, thread.id, task.id, Date.now())
      return { threadId: thread.id, taskId: task.id, task }
    })
  }

  public acceptWebhook(
    triggerId: string,
    deliveryId: string | undefined,
    prompt: string,
  ): { threadId: string; task: TaskQueueItem | null } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const now = Date.now()
      if (deliveryId !== undefined) {
        this.db
          .prepare('DELETE FROM webhook_receipts WHERE accepted_at <= ?')
          .run(now - 7 * 24 * 60 * 60 * 1000)
        const receipt = this.db
          .prepare(
            'SELECT thread_id AS threadId FROM webhook_receipts WHERE trigger_id = ? AND delivery_id = ?',
          )
          .get(triggerId, deliveryId) as { threadId: string } | undefined
        if (receipt) {
          this.db.exec('COMMIT')
          return { threadId: receipt.threadId, task: null }
        }
      }
      const trigger = this.getWebhookTrigger(triggerId)
      if (!trigger) throw new Error('Gatilho não encontrado.')
      if (trigger.githubRepository && this.getAgent(trigger.agentId)?.runtime !== 'docker')
        throw new Error('GitHub requer agente Docker.')
      const thread = this.createThread(trigger.agentId, `Gatilho: ${trigger.title}`)
      this.addMessage(thread.id, 'user', prompt)
      const task = this.enqueueTask(trigger.agentId, thread.id, prompt)
      if (deliveryId !== undefined) {
        // O recibo sobrevive à exclusão da conversa para um retry não repetir efeitos externos.
        this.db
          .prepare(
            'INSERT INTO webhook_receipts (trigger_id, delivery_id, thread_id, accepted_at) VALUES (?, ?, ?, ?)',
          )
          .run(triggerId, deliveryId, thread.id, now)
      }
      this.db.exec('COMMIT')
      return { threadId: thread.id, task }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  public createWebhookTrigger(
    agentId: string,
    title: string,
    instruction: string,
    githubRepository?: string,
  ): WebhookTrigger {
    if (
      githubRepository !== undefined &&
      (typeof githubRepository !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(githubRepository))
    )
      throw new Error('Use um repositório GitHub no formato dono/repo.')
    if (githubRepository && this.getAgent(agentId)?.runtime !== 'docker')
      throw new Error('Selecione Docker para este agente antes de criar o broker GitHub.')
    if (!this.getAgent(agentId)) throw new Error('Agente não encontrado.')
    const trigger: WebhookTrigger = {
      id: randomUUID(),
      agentId,
      githubRepository: githubRepository ?? null,
      title: title.trim().slice(0, 80) || 'Webhook',
      instruction: instruction.trim(),
      token: randomBytes(24).toString('base64url'),
      createdAt: new Date().toISOString(),
    }
    this.db
      .prepare(
        'INSERT INTO webhook_triggers (id, agent_id, title, instruction, token, created_at, github_repository) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        trigger.id,
        trigger.agentId,
        trigger.title,
        trigger.instruction,
        trigger.token,
        trigger.createdAt,
        trigger.githubRepository ?? null,
      )
    return trigger
  }

  private static readonly TRIGGER_COLS =
    'id, agent_id AS agentId, title, instruction, token, created_at AS createdAt, github_repository AS githubRepository'

  public listWebhookTriggers(agentId: string): WebhookTrigger[] {
    return this.db
      .prepare(
        `SELECT ${OrchbotDatabase.TRIGGER_COLS} FROM webhook_triggers WHERE agent_id = ? ORDER BY created_at`,
      )
      .all(agentId) as unknown as WebhookTrigger[]
  }

  public getWebhookTrigger(id: string): WebhookTrigger | null {
    return (
      (this.db
        .prepare(`SELECT ${OrchbotDatabase.TRIGGER_COLS} FROM webhook_triggers WHERE id = ?`)
        .get(id) as unknown as WebhookTrigger | undefined) ?? null
    )
  }

  public deleteWebhookTrigger(id: string): boolean {
    return this.db.prepare('DELETE FROM webhook_triggers WHERE id = ?').run(id).changes > 0
  }

  public setAgentPaused(agentId: string, paused: boolean): void {
    this.db.prepare('UPDATE agents SET paused = ? WHERE id = ?').run(paused ? 1 : 0, agentId)
  }

  public listPausedAgentIds(): string[] {
    const rows = this.db.prepare('SELECT id FROM agents WHERE paused = 1').all() as { id: string }[]
    return rows.map((r) => r.id)
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
    if (isForeman(this.getAgent(input.agentId))) throw new Error('O coordenador não tem agenda.')
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

const TOKEN_COST_PER_1M_USD: Array<{ match: string; usd: number }> = [
  { match: 'gpt', usd: 5 },
  { match: 'claude', usd: 6 },
  { match: 'grok', usd: 4 },
  { match: 'gemini', usd: 1.5 },
  { match: 'kimi', usd: 2 },
]

export function costPer1M(model: string): number {
  const m = model.toLowerCase()
  return TOKEN_COST_PER_1M_USD.find((r) => m.includes(r.match))?.usd ?? 3
}
