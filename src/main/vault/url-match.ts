/** Hostname matching for browser autofill / save suggestions. */

export function hostnameOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/** True when page host and saved login host refer to the same site. */
export function hostsMatch(pageHost: string, loginHost: string): boolean {
  const a = pageHost.replace(/^www\./, '').toLowerCase()
  const b = loginHost.replace(/^www\./, '').toLowerCase()
  if (!a || !b) return false
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a)
}
