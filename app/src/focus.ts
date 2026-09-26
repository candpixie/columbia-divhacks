// Places inside one focused hexagon, read from the basemap's own vector tiles (OpenStreetMap data via CARTO),
// so the bubbles need no extra API or key.
import type { Map as MapLibreMap } from 'maplibre-gl'
import { getResolution, latLngToCell } from 'h3-js'

export type SpotKind = 'subway' | 'grocery' | 'park' | 'food' | 'health' | 'laundry'

export type Spot = { kind: SpotKind; name: string; lng: number; lat: number; more: number }

type Kind = { kind: SpotKind; label: string; color: string; rank: (cls: string, sub: string) => number }

// lower rank = better example of that kind; -1 = not this kind
export const KINDS: Kind[] = [
  { kind: 'subway', label: 'Subway', color: '#0F6FC6', rank: (c, s) => (c === 'railway' ? 0 : c === 'entrance' && s === 'subway_entrance' ? 1 : -1) },
  { kind: 'grocery', label: 'Grocery', color: '#1F7A4C', rank: (c, s) => (c === 'grocery' ? 0 : c === 'shop' && s === 'greengrocer' ? 1 : c === 'shop' && s === 'convenience' ? 2 : -1) },
  { kind: 'park', label: 'Park', color: '#3E8E3A', rank: (c) => (c === 'park' ? 0 : c === 'garden' ? 1 : c === 'playground' ? 2 : -1) },
  { kind: 'food', label: 'Food', color: '#D9480F', rank: (c) => (c === 'restaurant' ? 0 : c === 'fast_food' || c === 'cafe' || c === 'bakery' ? 1 : -1) },
  { kind: 'health', label: 'Health', color: '#C2185B', rank: (c) => (c === 'hospital' ? 0 : c === 'doctors' ? 1 : c === 'pharmacy' ? 2 : -1) },
  { kind: 'laundry', label: 'Laundry', color: '#7C4DBC', rank: (c, s) => (c === 'laundry' && s === 'laundry' ? 0 : -1) },
]

/** The best named place of each kind inside the hexagon, plus how many more of that kind there are. */
export function spotsIn(map: MapLibreMap, h3: string): Spot[] {
  const res = getResolution(h3)
  const seen = new Set<string>()
  const best = new Map<SpotKind, { spot: Spot; score: number }>()
  const count = new Map<SpotKind, number>()
  let features
  try {
    features = map.querySourceFeatures('carto', { sourceLayer: 'poi' })
  } catch {
    return [] // a basemap without a 'carto' source (or not loaded yet)
  }
  for (const f of features) {
    if (f.geometry.type !== 'Point') continue
    const [lng, lat] = f.geometry.coordinates as [number, number]
    const p = f.properties as Record<string, string | number | undefined>
    const cls = String(p.class ?? ''), sub = String(p.subclass ?? '')
    const name = String(p.name_en ?? p.name ?? '').trim()
    const key = `${cls}|${sub}|${name}|${lng.toFixed(4)},${lat.toFixed(4)}` // the same place repeats across tile edges
    if (seen.has(key)) continue
    seen.add(key)
    if (latLngToCell(lat, lng, res) !== h3) continue
    for (const k of KINDS) {
      const r = k.rank(cls, sub)
      if (r < 0) continue
      count.set(k.kind, (count.get(k.kind) ?? 0) + 1)
      if (!name) break
      const score = r * 1000 + Number(p.rank ?? 999) // OpenMapTiles rank: lower = more prominent
      const cur = best.get(k.kind)
      if (!cur || score < cur.score) best.set(k.kind, { spot: { kind: k.kind, name, lng, lat, more: 0 }, score })
      break
    }
  }
  return KINDS.flatMap((k) => {
    const b = best.get(k.kind)
    return b ? [{ ...b.spot, more: (count.get(k.kind) ?? 1) - 1 }] : []
  })
}

export const ICONS: Record<SpotKind, string> = {
  subway: '<rect x="3.5" y="1.5" width="9" height="10" rx="2.5"/><path d="M3.5 7h9M5.5 14l1.5-2.5M10.5 14 9 11.5"/>',
  grocery: '<path d="M2 3h2l1.5 7.5h7L14 5H4.6"/><circle cx="6.5" cy="13" r="1"/><circle cx="11.5" cy="13" r="1"/>',
  park: '<path d="M8 1.5 12 7H9.8L13 11H3l3.2-4H4Z"/><path d="M8 11v3.5"/>',
  food: '<path d="M4 1.5v5a1.5 1.5 0 0 0 3 0v-5M5.5 6.5v8M11.5 14.5v-13c-1.7.6-2.5 2.3-2.5 4.5v3.5h2.5"/>',
  health: '<rect x="2" y="2" width="12" height="12" rx="3"/><path d="M8 5v6M5 8h6"/>',
  laundry: '<rect x="2.5" y="1.5" width="11" height="13" rx="2"/><circle cx="8" cy="9" r="3.2"/><path d="M5 4.2h1.5"/>',
}
