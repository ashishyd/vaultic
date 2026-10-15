import { ephemeralFetch } from './ephemeral-fetch'

const MAX_BYTES = 300_000
// og:image assets are routinely 500KB-1MB (e.g. GitHub's homepage og:image is ~605KB) —
// a tighter cap here just silently drops most real-world thumbnails.
const MAX_IMAGE_BYTES = 2_000_000
const TIMEOUT_MS = 6000
const IMAGE_TIMEOUT_MS = 10000
// A real browser UA — many sites (hotlink/scrape protection) 403 a bare "bot-ish"
// User-Agent even for a public image, so we present as an ordinary browser request.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export interface LinkPreview {
  title?: string
  description?: string
  /** data: URL, small enough to store inline in the encrypted vault. */
  image?: string
}

/**
 * 'dead' = high-confidence the link is gone (DNS/connection failure, or an HTTP
 * status that specifically means "not here anymore": 404/410/400/451) — safe to
 * suggest deleting. 'blocked' = inconclusive (403/401/429/5xx, timeout) — could
 * easily be bot-protection on an otherwise-live site, so never framed as dead.
 */
export type LinkCheckStatus = 'ok' | 'dead' | 'blocked'

export interface LinkCheckResult {
  preview: LinkPreview | null
  status: LinkCheckStatus
}

function classifyHttpStatus(code: number): LinkCheckStatus {
  if (code >= 200 && code < 400) return 'ok'
  if (code === 404 || code === 410 || code === 400 || code === 451) return 'dead'
  return 'blocked'
}

function classifyNetworkError(err: unknown): LinkCheckStatus {
  const message = err instanceof Error ? err.message : String(err)
  if (
    /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|ERR_EMPTY_RESPONSE|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(
      message
    )
  ) {
    return 'dead'
  }
  // Timeouts and other transient network errors are inconclusive, not "dead".
  return 'blocked'
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  reg: '®',
  trade: '™'
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
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

/** Resolves a possibly-relative image URL (og:image often is) against the page URL. */
function resolveImageUrl(raw: string, pageUrl: string): string | null {
  try {
    return new URL(raw, pageUrl).toString()
  } catch {
    return null
  }
}

const IMG_SRC_ATTR = /(?:data-src|data-original|data-lazy-src|data-lazy|src)=["']([^"']+)["']/i
const JUNK_IMAGE_PATTERN = /sprite|spacer|pixel|blank|loading|placeholder|1x1|avatar|logo[-._]?(?:small|icon)?\./i

/**
 * When a page has no og:image/twitter:image, dig further into the already-fetched
 * HTML rather than making another request: JSON-LD's "image" field, the first
 * plausible content <img> (including lazy-loaded data-src variants), then finally
 * a touch-icon/favicon as a last resort.
 */
function extractFallbackImage(html: string, pageUrl: string): string | undefined {
  const ldImage = /"image"\s*:\s*"([^"]+)"/i.exec(html)?.[1]
  if (ldImage) {
    const resolved = resolveImageUrl(decodeHtmlEntities(ldImage), pageUrl)
    if (resolved) return resolved
  }

  const imgTagPattern = /<img\b[^>]*>/gi
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = imgTagPattern.exec(html))) {
    const src = IMG_SRC_ATTR.exec(tagMatch[0])?.[1]
    if (!src || src.startsWith('data:') || JUNK_IMAGE_PATTERN.test(src)) continue
    const resolved = resolveImageUrl(decodeHtmlEntities(src), pageUrl)
    if (resolved) return resolved
  }

  const iconHref = /<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1]
  if (iconHref) {
    const resolved = resolveImageUrl(decodeHtmlEntities(iconHref), pageUrl)
    if (resolved) return resolved
  }

  return undefined
}

