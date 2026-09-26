import { useState } from 'react'
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
}

// Same fields, same order, same labels as the onboarding wizard (see fields/Fields.tsx)
const title = (id: string) => STEPS.find((s) => s.id === id)!.k

export function Panel({ me, setMe, people, view, setView, roomCode, startRoom, toast, times, counts }: Props) {
  const [inviting, setInviting] = useState(false)
  const group = people.length > 1

  return (
    <aside className="ms-panel">
      <div className="ms-head">
        <Mark />
        <button className="edit-link ms-invite" onClick={() => setInviting((v) => !v)}>
          {inviting ? 'Close' : roomCode ? 'Invite' : 'Search with others'}
        </button>
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
    </aside>
  )
}
