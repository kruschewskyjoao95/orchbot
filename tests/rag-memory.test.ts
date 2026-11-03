import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { loadWorkspaceRules } from '../src/backend/rag/workspace-rules'
import { OrchbotDatabase, sanitizeFtsQuery } from '../src/backend/storage/db'
import { validateCreateAgentInput } from '../src/shared/types'

describe('Memória Contínua FTS5 & RAG do Repositório', () => {
  let db: OrchbotDatabase
  let tempDir: string

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:')
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-rag-test-'))
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('Leitura Automática de Regras do Projeto (ORCHBOT.md / AGENTS.md)', () => {
    it('deve retornar exists: false quando não houver arquivo de diretrizes', () => {
      const rules = loadWorkspaceRules(tempDir)
      expect(rules.exists).toBe(false)
    })

    it('deve carregar automaticamente o arquivo ORCHBOT.md quando presente no workspace', () => {
      const rulesPath = path.join(tempDir, 'ORCHBOT.md')
      fs.writeFileSync(
        rulesPath,
        '# Regras de Arquitetura\n- Use sempre SolidJS e SQLite.',
        'utf-8',
      )

      const rules = loadWorkspaceRules(tempDir)
      expect(rules.exists).toBe(true)
      expect(rules.filename).toBe('ORCHBOT.md')
      expect(rules.filePath).toBe(rulesPath)
      expect(rules.content).toContain('Use sempre SolidJS e SQLite.')
    })

    it('deve dar prioridade a AGENTS.md caso ORCHBOT.md não exista', () => {
      const agentsMdPath = path.join(tempDir, 'AGENTS.md')
      fs.writeFileSync(agentsMdPath, '# Diretrizes AGENTS\n- Seguir padrão Clean Code.', 'utf-8')

      const rules = loadWorkspaceRules(tempDir)
      expect(rules.exists).toBe(true)
      expect(rules.filename).toBe('AGENTS.md')
      expect(rules.content).toContain('Clean Code')
    })
  })

  describe('Busca Full-Text no SQLite (FTS5)', () => {
    it('deve higienizar termos de busca com caracteres especiais sem lançar exceções FTS5', () => {
      expect(sanitizeFtsQuery('')).toBe('')
      expect(sanitizeFtsQuery('   ')).toBe('')
      const sanitized = sanitizeFtsQuery('refatoração: "sqlite" (FTS5) - backend* & 123!')
      expect(sanitized).toContain('"refatoração"*')
      expect(sanitized).toContain('"sqlite"*')
      expect(sanitized).toContain('"FTS5"*')
    })

    it('deve indexar mensagens automaticamente via triggers e realizar busca full-text com snippets', () => {
      const agent = db.createAgent(
        validateCreateAgentInput({
          name: 'Agent RAG',
          provider: 'codex',
          model: 'gpt-4o',
          workspacePath: tempDir,
        }),
      )

      const thread = db.listThreads(agent.id)[0]

      db.addMessage(thread.id, 'user', 'Precisamos implementar o cache com Redis ou SQLite WAL.')
      db.addMessage(
        thread.id,
        'assistant',
        'Recomendo usar o SQLite com WAL local, pois garante local-first sem dependências extras.',
      )
      db.addMessage(thread.id, 'user', 'Concordo com a escolha do SQLite WAL.')

      // Busca por "SQLite WAL"
      const results = db.searchMessages('SQLite WAL', { agentId: agent.id })
      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results[0].snippet).toContain('<b>')
      expect(results[0].threadTitle).toBe('Conversa Inicial')

      // Busca por termo inexistente
      const emptyResults = db.searchMessages('Kubernetes Cluster', { agentId: agent.id })
      expect(emptyResults.length).toBe(0)
    })
  })

  describe('Indexação e Busca de Arquivos do Workspace', () => {
    it('deve indexar arquivos de código do workspace e permitir busca full-text contextual', () => {
      const agent = db.createAgent(
        validateCreateAgentInput({
          name: 'Repo Agent',
          provider: 'claude',
          model: 'claude-3-7-sonnet',
          workspacePath: tempDir,
        }),
      )

      // Cria arquivos de código no workspace
      fs.writeFileSync(
        path.join(tempDir, 'database.ts'),
        'export class DatabaseEngine { connect() { return "sqlite connected"; } }',
      )
      fs.writeFileSync(
        path.join(tempDir, 'server.ts'),
        'import { DatabaseEngine } from "./database"; const port = 3000;',
      )

      const indexedCount = db.indexWorkspaceFiles(agent.id, tempDir)
      expect(indexedCount).toBe(2)

      const searchResults = db.searchWorkspaceFiles(agent.id, 'DatabaseEngine')
      expect(searchResults.length).toBeGreaterThanOrEqual(1)
      expect(searchResults[0].fileName).toBe('database.ts')
      expect(searchResults[0].snippet).toContain('<b>')
    })
  })

  describe('Enriquecimento de Contexto RAG no QueueManager', async () => {
    it('deve injetar automaticamente regras do projeto e memória de conversas prévias no executeTurn', async () => {
      // Cria arquivo ORCHBOT.md no workspace
      fs.writeFileSync(
        path.join(tempDir, 'ORCHBOT.md'),
        'Regra mandatória: Nunca use bibliotecas pesadas de terceiros.',
      )

      let capturedInstructions: string | undefined

      const mockAdapter: ProviderAdapter = {
        id: 'codex',
        name: 'Mock Codex',
        checkAvailability: async () => ({ available: true }),
        executeTurn: (_prompt, options, callbacks) => {
          capturedInstructions = options.instructions
          setTimeout(() => {
            callbacks.onChunk('Ok', 'Ok')
            callbacks.onDone('Concluído respeitando diretrizes.')
          }, 10)
          return { interrupt: () => {} }
        },
      }

      const mockRegistry = {
        getAdapter: () => mockAdapter,
        registerActiveExecution: () => {},
        removeActiveExecution: () => {},
        interruptThread: () => true,
      }

      const queue = new QueueManager(
        db,
        mockRegistry as unknown as import('../src/backend/providers/registry').ProviderRegistry,
      )

      const agent = db.createAgent(
        validateCreateAgentInput({
          name: 'Rule Agent',
          provider: 'codex',
          model: 'gpt-4o',
          workspacePath: tempDir,
          instructions: 'Você é um assistente conciso.',
        }),
      )

      const thread = db.listThreads(agent.id)[0]

      // Mensagem prévia para simular memória contínua
      db.addMessage(
        thread.id,
        'assistant',
        'Lembrete: nossa decisão arquitetural foi manter tudo em SolidJS.',
      )

      // Enfileira nova tarefa perguntando sobre a arquitetura
      queue.enqueue(
        agent.id,
        thread.id,
        'Como devemos estruturar os novos componentes de interface?',
      )

      // Aguarda processamento do QueueManager
      await new Promise((resolve) => setTimeout(resolve, 80))

      expect(capturedInstructions).toBeDefined()
      // Verifica presença das regras do projeto
      expect(capturedInstructions).toContain('[DIRETRIZES DO PROJETO (ORCHBOT.md)]')
      expect(capturedInstructions).toContain('Nunca use bibliotecas pesadas de terceiros.')
      // Verifica presença das instruções originais do agente
      expect(capturedInstructions).toContain('[INSTRUÇÕES DO AGENTE]')
      expect(capturedInstructions).toContain('Você é um assistente conciso.')
    })
  })
})
