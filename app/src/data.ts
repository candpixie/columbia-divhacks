import type { Cell, Neighborhood } from './types'

export type Data = {
  cells: Cell[]
  neighborhoods: Record<string, Neighborhood>
  // share of residential neighborhoods with a lower violent crime rate, 0-100
  safetyPct: Record<string, number>
  safetyNote: string
}

export async function loadData(): Promise<Data> {
  const [cells, neighborhoods, meta] = await Promise.all([
    fetch('/data/cells.json').then((r) => r.json()),
    fetch('/data/neighborhoods.json').then((r) => r.json()),
    fetch('/data/meta.json').then((r) => r.json()),
  ])
  const rates = Object.values(neighborhoods as Record<string, Neighborhood>).map((n) => n.violentPer1k)
  const safetyPct: Record<string, number> = {}
  for (const [nta, n] of Object.entries(neighborhoods as Record<string, Neighborhood>)) {
    const lower = rates.filter((r) => r < n.violentPer1k).length
    safetyPct[nta] = (100 * lower) / (rates.length - 1)
  }
  return { cells, neighborhoods, safetyPct, safetyNote: meta.safety.note }
}
