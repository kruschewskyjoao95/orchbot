import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../src/backend/providers/claude-adapter'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { parseProviderModels } from '../src/backend/providers/model-discovery'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { modelEffortOptions } from '../src/shared/model-efforts'
import { validateCreateAgentInput } from '../src/shared/types'
const cli = fileURLToPath(new URL('./fixtures/model-cli.mjs', import.meta.url))
const catalog = [
  {
    model: 'gpt-6-astra',
    displayName: 'GPT-6 Astra',
    supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'ultra' }],
    defaultReasoningEffort: 'medium',
  },
  {
    model: 'gpt-6-luna',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }],
  },
]
describe('model discovery and per-model reasoning', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-models-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  it.each(['codex', 'claude'] as const)(
    'queries the selected %s profile and retains capabilities',
    async (provider) => {
      const rows =
        provider === 'codex'
          ? catalog
          : [
              {
                value: 'opus',
                resolvedModel: 'claude-opus-current',
                displayName: 'Current Opus',
                supportsEffort: true,
                supportedEffortLevels: ['medium', 'max'],
              },
              { value: 'haiku', supportsEffort: false },
            ]
      fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(rows))
      const adapter = provider === 'codex' ? new CodexAdapter() : new ClaudeAdapter()
      const result = await adapter.discoverModelCatalog({
        cliPath: cli,
        cliProfile: {
          envKey: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
          directory: dir,
        },
        accountAuthMode: 'cli_profile',
      })
      expect(result.source).toBe('cli')
      expect(result.models).toHaveLength(2)
      expect(result.models[0]).toMatchObject(
        provider === 'codex'
          ? { id: 'gpt-6-astra', supportedEfforts: ['medium', 'ultra'], defaultEffort: 'medium' }
          : { id: 'claude-opus-current', supportedEfforts: ['medium', 'max'] },
      )
      if (provider === 'claude') expect(result.models[1].supportedEfforts).toEqual([])
    },
  )
  it('uses only the selected Codex cache when the CLI is unavailable', async () => {
    fs.writeFileSync(
      path.join(dir, 'models_cache.json'),
      JSON.stringify({
        models: [
          {
            slug: 'profile-model',
            visibility: 'list',
            supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'ultra' }],
          },
          { slug: 'hidden', visibility: 'hide' },
        ],
      }),
    )
    const result = await new CodexAdapter().discoverModelCatalog({
      cliPath: path.join(dir, 'absent'),
      cliProfile: { envKey: 'CODEX_HOME', directory: dir },
    })
    expect(result.source).toBe('cache')
    expect(result.models).toEqual([
      {
        id: 'profile-model',
        displayName: undefined,
        supportedEfforts: ['medium', 'ultra'],
        defaultEffort: undefined,
      },
    ])
  })
  it('identifies the static fallback instead of reporting a live Claude response', async () => {
    expect(
      (await new ClaudeAdapter().discoverModelCatalog({ cliPath: path.join(dir, 'absent') }))
        .source,
    ).toBe('catalog')
  })
  it('offers exactly the efforts advertised for the selected model, in provider order', () => {
    const models = parseProviderModels(catalog)
    expect(modelEffortOptions('gpt-6-astra', models).map(([id]) => id)).toEqual([
      '',
      'medium',
      'ultra',
    ])
    expect(modelEffortOptions('gpt-6-luna', models).map(([id]) => id)).toEqual(['', 'low', 'high'])
    expect(modelEffortOptions('haiku', [{ id: 'haiku', supportedEfforts: [] }])).toEqual([
      ['', 'Padrão'],
    ])
  })
  it('does not invent effort capabilities for Claude models without metadata', () => {
    const models = parseProviderModels([{ value: 'legacy-haiku' }])
    expect(modelEffortOptions('legacy-haiku', models)).toEqual([['', 'Padrão']])
  })

  it('ignores a default effort when the model explicitly disables reasoning controls', () => {
    expect(
      parseProviderModels([
        {
          value: 'text-only',
          supportsEffort: false,
          supportedEffortLevels: ['medium'],
          defaultReasoningEffort: 'medium',
        },
      ])[0],
    ).toMatchObject({ supportedEfforts: [], defaultEffort: undefined })
  })

  it('keeps future effort names advertised by the provider, without inventing ultra for unknown models', () => {
    const catalog = parseProviderModels([
      { model: 'future', supportedEffortLevels: ['medium', 'extended'] },
    ])
    expect(modelEffortOptions('future', catalog).map(([value]) => value)).toEqual([
      '',
      'medium',
      'extended',
    ])
    expect(modelEffortOptions('manual').map(([value]) => value)).not.toContain('ultra')
  })

  it('ignores malformed metadata and invalid effort tokens', () => {
    expect(
      parseProviderModels([
        null,
        { model: 1 },
        { model: 'good', supportedEffortLevels: ['medium', '--invalid'] },
        { model: 'good' },
      ]),
    ).toEqual([
      {
        id: 'good',
        displayName: undefined,
        supportedEfforts: ['medium'],
        defaultEffort: undefined,
      },
    ])
  })
  it('preserves ultra through agent validation and connection persistence', () => {
    const db = new OrchbotDatabase(':memory:')
    try {
      const input = validateCreateAgentInput({
        name: 'Reasoner',
        provider: 'codex',
        model: 'gpt-6-astra',
        workspacePath: dir,
        effort: 'ultra',
      })
      expect(db.createAgent(input).effort).toBe('ultra')
      db.updateConnection({ providerId: 'codex', effort: 'ultra' })
      expect(db.getConnection('codex')?.effort).toBe('ultra')
    } finally {
      db.close()
    }
  })
})
