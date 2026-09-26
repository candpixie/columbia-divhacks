import type { Data } from './data'
import { coordKey, located, type Beds, type Factor, type Person, type SafetyPref, type TimesState } from './types'

// Stretch cost (PRD, Logic): for each broken constraint, cost = how far over x the weight of its owner's rank for it.
// Hex cost = sum over the people counted / how many are counted. Green = 0, yellow = above 0 up to THRESHOLD, gray = above.

export const RANK_WEIGHTS = [4, 2, 1]
export const THRESHOLD = 0.4

export const SAFETY_LIMIT_PCT: Record<SafetyPref, number | null> = {
  none: null,
  median: 50,
  lowerThird: 100 / 3,
}

// Safety's limit follows its rank: #1 = lowest third citywide, #2 = city median, #3 = no limit
export const SAFETY_BY_RANK: SafetyPref[] = ['lowerThird', 'median', 'none']
export const safetyPref = (p: Person): SafetyPref => SAFETY_BY_RANK[p.ranking.indexOf('safety')]

export type Status = 'green' | 'yellow' | 'gray' | 'neutral'

export type Issue = {
  personId: string
  factor: Factor
  cost: number
  what: string // what's off, e.g. "Sam: Work 52 min (limit 45)"
  fix: string // what would make it fit, e.g. "Sam: allow 52 min to Work"
}

export type PersonResult = {
  person: Person
  commutes: { name: string; minutes: number | null; maxMin: number }[] // null = still loading
  issues: Issue[]
}

export type CellResult = {
  status: Status
  cost: number
  issues: Issue[] // everyone counted, cheapest first
  people: PersonResult[]
  rent: number // whole apartment for the group's size
  share: number // each person's equal share
  safetyPct: number
}

export function bedsFor(people: number): Beds {
  return people <= 1 ? '1br' : people === 2 ? '2br' : '3br'
}

export function hasConstraints(p: Person): boolean {
  return located(p.places).length > 0 || p.budget != null || safetyPref(p) !== 'none'
}

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`

/**
 * @param group everyone splitting the rent (sets the bedroom count and each share)
 * @param counted whose constraints color the map: the whole group, or one person for their own view
 */
export function scoreCell(data: Data, i: number, group: Person[], counted: Person[], times: TimesState): CellResult {
  const cell = data.cells[i]
  const hood = data.neighborhoods[cell.nta]
  const n = Math.max(1, group.length)
  const rent = hood.rent[bedsFor(n)]
  const share = rent / n
  const safetyPct = data.safetyPct[cell.nta]
  const named = group.length > 1 // prefix issues with names once there's more than one person

  const people = counted.map((person): PersonResult => {
    const weight = (f: Factor) => RANK_WEIGHTS[person.ranking.indexOf(f)]
    const who = named ? `${person.name || 'Someone'}: ` : ''
    const issues: Issue[] = []

    const commutes = located(person.places).map((pl) => {
      const t = times[coordKey(pl)]
      const minutes = t instanceof Float32Array ? t[i] : null
      if (minutes != null && minutes > pl.maxMin) {
        const reachable = Number.isFinite(minutes)
        const place = pl.name || 'this place'
        issues.push({
          personId: person.id,
          factor: 'commute',
          cost: (reachable ? (minutes - pl.maxMin) / pl.maxMin : Infinity) * weight('commute'),
          what: reachable ? `${who}${place} ${Math.round(minutes)} min (limit ${pl.maxMin})` : `${who}${place} over 2 hours by transit`,
          fix: reachable ? `${who}allow ${Math.ceil(minutes)} min to ${place}` : `${who}no realistic transit route to ${place}`,
        })
      }
      return { name: pl.name, minutes, maxMin: pl.maxMin }
    })

    if (person.budget != null && share > person.budget) {
      issues.push({
        personId: person.id,
        factor: 'rent',
        cost: ((share - person.budget) / person.budget) * weight('rent'),
        what: `${who}rent ${n > 1 ? 'share ' : ''}${fmtMoney(share)} (budget ${fmtMoney(person.budget)})`,
        fix: `${who}raise budget to ${fmtMoney(share)}`,
      })
    }

    const pref = safetyPref(person)
    const limit = SAFETY_LIMIT_PCT[pref]
    if (limit != null && safetyPct > limit) {
      issues.push({
        personId: person.id,
        factor: 'safety',
        cost: ((safetyPct - limit) / 100) * weight('safety'),
        what: `${who}reported violent crime higher than ${Math.round(safetyPct)}% of neighborhoods`,
        fix: `${who}${pref === 'lowerThird' && safetyPct <= 50 ? 'move safety down to #2 (city median)' : 'move safety to #3 (no safety limit)'}`,
      })
    }
    return { person, commutes, issues }
  })

  const issues = people.flatMap((p) => p.issues).sort((a, b) => a.cost - b.cost)
  const cost = issues.reduce((s, x) => s + x.cost, 0) / Math.max(1, counted.length)
  const status: Status = !counted.some(hasConstraints) ? 'neutral' : cost === 0 ? 'green' : cost <= THRESHOLD ? 'yellow' : 'gray'
  return { status, cost, issues, people, rent, share, safetyPct }
}