async function attemptImageFetch(imageUrl: string, referer?: string): Promise<string | undefined> {
  const res = await ephemeralFetch(imageUrl, {
    timeoutMs: IMAGE_TIMEOUT_MS,
    maxBytes: MAX_IMAGE_BYTES,
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      ...(referer ? { Referer: referer } : {})
    }
  })
  const contentType = res.headers.get('content-type') ?? ''
  // A truncated image is corrupt bytes, not a usable (if lower-res) image — skip it.
  if (!res.ok || res.truncated || !contentType.startsWith('image/')) return undefined
  return `data:${contentType.split(';')[0]};base64,${res.body.toString('base64')}`
}

/**
 * Downloads a thumbnail image and inlines it as a data: URL, capped to stay
 * vault-friendly. `refererUrl` (the page the image was found on) matters: many
 * sites 403 hotlinked image requests that don't carry a matching Referer — but
 * Electron's network stack (unlike a bare fetch()) actively cancels a manually
 * set cross-origin Referer that doesn't look like what a real page would send,
 * logging "Cancelling request ... with invalid referrer". So this tries, in
 * order: the full page URL as Referer (works when the image is same-site, or
 * the target doesn't scrutinize it), the page's origin alone (what a browser's
 * default strict-origin-when-cross-origin policy actually sends cross-site),
 * then no Referer at all. Runs through the ephemeral (non-persistent) session.
 */
export async function fetchImageAsDataUrl(imageUrl: string, refererUrl?: string): Promise<string | undefined> {
  const referers: Array<string | undefined> = refererUrl ? [refererUrl] : []
  if (refererUrl) {
    try {
      referers.push(`${new URL(refererUrl).origin}/`)
    } catch {
      /* ignore */
    }
  }
  referers.push(undefined)

  for (const referer of referers) {
    try {
      const result = await attemptImageFetch(imageUrl, referer)
      if (result) return result
    } catch {
      // try the next referer strategy
    }
  }
  return undefined
}

/** Shared by the main fetch and the search-fallback candidate fetch. */
async function parsePreviewFromHtml(html: string, pageUrl: string): Promise<LinkPreview | null> {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]
  const description = extractMeta(html, 'og:description') ?? extractMeta(html, 'description')
  const rawImage = extractMeta(html, 'og:image') ?? extractMeta(html, 'twitter:image')
  const imageUrl = rawImage
    ? resolveImageUrl(decodeHtmlEntities(rawImage), pageUrl)
    : (extractFallbackImage(html, pageUrl) ?? null)
  if (!title && !description && !imageUrl) return null

  const image = imageUrl ? await fetchImageAsDataUrl(imageUrl, pageUrl) : undefined
  return {
    title: title ? decodeHtmlEntities(title).slice(0, 200) || undefined : undefined,
    description: description ? decodeHtmlEntities(description).slice(0, 300) || undefined : undefined,
    image
  }
}

/** GET + parse in one step, swallowing all errors — used for the search-fallback candidate page. */
async function fetchAndParsePreview(url: string): Promise<LinkPreview | null> {
  try {
    const res = await ephemeralFetch(url, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html,application/xhtml+xml' }
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null
    return await parsePreviewFromHtml(res.body.toString('utf8'), url)
  } catch {
    return null
  }
}

/**
 * Many bookmarks (especially ones imported without ever successfully fetching a
 * preview) have no stored title at all. Falls back to the URL's last path segment
 * — often a meaningful slug like "reiko-kobayakawa" or "watermelon-man-1970" — as
 * a loose search query when there's nothing better to go on.
 */
function deriveQueryFromUrlSlug(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean)
    const last = segments.at(-1)
    if (!last) return null
    const words = decodeURIComponent(last)
      .replace(/\.[a-z0-9]{1,5}$/i, '') // strip a file extension, if any
      .replace(/[-_+]+/g, ' ')
      .trim()
    if (!words || /^\d+$/.test(words)) return null
    return words
  } catch {
    return null
  }
}

