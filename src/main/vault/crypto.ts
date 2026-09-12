import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto'

const SCRYPT_KEYLEN = 32
// scrypt memory use is ~128 * N * r bytes; N=2^17, r=8 needs ~128MB, so maxmem
// must be raised above Node's 32MB default or scryptSync throws MEMORY_LIMIT_EXCEEDED.
const SCRYPT_PARAMS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const IV_LENGTH = 12 // AES-GCM standard nonce size
const SALT_LENGTH = 16

export interface EncryptedVault {
  salt: string // hex
  iv: string // hex
  authTag: string // hex
  ciphertext: string // hex
}

export async function deriveKey(masterPassword: string, salt: Buffer): Promise<Buffer> {
  return scryptSync(masterPassword, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
}

export function generateSalt(): Buffer {
  return randomBytes(SALT_LENGTH)
}

export async function encryptVault(plaintext: string, masterPassword: string): Promise<EncryptedVault> {
  const salt = generateSalt()
  const key = await deriveKey(masterPassword, salt)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex')
  }
}

export async function encryptVaultWithKey(plaintext: string, key: Buffer, salt: Buffer): Promise<EncryptedVault> {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex')
  }
}

/** Throws if the master password is wrong (auth tag verification fails). */
export async function decryptVault(vault: EncryptedVault, masterPassword: string): Promise<{ plaintext: string; key: Buffer }> {
  const salt = Buffer.from(vault.salt, 'hex')
  const key = await deriveKey(masterPassword, salt)
  const plaintext = decryptWithKey(vault, key)
  return { plaintext, key }
}

export function decryptWithKey(vault: EncryptedVault, key: Buffer): string {
  const iv = Buffer.from(vault.iv, 'hex')
  const authTag = Buffer.from(vault.authTag, 'hex')
  const ciphertext = Buffer.from(vault.ciphertext, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
