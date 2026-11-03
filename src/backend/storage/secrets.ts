export interface SecretStorage {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export const ENCRYPTED_KEY_PREFIX = 'safeStorage:v1:'
export const KEY_STORAGE_ERROR =
  'Cofre seguro indisponível. Configure o chaveiro do sistema para salvar ou usar chaves de API.'

export function canStoreSecrets(storage?: SecretStorage): storage is SecretStorage {
  return Boolean(
    storage?.isEncryptionAvailable() && storage.getSelectedStorageBackend() !== 'basic_text',
  )
}

export function encryptApiKey(value: string, storage?: SecretStorage): string {
  if (!canStoreSecrets(storage)) throw new Error(KEY_STORAGE_ERROR)
  return ENCRYPTED_KEY_PREFIX + storage.encryptString(value).toString('base64')
}

export function decryptApiKey(value: string, storage?: SecretStorage): string {
  if (!canStoreSecrets(storage)) throw new Error(KEY_STORAGE_ERROR)
  try {
    if (!value.startsWith(ENCRYPTED_KEY_PREFIX)) throw new Error('Invalid ciphertext')
    return storage.decryptString(Buffer.from(value.slice(ENCRYPTED_KEY_PREFIX.length), 'base64'))
  } catch {
    throw new Error(
      'Não foi possível abrir a chave de API no cofre do sistema. Cadastre a chave novamente.',
    )
  }
}
