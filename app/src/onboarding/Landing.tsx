import { useEffect } from 'react'
import { BOROUGH_PATHS } from './boroughPaths'
import { MAX_PEOPLE } from './constants'
import { Mark } from './icons'

// Someone opening an invite link: whose search it is, and their name to join with
export type JoinInfo = { hostName: string; count: number; loaded: boolean; name: string; setName: (n: string) => void }

type Props = { onStart: () => void; questions: number; join?: JoinInfo }

export function Landing({ onStart, questions, join }: Props) {
  const ended = join != null && join.loaded && join.count === 0
  const full = join != null && join.count >= MAX_PEOPLE
  const blocked = join != null && (!join.loaded || full || ended || !join.name.trim())
  const start = () => {
    if (!blocked) onStart()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        start()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <section className="landing">
      <svg className="nyc" viewBox="-10 -10 620 614.2" aria-hidden="true">
        {BOROUGH_PATHS.map((b) => (
          <path key={b.name} className="boro" d={b.d}>
            <title>{b.name}</title>
          </path>
        ))}
        <circle className="reach" cx="302" cy="270" r="60" />
        <circle className="reach r2" cx="302" cy="270" r="120" />
        <circle className="here" cx="302" cy="270" r="5" />
      </svg>
      <Mark />
      <div className="hero">
        {join ? (
          <>
            <h1>
              {ended ? (
                'This search link has expired.'
              ) : (
                <>
                  Join {join.hostName || 'your group'}'s search. <em>Let's find a place that works for everyone.</em>
                </>
              )}
            </h1>
            <p>
              {ended
                ? 'Ask for a new link, or start your own search.'
                : full
                  ? `This group already has ${MAX_PEOPLE} people.`
                  : `Answer ${questions} quick questions. Rentdezvous maps the parts of the city that fit everyone's budget, commute and priorities.`}
            </p>
            {!ended && !full && (
              <div className="join-name">
                <input className="input" value={join.name} placeholder="Your first name" aria-label="Your name" autoFocus onChange={(e) => join.setName(e.target.value)} />
              </div>
            )}
          </>
        ) : (
          <>
            <h1>
              Welcome to Rentdezvous. <em>Let's find your place.</em>
            </h1>
            <p>
              Answer <b>{questions}</b> quick questions. Rentdezvous maps the parts of the city that fit your budget, your commute and what you care about.
            </p>
          </>
        )}
        {!ended && !full && (
          <button className="go" onClick={start} disabled={blocked}>
            {join ? 'Join' : 'Get started'}{' '}
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
        )}
      </div>
    </section>
  )
}
