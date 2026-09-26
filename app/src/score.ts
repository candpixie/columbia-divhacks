import type { Data } from './data'
import { located, type Beds, type Factor, type Person, type SafetyPref, type TimesState } from './types'

// Stretch cost (PRD, Logic): for each broken constraint, cost = how far over x the weight of its rank.
// Green = 0, yellow = above 0 up to THRESHOLD, gray = above THRESHOLD.

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
  factor: Factor
  cost: number
  what: string // what's off, e.g. "Work: 52 min (limit 45)"
  fix: string // what would make it fit, e.g. "Allow 52 min to Work"
}

export type CellResult = {
  status: Status
  cost: number
  issues: Issue[]
  commutes: { name: string; minutes: number | null; maxMin: number }[] // null = still loading
  rent: number
  safetyPct: number
}

export function bedsFor(people: number): Beds {
  return people <= 1 ? '1br' : people === 2 ? '2br' : '3br'
}

export function hasConstraints(p: Person): boolean {
  return located(p.places).length > 0 || p.budget != null || safetyPref(p) !== 'none'
}

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`

export function scoreCell(data: Data, i: number, person: Person, times: TimesState, groupSize = 1): CellResult {
  const cell = data.cells[i]
  const hood = data.neighborhoods[cell.nta]
  const weight = (f: Factor) => RANK_WEIGHTS[person.ranking.indexOf(f)]
  const issues: Issue[] = []

  const commutes = located(person.places).map((pl) => {
    const t = times[pl.id]
    const minutes = t instanceof Float32Array ? t[i] : null
    if (minutes != null && minutes > pl.maxMin) {
      const reachable = Number.isFinite(minutes)
      const over = reachable ? (minutes - pl.maxMin) / pl.maxMin : Infinity
      issues.push({
        factor: 'commute',
        cost: over * weight('commute'),
        what: reachable
          ? `${pl.name}: ${Math.round(minutes)} min (limit ${pl.maxMin})`
          : `${pl.name}: over 2 hours by transit`,
        fix: reachable ? `Allow ${Math.ceil(minutes)} min to ${pl.name}` : `No realistic transit route`,
      })
    }
    return { name: pl.name, minutes, maxMin: pl.maxMin }
  })

  const rent = hood.rent[bedsFor(groupSize)] / groupSize
  if (person.budget != null && rent > person.budget) {
    issues.push({
      factor: 'rent',
      cost: ((rent - person.budget) / person.budget) * weight('rent'),
      what: `Rent: ${fmtMoney(rent)} (budget ${fmtMoney(person.budget)})`,
      fix: `Raise budget to ${fmtMoney(rent)}`,
    })
  }

  const safetyPct = data.safetyPct[cell.nta]
  const pref = safetyPref(person)
  const limit = SAFETY_LIMIT_PCT[pref]
  if (limit != null && safetyPct > limit) {
    issues.push({
      factor: 'safety',
      cost: ((safetyPct - limit) / 100) * weight('safety'),
      what: `Reported violent crime higher than ${Math.round(safetyPct)}% of neighborhoods`,
      fix: pref === 'lowerThird' && safetyPct <= 50 ? 'Move safety down to #2 (city median)' : 'Move safety to #3 (no safety limit)',
    })
  }

  issues.sort((a, b) => a.cost - b.cost)
  const cost = issues.reduce((s, x) => s + x.cost, 0) / groupSize
  const status: Status = !hasConstraints(person) ? 'neutral' : cost === 0 ? 'green' : cost <= THRESHOLD ? 'yellow' : 'gray'
  return { status, cost, issues, commutes, rent, safetyPct }
}