// Tried in order against the bookmark's own host. `?s=` is WordPress's default
// search query param — very common among exactly the kind of sites that tend to
// lack og:image (many of this app's bookmarks are WordPress-based tube/blog
// sites) — `search?q=` covers a chunk of everything else.
const SITE_SEARCH_URL_BUILDERS: Array<(host: string, query: string) => string> = [
  (host, query) => `https://${host}/?s=${encodeURIComponent(query)}`,
  (host, query) => `https://${host}/search?q=${encodeURIComponent(query)}`
]

/** A match only counts if it's actually about the query, not just whatever a site's homepage happens to show. */
function looksRelevant(preview: LinkPreview, query: string): boolean {
  const text = `${preview.title ?? ''} ${preview.description ?? ''}`.toLowerCase()
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 4)
  if (words.length === 0) return true
  return words.some((w) => text.includes(w))
}

/**
 * Last-resort fallback for a link that's reachable (even if blocked/empty) but
 * has nothing extractable from its own page — common for "this video was
 * removed" placeholders on content that's often re-posted under the same title
 * elsewhere on the same site: tries the site's own search feature directly
 * (no third-party search engine involved — those block/rate-limit this kind of
 * automated querying too unpredictably to rely on). Only ever fetches the
 * search-results page itself and checks it for a relevant preview — no further
 * hops to individual result links, to keep this bounded and simple.
 */
async function searchSameSiteForPreview(originalUrl: string, query: string): Promise<LinkPreview | null> {
  let host: string
  try {
    host = new URL(originalUrl).host
  } catch {
    return null
  }

  for (const buildUrl of SITE_SEARCH_URL_BUILDERS) {
    const searchUrl = buildUrl(host, query)
    if (searchUrl === originalUrl) continue
    const preview = await fetchAndParsePreview(searchUrl)
    if (preview && looksRelevant(preview, query)) return preview
  }
  return null
}

/**
 * Best-effort fetch of a page's <title>, description and a thumbnail image, plus
 * a liveness classification (see LinkCheckStatus) so callers can flag dead links
 * without a second request. Runs in the main process only, gated behind the same
 * Touch ID/password prompt as other URL-revealing actions, since it requires the
 * real (decrypted) bookmark URL — and through the ephemeral (non-persistent)
 * session, since several saved links are sensitive and this should never leave
 * cookies, cache or history behind (see ephemeral-fetch.ts).
 *
 * `knownTitle` (the bookmark's current title, if any) is only used as a last
 * resort: whenever the page itself yields nothing — including when the page
 * request is blocked outright (e.g. a 403 from bot-protection, which never even
 * gets to look at page content) — it (or, failing that, a query derived from the
 * URL's slug) is used to search the same site for a match. Never attempted for a
 * 'dead' link: searching for content whose own URL is confirmed gone is unlikely
 * to help and just adds a request. See searchSameSiteForPreview / deriveQueryFromUrlSlug.
 */
export async function fetchLinkPreview(url: string, knownTitle?: string): Promise<LinkCheckResult> {
  if (!/^https?:\/\//i.test(url)) return { preview: null, status: 'blocked' }

  let status: LinkCheckStatus = 'blocked'
  try {
    const res = await ephemeralFetch(url, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html,application/xhtml+xml' }
    })
    if (res.ok) {
      status = 'ok'
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/html')) {
        const preview = await parsePreviewFromHtml(res.body.toString('utf8'), url)
        if (preview) return { preview, status }
      }
    } else {
      status = classifyHttpStatus(res.status)
    }
  } catch (err) {
    status = classifyNetworkError(err)
  }

  if (status === 'dead') return { preview: null, status }

  const titleQuery = knownTitle?.trim()
  const searchQuery = titleQuery && titleQuery !== url ? titleQuery : deriveQueryFromUrlSlug(url)
  if (searchQuery) {
    const fallback = await searchSameSiteForPreview(url, searchQuery)
    if (fallback) return { preview: fallback, status: 'ok' }
  }

  return { preview: null, status }
}
