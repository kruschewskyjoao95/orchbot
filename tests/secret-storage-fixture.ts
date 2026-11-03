import { createCipheriv, createDecipheriv } from 'node:crypto'
import type { SecretStorage } from '../src/backend/storage/secrets'

// Deterministic test cipher; production always uses Electron's OS-backed safeStorage.
export const testSecretStorage: SecretStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString(value) {
    const cipher = createCipheriv('aes-256-cbc', Buffer.alloc(32, 1), Buffer.alloc(16, 2))
    return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  },
  decryptString(value) {
    const cipher = createDecipheriv('aes-256-cbc', Buffer.alloc(32, 1), Buffer.alloc(16, 2))
    return Buffer.concat([cipher.update(value), cipher.final()]).toString('utf8')
  },
}
