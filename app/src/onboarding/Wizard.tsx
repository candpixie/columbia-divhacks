import { useEffect, useRef } from 'react'
import type { Person } from '../types'
import { BudgetField, PlacesField, PrioritiesField, type SetPerson } from '../fields/Fields'
import { InviteCard } from '../components/InviteCard'
import { roomsEnabled } from '../room'
import { STEPS, type StepId } from './constants'
import { summary } from './summary'
import { Arrow, BackArrow, Mark, StepIcon } from './icons'

type Props = {
  me: Person
  setMe: SetPerson
  steps: StepId[] // joiners skip the invite step
  step: number
  setStep: (i: number) => void
  onBackToLanding: () => void
  onFinish: () => void
  together: boolean | null
  setTogether: (t: boolean) => void
  roomCode: string | null
  roomPeople: Person[]
  startRoom: () => void
  toast: (msg: string) => void
}

export function Wizard(props: Props) {
  const { me, setMe, steps, step, setStep, onBackToLanding, onFinish, together, roomCode } = props
  const s = STEPS.find((x) => x.id === steps[step])!
  const last = step === steps.length - 1
  const nextDisabled = s.id === 'invite' && (together === null || (together && !roomCode))
  const seen = useRef(-1)

  const next = () => {
    if (nextDisabled) return
    if (!last) setStep(step + 1)
    else onFinish()
  }
  const back = () => (step === 0 ? onBackToLanding() : setStep(step - 1))

  useEffect(() => {
    scrollTo(0, 0)
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (e.key !== 'Enter' || e.shiftKey) return
      if (t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return
      e.preventDefault()
      next()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const fresh = step - 1 > seen.current ? step - 1 : -2
  useEffect(() => {
    seen.current = Math.max(seen.current, step - 1)
  }, [step])

  const others = props.roomPeople.filter((p) => p.id !== me.id)
  const inviteSummary =
    together === null ? <span className="xx">Not answered</span> : together ? `Together${others.length ? ' with ' + others.map((p) => p.name || 'someone').join(', ') : ''}` : 'On my own'

  return (
    <div className="shell">
      <main className="main">
        <Mark />
        <section className="q" aria-live="polite">
          <div className="prog">
            <span className="n">
              {step + 1}/{steps.length}
            </span>
            <div className="bars">
              {steps.map((_, k) => (
                <i key={k} className={k <= step ? 'on' : ''} />
              ))}
            </div>
          </div>
          <h2 className="qt">{s.title}</h2>
          <p className="sub">{s.sub}</p>
          <div className="stage">
            {s.id === 'budget' && (
              <>
                <BudgetField person={me} setPerson={setMe} />
                <p className="note">Drag to get close, then use − and + to set the exact amount.</p>
              </>
            )}
            {s.id === 'places' && <PlacesField person={me} setPerson={setMe} />}
            {s.id === 'rank' && <PrioritiesField person={me} setPerson={setMe} />}
            {s.id === 'invite' && <InviteStep {...props} />}
          </div>
          <div className="nav">
            <button className="back" onClick={back}>
              <BackArrow />
              Back
            </button>
            <button className="btn pri" onClick={next} disabled={nextDisabled}>
              {last ? 'See my plan' : 'Continue'} <Arrow />
            </button>
          </div>
        </section>
      </main>
      <aside className="side" aria-label="Your plan so far">
        <h3>Your plan so far</h3>
        <ol className="tl">
          {steps.map((id, k) => {
            const st = STEPS.find((x) => x.id === id)!
            const cls = k < step ? 'set' : k === step ? 'now' : ''
            const value = id === 'invite' ? inviteSummary : summary(id, me)
            const inner = (
              <>
                <div className="k">{st.k}</div>
                {k <= step ? <div className="v">{value}</div> : <span className="sk" style={{ width: `${[48, 70, 56, 44][k]}%` }} />}
              </>
            )
            return (
              <li key={id} className={`ent ${cls}${k === fresh ? ' fresh' : ''}`}>
                <span className="ic">
                  <StepIcon id={id} />
                </span>
                {k < step ? (
                  <button className="edit" onClick={() => setStep(k)} aria-label={`Edit ${st.k}`}>
                    {inner}
                  </button>
                ) : (
                  <div>{inner}</div>
                )}
              </li>
            )
          })}
        </ol>
        <div className="sidefoot">Tap any answer to change it.</div>
      </aside>
    </div>
  )
}

function InviteStep({ me, setMe, together, setTogether, roomCode, roomPeople, startRoom, toast }: Props) {
  return (
    <>
      <div className="rows">
        <button className="rowopt" aria-pressed={together === false} onClick={() => setTogether(false)} disabled={!!roomCode}>
          <span className="ind" />
          <span className="t">
            <b>On my own</b>
            <small>Just me for now. I can invite people later from the map.</small>
          </span>
        </button>
        <button className="rowopt" aria-pressed={together === true} onClick={() => setTogether(true)}>
          <span className="ind" />
          <span className="t">
            <b>Together</b>
            <small>With a partner, roommates or friends</small>
          </span>
        </button>
      </div>
      {together && <StartGroup me={me} setMe={setMe} roomCode={roomCode} roomPeople={roomPeople} startRoom={startRoom} toast={toast} />}
    </>
  )
}

// Name + "Start a group", then the live invite card. Also used from the map panel.
export function StartGroup({ me, setMe, roomCode, roomPeople, startRoom, toast }: Pick<Props, 'me' | 'setMe' | 'roomCode' | 'roomPeople' | 'startRoom' | 'toast'>) {
  if (!roomsEnabled)
    return (
      <div className="warn">
        <b>Group search isn't set up yet</b>
        <p>Add the Supabase URL and anon key to app/.env.local (see .env.example), run app/supabase.sql once, and restart the dev server.</p>
      </div>
    )
  if (roomCode) return <InviteCard code={roomCode} people={roomPeople} meId={me.id} hostName={roomPeople[0]?.name ?? me.name} toast={toast} />
  return (
    <div className="board">
      <div>
        <span className="lbl">Your name, so your group knows who's who</span>
        <div className="inl">
          <input
            className="input"
            value={me.name}
            placeholder="First name"
            aria-label="Your name"
            onChange={(e) => setMe((p) => ({ ...p, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && me.name.trim()) {
                e.preventDefault()
                startRoom()
              }
            }}
          />
          <button className="btn pri sm" disabled={!me.name.trim()} onClick={startRoom}>
            Start a group
          </button>
        </div>
      </div>
    </div>
  )
}
