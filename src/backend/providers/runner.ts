import { type ChildProcess, spawn } from 'node:child_process'
import { buildProviderEnv, parseStreamJsonLine, resolveCliCommand } from './cli-utils'
import type { ActiveExecution, ExecutionCallbacks, ExecutionOptions } from './types'

export interface StreamingRunSpec {
  cliCommand: string
  label: string
  envKeys?: string[]
  buildArgs: (prompt: string, options: ExecutionOptions) => string[]
  /** 'lines-json': tenta JSON por linha e cai para texto puro. 'plain': stdout como texto. */
  mode: 'lines-json' | 'plain'
}

/** Executa um CLI de agente em modo headless com streaming, interrupção via SIGTERM. */
export function runStreamingCli(
  spec: StreamingRunSpec,
  prompt: string,
  options: ExecutionOptions,
  callbacks: ExecutionCallbacks,
): ActiveExecution {
  const config = options.providerConfig
  const command = resolveCliCommand(spec.cliCommand, config?.cliPath)
  const args = spec.buildArgs(prompt, options)

  let isInterrupted = false
  let child: ChildProcess | null = null
  const state = { fullText: '' }
  let stderrText = ''
  let buffer = ''

  const flushPlain = (text: string) => {
    if (!text) return
    state.fullText += text
    callbacks.onChunk(text, state.fullText)
  }

  try {
    child = spawn(command, args, {
      cwd: options.workspacePath || process.cwd(),
      env: buildProviderEnv({ ...config, envKeys: config?.envKeys ?? spec.envKeys }),
    })
  } catch (err: unknown) {
    callbacks.onError(err instanceof Error ? err.message : String(err))
    return { interrupt: () => {} }
  }

  child.stdout?.on('data', (data: Buffer) => {
    if (isInterrupted) return
    const text = data.toString('utf-8')
    if (spec.mode === 'plain') {
      flushPlain(text)
      return
    }
    buffer += text
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const chunk = parseStreamJsonLine(line, state)
      if (chunk !== null) {
        if (chunk) callbacks.onChunk(chunk, state.fullText)
      } else if (!line.trim().startsWith('{')) {
        flushPlain(`${line}\n`)
      }
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    stderrText += data.toString('utf-8')
  })

  child.on('error', (err) => {
    if (!isInterrupted) callbacks.onError(`Erro ao executar ${spec.label}: ${err.message}`)
  })

  child.on('close', (code) => {
    if (isInterrupted) return
    if (buffer.trim() && spec.mode === 'lines-json') {
      const chunk = parseStreamJsonLine(buffer, state)
      if (chunk) callbacks.onChunk(chunk, state.fullText)
      buffer = ''
    }
    if (code !== 0 && !state.fullText) {
      callbacks.onError(stderrText.trim() || `Processo ${spec.label} finalizou com código ${code}.`)
    } else {
      callbacks.onDone(state.fullText.trim())
    }
  })

  return {
    interrupt: () => {
      isInterrupted = true
      if (child && !child.killed) child.kill('SIGTERM')
    },
  }
}

export function withInstructions(prompt: string, instructions?: string): string {
  return instructions ? `[Instruções do Sistema: ${instructions}]\n\n${prompt}` : prompt
}
