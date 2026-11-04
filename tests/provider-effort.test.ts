import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { CopilotAdapter } from '../src/backend/providers/copilot-adapter'
import { OpenCodeAdapter } from '../src/backend/providers/opencode-adapter'
import { PiAdapter } from '../src/backend/providers/pi-adapter'
import type { ProviderAdapter, ProviderRuntimeConfig } from '../src/backend/providers/types'

const cli = fileURLToPath(new URL('./fixtures/args-cli.mjs', import.meta.url))

async function argsFor(
  adapter: ProviderAdapter,
  model: string,
  effort: ProviderRuntimeConfig['effort'] = 'high',
): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-effort-'))
  try {
    await new Promise<void>((resolve) =>
      adapter.executeTurn(
        'oi',
        { workspacePath: dir, model, providerConfig: { cliPath: cli, effort } },
        {
          onChunk: () => {},
          onDone: () => resolve(),
          onError: () => resolve(),
          onInterrupted: () => resolve(),
        },
      ),
    )
    return JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('nível de raciocínio chega a cada CLI', () => {
  it('envia ultra ao Codex sem converter o nível escolhido', async () => {
    expect(await argsFor(new CodexAdapter(), 'gpt-6-astra', 'ultra')).toContain(
      'model_reasoning_effort="ultra"',
    )
  })
  it.each([
    ['codex', new CodexAdapter(), 'gpt-6.1-sol', ['-c', 'model_reasoning_effort="high"']],
    ['pi', new PiAdapter(), 'claude-sonnet-5-5', ['--thinking', 'high']],
    ['copilot', new CopilotAdapter(), 'auto', ['--reasoning-effort', 'high']],
    ['opencode', new OpenCodeAdapter(), 'openai/gpt-5.4-mini', ['-m', 'openai/gpt-5.4-mini#high']],
  ] as const)('%s', async (_name, adapter, model, expected) => {
    const args = await argsFor(adapter, model)
    const at = args.indexOf(expected[0])
    expect(at).toBeGreaterThanOrEqual(0)
    expect(args.slice(at, at + 2)).toEqual(expected)
  })
})
