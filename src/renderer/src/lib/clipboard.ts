export async function copyWithAutoClear(value: string): Promise<void> {
  await window.vaultAPI.copyToClipboard(value)
}
