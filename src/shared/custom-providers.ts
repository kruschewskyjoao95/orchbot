import type { CreateCustomProviderInput, CustomProviderId } from './types'

export function isCustomProvider(id: string): id is CustomProviderId {
  return /^custom:[0-9a-f-]{36}$/.test(id)
}

export function normalizeProviderEndpoint(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048)
    throw new Error('Informe a URL base da API.')
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('URL base da API inválida.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use uma URL HTTP(S) sem usuário, senha, parâmetros ou fragmento. Informe a chave no campo protegido.',
    )
  }
  return url.toString().replace(/\/+$/, '')
}

export function validateCustomProviderInput(
  raw: CreateCustomProviderInput,
): CreateCustomProviderInput {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 100)
    throw new Error('Informe um nome de até 100 caracteres.')
  if (
    typeof raw.defaultModel !== 'string' ||
    !raw.defaultModel.trim() ||
    raw.defaultModel.length > 200
  )
    throw new Error('Informe o ID do modelo (até 200 caracteres).')
  if (raw.apiKey !== undefined && (typeof raw.apiKey !== 'string' || /[\r\n]/.test(raw.apiKey)))
    throw new Error('Chave de API inválida.')
  return {
    name: raw.name.trim(),
    endpoint: normalizeProviderEndpoint(raw.endpoint),
    defaultModel: raw.defaultModel.trim(),
    apiKey: raw.apiKey,
  }
}

export const CUSTOM_PROVIDER_PRESETS = {
  custom: { name: '', endpoint: '', defaultModel: '' },
  ollama: { name: 'Ollama', endpoint: 'http://localhost:11434/v1', defaultModel: '' },
  openrouter: {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
  },
}
