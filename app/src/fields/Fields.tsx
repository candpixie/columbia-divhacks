// The inputs Rentdezvous collects. The onboarding wizard and the map's side panel both render these,
// so the two stay in sync: add or change a field here and it shows up in both.
import { useState } from 'react'
import { AddressSearch } from '../components/AddressSearch'
import { FACTOR_LABEL, FACTOR_NOTE, LABELS, MAX_PLACES, MINS, SAFETY_RANK_NOTE, hue, money } from '../onboarding/constants'
import { PlaceIcon } from '../onboarding/icons'
import { coordKey, type Person, type Place, type TimesState } from '../types'

export type SetPerson = (f: (p: Person) => Person) => void
type FieldProps = { person: Person; setPerson: SetPerson; compact?: boolean }

const MIN_BUDGET = 1000
const MAX_BUDGET = 10000

export function BudgetField({ person, setPerson, compact }: FieldProps) {
  const budget = person.budget ?? 3200
  const set = (v: number) => setPerson((p) => ({ ...p, budget: Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, v)) }))
  const pct = ((budget - MIN_BUDGET) / (MAX_BUDGET - MIN_BUDGET)) * 100
  return (
    <div className={compact ? 'f-budget compact' : 'f-budget'}>
      <div className="amt">
        <b>
          {money(budget)}
          {budget >= MAX_BUDGET ? '+' : ''}
        </b>
        <span>per month</span>
      </div>
      <div className="slider">
        <button className="step" onClick={() => set(budget - 50)} aria-label="Lower by $50">
          −
        </button>
        <input
          className="one"
          type="range"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={50}
          value={budget}
          style={{ ['--p' as string]: `${pct}%` }}
          onChange={(e) => set(+e.target.value)}
          aria-label="Maximum monthly budget"
        />
        <button className="step" onClick={() => set(budget + 50)} aria-label="Raise by $50">
          +
        </button>
      </div>
      {!compact && (
        <div className="ticks">
          <span>$1k</span>
          <span>$4k</span>
          <span>$7k</span>
          <span>$10k+</span>
        </div>
      )}
    </div>
  )
}

export function PlacesField({ person, setPerson, compact, times }: FieldProps & { times?: TimesState }) {
  const update = (id: string, patch: Partial<Place>) =>
    setPerson((p) => ({ ...p, places: p.places.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  const used = person.places.map((p) => p.name)
  const quick = ['Work', 'School', 'Family', 'Gym', 'Partner'].filter((l) => !used.includes(l)).slice(0, 3)
  const add = (label: string) =>
    setPerson((p) => ({
      ...p,
      places: [...p.places, { id: crypto.randomUUID(), name: label, address: '', lat: null, lng: null, maxMin: 30 }],
    }))

  return (
    <div className={compact ? 'f-places compact' : 'f-places'}>
      <div className="bubs">
        {person.places.map((p, k) => {
          const t = p.lat != null && p.lng != null ? times?.[coordKey({ lat: p.lat, lng: p.lng })] : undefined
          return (
            <div className="bub" key={p.id} style={{ ['--h' as string]: hue(p.name) }}>
              <div className="top">
                <span className="ico">
                  <PlaceIcon label={p.name} />
                </span>
                <input
                  className="lab"
                  list="labs"
                  value={p.name}
                  placeholder="Name this place"
                  aria-label={`Label for place ${k + 1}`}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                />
                {person.places.length > 1 && (
                  <button className="x" onClick={() => setPerson((q) => ({ ...q, places: q.places.filter((x) => x.id !== p.id) }))} aria-label={`Remove ${p.name || 'place'}`}>
                    ×
                  </button>
                )}
              </div>
              <AddressSearch
                inputClassName="ad"
                value={p.address}
                placeholder="Search an NYC address"
                ariaLabel={`Address for ${p.name || 'place'}`}
                onPick={(s) => update(p.id, { address: s.label, lat: s.lat, lng: s.lng })}
              />
              <div className="opts">
                <span>Travel up to</span>
                {MINS.map((m) => (
                  <button key={m} className="mp" aria-pressed={p.maxMin === m} onClick={() => update(p.id, { maxMin: m })}>
                    {m} min
                  </button>
                ))}
              </div>
              {p.address && p.lat == null && <p className="note">Pick an address from the list to put this on the map.</p>}
              {t === 'loading' && <p className="note">Getting transit times…</p>}
              {t && typeof t === 'object' && 'error' in t && <p className="note f-err">Couldn't get transit times: {t.error}</p>}
            </div>
          )
        })}
      </div>
      {person.places.length < MAX_PLACES && (
        <div className="adders">
          {quick.map((l) => (
            <button key={l} className="addb" style={{ ['--h' as string]: hue(l) }} onClick={() => add(l)}>
              <i>+</i>
              {l}
            </button>
          ))}
          <button className="addb" style={{ ['--h' as string]: '#6B7079' }} onClick={() => add('')}>
            <i>+</i>Something else
          </button>
        </div>
      )}
      <datalist id="labs">
        {LABELS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </div>
  )
}

export function PrioritiesField({ person, setPerson, compact }: FieldProps) {
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const move = (from: number, to: number) => {
    if (to < 0 || to >= person.ranking.length) return
    setPerson((p) => {
      const r = [...p.ranking]
      const [x] = r.splice(from, 1)
      r.splice(to, 0, x)
      return { ...p, ranking: r }
    })
  }
  return (
    <div className={compact ? 'f-rank compact' : 'f-rank'}>
      <ol className="rank">
        {person.ranking.map((f, k) => (
          <li
            key={f}
            draggable
            className={[k === 0 ? 'top' : '', drag === k ? 'dragging' : '', over === k ? 'over' : ''].join(' ')}
            onDragStart={(e) => {
              setDrag(k)
              e.dataTransfer.setData('text/plain', String(k))
            }}
            onDragEnd={() => {
              setDrag(null)
              setOver(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(k)
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault()
              if (drag !== null && drag !== k) move(drag, k)
              setDrag(null)
              setOver(null)
            }}
          >
            <span className="pos">{k + 1}</span>
            <span className="nm">
              {FACTOR_LABEL[f]}
              {/* safety's limit depends on its rank, so always say what the current rank means */}
              {f === 'safety' ? <small className="f-sub">{SAFETY_RANK_NOTE[k]}</small> : !compact && <small className="f-sub">{FACTOR_NOTE[f]}</small>}
            </span>
            <button className="mv" disabled={k === 0} onClick={() => move(k, k - 1)} aria-label={`Move ${FACTOR_LABEL[f]} up`}>
              ↑
            </button>
            <button className="mv" disabled={k === person.ranking.length - 1} onClick={() => move(k, k + 1)} aria-label={`Move ${FACTOR_LABEL[f]} down`}>
              ↓
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
