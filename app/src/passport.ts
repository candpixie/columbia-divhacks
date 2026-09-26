import type { Data } from './data'
import type { TimesState } from './types'

// NYC Passport: which cells someone has explored, packed one bit per cell into a short string.
// Stored on each person's row in the room, so everyone in the room sees everyone's stamps live.

export function encodeVisited(visited: Set<number>, total: number): string {
  const bytes = new Uint8Array(Math.ceil(total / 8))
  visited.forEach((i) => {
    if (i >= 0 && i < total) bytes[i >> 3] |= 1 << (i & 7)
  })
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeVisited(code: string | undefined, total: number): Set<number> {
  const out = new Set<number>()
  if (!code) return out
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/')
    const s = atob(b64 + '==='.slice((b64.length + 3) % 4))
    for (let i = 0; i < Math.min(total, s.length * 8); i++) if (s.charCodeAt(i >> 3) & (1 << (i & 7))) out.add(i)
  } catch {
    /* corrupt code: treat as nothing explored */
  }
  return out
}

export type ExplorePlace = { name: string; kind: string; lat: number; lon: number; hex: number; nta: string }

export const KIND_ICON: Record<string, string> = {
  Park: '🌳', Library: '📚', Museum: '🏛️', Gallery: '🖼️', Market: '🧺', Viewpoint: '🌇',
}

const short = (n: string) => n.split(/[-(]/)[0].trim()

export type Suggestion = { nta: string; name: string; minutes: number; place: ExplorePlace | null }

// Which neighborhoods of the city are within `limit` minutes of a place, and never explored by anyone counted
export function thirtyMinuteIdeas(data: Data, times: TimesState, originKey: string | null, explored: Set<string>, places: ExplorePlace[], limit = 30): Suggestion[] {
  const t = originKey ? times[originKey] : null
  if (!(t instanceof Float32Array)) return []
  const best = new Map<string, number>()
  data.cells.forEach((c, i) => {
    const m = t[i]
    if (!Number.isFinite(m) || m > limit || explored.has(c.nta)) return
    if (!best.has(c.nta) || m < best.get(c.nta)!) best.set(c.nta, m)
  })
  const byNta = new Map<string, ExplorePlace[]>()
  for (const p of places) byNta.set(p.nta, [...(byNta.get(p.nta) ?? []), p])
  const order = ['Museum', 'Market', 'Viewpoint', 'Park', 'Gallery', 'Library']
  // NYC splits some neighborhoods (two "Upper West Side"s); keep the closest one per name people say
  const seenName = new Set<string>()
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1])
    .filter(([nta]) => {
      const n = short(data.neighborhoods[nta]?.name ?? nta)
      if (seenName.has(n)) return false
      seenName.add(n)
      return true
    })
    .slice(0, 5)
    .map(([nta, minutes]) => ({
      nta,
      name: short(data.neighborhoods[nta]?.name ?? nta),
      minutes: Math.round(minutes),
      place: [...(byNta.get(nta) ?? [])].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0] ?? null,
    }))
}

