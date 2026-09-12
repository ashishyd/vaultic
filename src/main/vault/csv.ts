import { readFile } from 'fs/promises'

export interface ExportableLogin {
  service: string
  url?: string
  username: string
  password: string
  notes?: string
}

export interface CsvLoginRow {
  service: string
  url?: string
  username: string
  password: string
  notes?: string
}

/** Minimal RFC4180-ish CSV line splitter (handles quoted fields with embedded commas/quotes). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

function hostnameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/**
 * Parses the CSV format produced by Chrome/Edge/Brave/Firefox "Export passwords"
 * (header: name,url,username,password[,note]). Doesn't handle quoted newlines
 * within a single field — uncommon in password exports, but a real limitation.
 */
export async function parseLoginsCsvFile(filePath: string): Promise<CsvLoginRow[]> {
  const content = await readFile(filePath, 'utf8')
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return []

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const nameIdx = header.indexOf('name')
  const urlIdx = header.indexOf('url')
  const userIdx = header.indexOf('username')
  const passIdx = header.indexOf('password')
  const noteIdx = header.indexOf('note')

  if (userIdx === -1 || passIdx === -1) {
    throw new Error('This file does not look like a browser password export (missing username/password columns).')
  }

  const rows: CsvLoginRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    const username = fields[userIdx]?.trim() ?? ''
    const password = fields[passIdx]?.trim() ?? ''
    if (!username && !password) continue

    const url = urlIdx !== -1 ? fields[urlIdx]?.trim() || undefined : undefined
    const name = nameIdx !== -1 ? fields[nameIdx]?.trim() || undefined : undefined
    const notes = noteIdx !== -1 ? fields[noteIdx]?.trim() || undefined : undefined

    rows.push({
      service: name || (url ? hostnameFromUrl(url) : undefined) || 'Imported login',
      url,
      username,
      password,
      notes
    })
  }
  return rows
}

/** Quotes a CSV field only when it needs it (contains a comma, quote, or newline). */
function csvField(value: string | undefined): string {
  const v = value ?? ''
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

/**
 * Builds a CSV in the same shape Chrome/Edge/Brave/Firefox expect for
 * "Import passwords" (header: name,url,username,password,note).
 */
export function loginsToCsv(logins: ExportableLogin[]): string {
  const header = 'name,url,username,password,note'
  const lines = logins.map((l) =>
    [csvField(l.service), csvField(l.url), csvField(l.username), csvField(l.password), csvField(l.notes)].join(',')
  )
  return [header, ...lines].join('\r\n') + '\r\n'
}
