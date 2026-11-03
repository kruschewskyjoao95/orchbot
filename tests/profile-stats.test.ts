import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'

describe('Perfil — estatísticas deste computador', () => {
  it('calcula tokens, mensagens, sequências e destaques das mensagens locais', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-profile-'))
    const db = new OrchbotDatabase(path.join(tmp, 't.db'))
    const agent = db.createAgent({
      name: 'Product Marketer',
      provider: 'codex',
      model: 'gpt-6.1-terra',
      workspacePath: tmp,
    })
    const thread = db.listThreads(agent.id)[0]
    if (!thread) throw new Error('thread ausente')

    // Insere mensagens com datas controladas (hoje, ontem e anteontem = sequência de 3)
    const raw = (
      db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }
    ).db
    const insert = raw.prepare(
      "INSERT INTO messages (id, thread_id, role, text, created_at) VALUES (?, ?, 'user', ?, ?)",
    )
    const day = (offset: number) => {
      const d = new Date()
      d.setDate(d.getDate() - offset)
      return d.toISOString()
    }
    insert.run('m1', thread.id, 'x'.repeat(400), day(0))
    insert.run('m2', thread.id, 'y'.repeat(400), day(1))
    insert.run('m3', thread.id, 'z'.repeat(400), day(2))
    insert.run('m4', thread.id, 'w'.repeat(40), day(30))

    const stats = db.getProfileStats()
    expect(stats.totalMessages).toBeGreaterThanOrEqual(4)
    expect(stats.totalTokens).toBeGreaterThanOrEqual(310)
    expect(stats.currentStreakDays).toBe(3)
    expect(stats.longestStreak?.days).toBeGreaterThanOrEqual(3)
    expect(stats.activeDaysLastYear).toBeGreaterThanOrEqual(4)
    expect(stats.daily).toHaveLength(365)
    expect(stats.topProvider?.provider).toBe('codex')
    expect(stats.topProvider?.percent).toBe(100)
    expect(stats.topModel?.model).toBe('gpt-6.1-terra')
    expect(stats.topAgents[0]?.name).toBe('Product Marketer')
    expect(stats.estimatedCostUsd).toBeGreaterThan(0)

    db.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('banco vazio retorna estatísticas zeradas sem quebrar', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-profile-empty-'))
    const db = new OrchbotDatabase(path.join(tmp, 't.db'))
    const stats = db.getProfileStats()
    expect(stats.totalTokens).toBe(0)
    expect(stats.recordDay).toBeNull()
    expect(stats.topProvider).toBeNull()
    db.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
