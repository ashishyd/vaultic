const MAX_BYTES = 300_000
const TIMEOUT_MS = 6000

export interface LinkPreview {
  title?: string
  description?: string
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function extractMeta(html: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`, 'i')
  ]
  for (const re of patterns) {
    const m = re.exec(html)
    if (m?.[1]) return m[1]
  }
  return undefined
}

/**
 * Best-effort fetch of a page's <title> and description. Runs in the main process
 * only, gated behind the same Touch ID/password prompt as other URL-revealing
 * actions, since it requires the real (decrypted) bookmark URL.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaulticPreview/1.0)' }
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('text/html') || !res.body) return null

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let html = ''
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (received > MAX_BYTES) {
        await reader.cancel()
        break
      }
    }

    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]
    const description = extractMeta(html, 'og:description') ?? extractMeta(html, 'description')
    if (!title && !description) return null

    return {
      title: title ? decodeHtmlEntities(title).slice(0, 200) || undefined : undefined,
      description: description ? decodeHtmlEntities(description).slice(0, 300) || undefined : undefined
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
