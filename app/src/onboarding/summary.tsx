// One-line summaries of each answer, used by the wizard sidebar and the plan cards
import type { ReactNode } from 'react'
import { FACTOR_LABEL, SAFETY_RANK_NOTE, money, type StepId } from './constants'
import type { Factor, Person } from '../types'

export type Answers = {
  budget: number | null
  places: { name: string; address: string; maxMin: number }[]
  ranking: Factor[]
}

export function summary(id: StepId, d: Answers | Person): ReactNode {
  switch (id) {
    case 'budget':
      return d.budget == null ? 'Not set' : `Up to ${money(d.budget)}${d.budget >= 10000 ? '+' : ''} /mo`
    case 'places': {
      const ps = d.places.filter((x) => x.address.trim())
      if (!ps.length) return 'None yet'
      return ps.map((x, i) => (
        <span key={i}>
          <span className="l">
            {x.name || 'Place'} · {x.address.split(',')[0]}
          </span>
          <span className="xx">within {x.maxMin} min</span>
        </span>
      ))
    }
    case 'rank':
      return (
        <>
          {d.ranking.map((f, k) => (
            <span className="l" key={f}>
              {k + 1}. {FACTOR_LABEL[f]}
            </span>
          ))}
          <span className="xx">Safety: {SAFETY_RANK_NOTE[d.ranking.indexOf('safety')].toLowerCase()}</span>
        </>
      )
    case 'invite': {
      if (!('together' in d) || d.together === null) return <span className="xx">Not answered</span>
      if (!d.together) return 'On my own'
      return `Together${d.mates.length ? ' with ' + d.mates.map((m) => m.name).join(', ') : ''}`
    }
  }
}
