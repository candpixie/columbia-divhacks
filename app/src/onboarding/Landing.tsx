import { useEffect } from 'react'
import { BOROUGH_PATHS } from './boroughPaths'
import { STEPS } from './constants'
import { Mark } from './icons'

export function Landing({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        onStart()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onStart])

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
        <h1>
          Welcome to Reach NYC. <em>Let's find your place.</em>
        </h1>
        <p>
          Answer <b>{STEPS.length}</b> quick questions. Reach maps the parts of the city that fit your budget, your commute and what you care about.
        </p>
        <button className="go" onClick={onStart}>
          Get started{' '}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </button>
      </div>
    </section>
  )
}
