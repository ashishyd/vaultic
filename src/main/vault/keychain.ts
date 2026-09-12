import keytar from 'keytar'

const SERVICE = 'Vaultic'
const ACCOUNT = 'vault-master-key'

export async function cacheKey(key: Buffer): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, key.toString('hex'))
}

export async function readCachedKey(): Promise<Buffer | null> {
  const hex = await keytar.getPassword(SERVICE, ACCOUNT)
  return hex ? Buffer.from(hex, 'hex') : null
}

export async function clearCachedKey(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT)
}
