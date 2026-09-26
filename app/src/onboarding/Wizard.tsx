import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { Person } from '../types'
import { BudgetField, PlacesField, PrioritiesField } from '../fields/Fields'
import { JOIN, STEPS } from './constants'
import { summary } from './summary'
import { Arrow, BackArrow, Logo, Mark, StepIcon } from './icons'

type Props = {
  person: Person
  setPerson: (f: (p: Person) => Person) => void
  step: number
  setStep: (i: number) => void
  onBackToLanding: () => void
  onFinish: () => void
  invite: (name: string) => void
  toast: (msg: string) => void
}

export function Wizard({ person, setPerson, step, setStep, onBackToLanding, onFinish, invite, toast }: Props) {
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  const nextDisabled = last && person.together === null
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

  return (
    <div className="shell">
      <main className="main">
        <Mark />
        <section className="q" aria-live="polite">
          <div className="prog">
            <span className="n">
              {step + 1}/{STEPS.length}
            </span>
            <div className="bars">
              {STEPS.map((_, k) => (
                <i key={k} className={k <= step ? 'on' : ''} />
              ))}
            </div>
          </div>
          <h2 className="qt">{s.title}</h2>
          <p className="sub">{s.sub}</p>
          <div className="stage">
            {s.id === 'budget' && (
              <>
                <BudgetField person={person} setPerson={setPerson} />
                <p className="note">Drag to get close, then use − and + to set the exact amount.</p>
              </>
            )}
            {s.id === 'places' && <PlacesField person={person} setPerson={setPerson} />}
            {s.id === 'rank' && <PrioritiesField person={person} setPerson={setPerson} />}
            {s.id === 'invite' && <InviteStep person={person} setPerson={setPerson} invite={invite} toast={toast} />}
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
          {STEPS.map((st, k) => {
            const cls = k < step ? 'set' : k === step ? 'now' : ''
            const inner = (
              <>
                <div className="k">{st.k}</div>
                {k <= step ? <div className="v">{summary(st.id, person)}</div> : <span className="sk" style={{ width: `${[48, 70, 56, 44][k]}%` }} />}
              </>
            )
            return (
              <li key={st.id} className={`ent ${cls}${k === fresh ? ' fresh' : ''}`}>
                <span className="ic">
                  <StepIcon id={st.id} />
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

type StepProps = { person: Person; setPerson: Props['setPerson'] }

function InviteStep({ person, setPerson, invite, toast }: StepProps & { invite: Props['invite']; toast: Props['toast'] }) {
  const [tab, setTab] = useState<'email' | 'qr'>('email')
  const [email, setEmail] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const t = person.together

  useEffect(() => {
    if (tab === 'qr' && !qr) QRCode.toDataURL('https://' + JOIN, { width: 352, margin: 0, color: { dark: '#171C24', light: '#FFFFFF' } }).then(setQr, () => setQr(''))
  }, [tab, qr])

  const send = () => {
    const v = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(v)) {
      toast('Enter a full email address')
      return
    }
    const name = v.split('@')[0].replace(/[._\d]+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase()) || 'Friend'
    invite(name)
    setEmail('')
    toast('Invite sent to ' + v)
  }

  return (
    <>
      <div className="rows">
        <button className="rowopt" aria-pressed={t === false} onClick={() => setPerson((p) => ({ ...p, together: false }))}>
          <span className="ind" />
          <span className="t">
            <b>On my own</b>
            <small>Just me for now. I can invite people later.</small>
          </span>
        </button>
        <button className="rowopt" aria-pressed={t === true} onClick={() => setPerson((p) => ({ ...p, together: true }))}>
          <span className="ind" />
          <span className="t">
            <b>Together</b>
            <small>With a partner, roommates or friends</small>
          </span>
        </button>
      </div>
      {t && (
        <div className="board">
          <div className="seats">
            <div className="seat">
              <div className="av" style={{ background: 'var(--accent)' }}>
                Y
              </div>
              <b>You</b>
              <small>answering</small>
            </div>
            {person.mates.map((m) => (
              <div className="seat" key={m.name}>
                <div className="av" style={{ background: m.color }}>
                  {m.name[0].toUpperCase()}
                </div>
                <b>{m.name}</b>
                <small className={m.status === 'Done' ? 'ok' : ''}>{m.status.toLowerCase()}</small>
              </div>
            ))}
            {person.mates.length < 3 && (
              <div className="seat">
                <div className="empty">+</div>
                <b style={{ color: 'var(--faint)' }}>Invite</b>
                <small>&nbsp;</small>
              </div>
            )}
          </div>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'email'} onClick={() => setTab('email')}>
              Email
            </button>
            <button role="tab" aria-selected={tab === 'qr'} onClick={() => setTab('qr')}>
              QR code
            </button>
          </div>
          {tab === 'email' ? (
            <div className="inl">
              <input
                className="input"
                type="email"
                placeholder="name@email.com"
                aria-label="Email to invite"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    send()
                  }
                }}
              />
              <button className="btn pri sm" onClick={send}>
                Send invite
              </button>
            </div>
          ) : (
            <>
              <div className="qrcard">
                <div className="qm">
                  <Logo />
                  Reach NYC
                </div>
                <div id="qr" role="img" aria-label="QR code to join your search">
                  {qr ? <img src={qr} alt="" /> : qr === '' ? <small>QR code unavailable</small> : null}
                </div>
                <b>Join my search</b>
                <small>{JOIN}</small>
              </div>
              <p className="note" style={{ marginTop: -8 }}>
                Have them scan it, or screenshot the card and text it.
              </p>
              <button
                className="demo"
                onClick={() => {
                  invite(['Sam', 'Jordan', 'Priya'][person.mates.length % 3])
                  toast('Someone scanned your code')
                }}
              >
                Prototype: simulate a friend scanning
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
