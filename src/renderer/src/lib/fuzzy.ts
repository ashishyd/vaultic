/** Tiny fuzzy matcher: substring hits rank highest; otherwise subsequence match. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const idx = t.indexOf(q)
  if (idx !== -1) return 1000 - idx

  let ti = 0
  let score = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    score += Math.max(1, 10 - (found - ti))
    ti = found + 1
  }
  return score
}

export function fuzzyMatch(texts: string[], query: string): number {
  let best = -1
  for (const text of texts) {
    const score = fuzzyScore(text, query)
    if (score > best) best = score
  }
  return best
}
