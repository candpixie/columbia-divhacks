import { useState, type ReactNode } from 'react'
import type { Person, TimesState } from '../types'
import { BudgetField, PlacesField, PrioritiesField, type SetPerson } from '../fields/Fields'
import { STEPS } from '../onboarding/constants'
import { Mark } from '../onboarding/icons'
import { StartGroup } from '../onboarding/Wizard'

type Props = {
  me: Person
  setMe: SetPerson
  people: Person[] // everyone in the room (just you when searching alone)
  view: string | null // person id whose view the map shows; null = everyone
  setView: (id: string | null) => void
  roomCode: string | null
  startRoom: () => void
  toast: (m: string) => void
  times: TimesState
  counts: { green: number; yellow: number; gray: number }
  tab: 'find' | 'explore'
  setTab: (t: 'find' | 'explore') => void
  matches: Match[]
  onPickMatch: (m: Match) => void
  explore: ReactNode
}

export type Match = { nta: string; name: string; borough: string; cell: number; share: number; minutes: number[]; status: 'green' | 'yellow' }

// Same fields, same order, same labels as the onboarding wizard (see fields/Fields.tsx)
const title = (id: string) => STEPS.find((s) => s.id === id)!.k

export function Panel({ me, setMe, people, view, setView, roomCode, startRoom, toast, times, counts, tab, setTab, matches, onPickMatch, explore }: Props) {
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState(false)
  const group = people.length > 1
  const fits = matches.filter((m) => m.status === 'green').length

  return (
    <aside className="ms-panel">
      <div className="ms-head">
        <Mark />
        <button className="edit-link ms-invite" onClick={() => setInviting((v) => !v)}>
          {inviting ? 'Close' : roomCode ? 'Invite' : 'Search with others'}
        </button>
      </div>

      <div className="ms-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'find'} onClick={() => setTab('find')}>Find a place</button>
        <button role="tab" aria-selected={tab === 'explore'} onClick={() => setTab('explore')}>Explore</button>
      </div>

      {inviting && (
        <section className="ms-sec">
          <StartGroup me={me} setMe={setMe} roomCode={roomCode} roomPeople={people} startRoom={startRoom} toast={toast} />
        </section>
      )}

      {(group || roomCode) && (
        <section className="ms-sec">
          <h2 className="ms-h">People</h2>
          <div className="ms-people" role="radiogroup" aria-label="Whose view the map shows">
            {group && (
              <button className="ms-chip" role="radio" aria-checked={view === null} onClick={() => setView(null)}>
                Everyone
              </button>
            )}
            {people.map((p) => (
              <button
                key={p.id}
                className="ms-chip"
                role="radio"
                aria-checked={view === p.id}
                onClick={() => setView(view === p.id ? null : p.id)}
                title={p.done ? `Show the map for ${p.name || 'this person'} alone` : 'Still answering'}
              >
                <i className="ms-dot" style={{ background: p.color }} />
                {p.id === me.id ? 'You' : p.name || 'Someone'}
                {!p.done && <small> · answering</small>}
              </button>
            ))}
          </div>
          {view && <p className="note">Showing the map for {people.find((p) => p.id === view)?.id === me.id ? 'you' : people.find((p) => p.id === view)?.name} alone. Rent is still split {people.filter((p) => p.done).length} ways.</p>}
          {roomCode && (
            <label className="ms-name">
              <span className="note">Your name</span>
              <input className="input" value={me.name} onChange={(e) => setMe((p) => ({ ...p, name: e.target.value }))} aria-label="Your name" />
            </label>
          )}
        </section>
      )}

      {tab === 'explore' ? explore : (
      <>
      <section className="ms-sec">
        <h2 className="ms-h">{matches.length ? (fits ? `Your best matches` : `Closest matches`) : 'Your matches'}</h2>
        {matches.length ? (
          <ol className="ms-matches">
            {matches.map((m, k) => (
              <li key={m.nta}>
                <button onClick={() => onPickMatch(m)}>
                  <span className="ms-mrank">{k + 1}</span>
                  <span className="ms-mname">
                    {m.name}
                    <small>{m.borough}{m.status === 'yellow' ? ' · close' : ''}</small>
                  </span>
                  <span className="ms-mnum">
                    ${Math.round(m.share).toLocaleString()}
                    <small>{m.minutes.length ? `${Math.max(...m.minutes)} min` : ''}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="note">Nothing fits yet. Try a higher budget or a longer commute below.</p>
        )}
      </section>

      <section className="ms-sec ms-legend">
        <div>
          <i className="ms-sw green" /> Fits <b>{counts.green}</b>
        </div>
        <div>
          <i className="ms-sw yellow" /> Close <b>{counts.yellow}</b>
        </div>
        <div>
          <i className="ms-sw gray" /> Out <b>{counts.gray}</b>
        </div>
      </section>

      <section className="ms-sec">
        <button className="ms-edit-toggle" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          <span className="ms-h">Your answers</span>
          <span className="edit-link">{editing ? 'Done' : 'Edit'}</span>
        </button>
      </section>
      {editing && (
      <>
      <section className="ms-sec">
        <h2 className="ms-h">{group ? `Your ${title('budget').toLowerCase()}` : title('budget')}</h2>
        <BudgetField person={me} setPerson={setMe} compact />
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">{title('places')}</h2>
        <PlacesField person={me} setPerson={setMe} times={times} compact />
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">{group ? `Your ${title('rank').toLowerCase()}` : title('rank')}</h2>
        <PrioritiesField person={me} setPerson={setMe} compact />
      </section>

      </>
      )}
      </>
      )}
    </aside>
  )
}
