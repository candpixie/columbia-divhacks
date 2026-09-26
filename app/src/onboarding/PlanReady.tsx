import { useEffect, useRef } from 'react'
import type { Person } from '../types'
import { FACTOR_LABEL, money, type StepId } from './constants'
import { summary } from './summary'
import { Mark, StepIcon } from './icons'

type Props = { me: Person; people: Person[]; together: boolean; celebrate: boolean; onOpenMap: () => void; onEdit: (step: number) => void }

const CARD_ROWS: [Exclude<StepId, 'invite'>, string][] = [
  ['budget', 'Budget'],
  ['places', 'Your places'],
  ['rank', 'Priorities'],
]

function Card({ person, you }: { person: Person; you?: boolean }) {
  return (
    <article className="pc">
      <div className="hd">
        <div className="av" style={{ background: person.color }}>
          {(person.name || 'Y')[0].toUpperCase()}
        </div>
        <div>
          <b>{you ? (person.name ? `${person.name} (you)` : 'You') : person.name || 'Someone'}</b>
          <span>{you ? 'Finished just now' : 'Finished their answers'}</span>
        </div>
        <span className="badge">✓ done</span>
      </div>
      <ol className="tl">
        {CARD_ROWS.map(([id, k]) => (
          <li className="ent set" key={id}>
            <span className="ic">
              <StepIcon id={id} />
            </span>
            <div>
              <div className="k">{k}</div>
              <div className="v">{summary(id, person)}</div>
            </div>
          </li>
        ))}
      </ol>
    </article>
  )
}

export function PlanReady({ me, people, together, celebrate, onOpenMap, onEdit }: Props) {
  const others = people.filter((p) => p.id !== me.id)
  const done = others.filter((p) => p.done)
  const waiting = others.filter((p) => !p.done)
  const names = (ps: Person[]) => ps.map((p) => p.name || 'someone').join(' and ')
  const lead = !together
    ? "Here's what Rentdezvous will search for. Your map shows the neighborhoods that fit."
    : !others.length
      ? "Here's your part. Share your invite from the map and everyone's answers will appear next to yours."
      : waiting.length
        ? `We'll add ${names(waiting)} as soon as they finish. You can open your map now.`
        : `${names(done)} finished too, so your map shows places that work for all of you.`

  const all = [me, ...done]
  const total = all.reduce((a, d) => a + (d.budget ?? 0), 0)
  const tops = [...new Set(all.map((d) => d.ranking[0]))]

  return (
    <section className="plan">
      <Mark />
      <div className="plan-in">
        <h1>Your plan is ready.</h1>
        <p className="lead">{lead}</p>
        <div className={`cards${!others.length ? ' solo' : ''}`}>
          <Card person={me} you />
          {done.map((p) => (
            <Card key={p.id} person={p} />
          ))}
          {waiting.map((p) => (
            <article className="pc wait" key={p.id}>
              <div className="av" style={{ background: p.color, width: 40, height: 40 }}>
                {(p.name || '?')[0].toUpperCase()}
              </div>
              <div className="dots">
                <i />
                <i />
                <i />
              </div>
              <p>
                <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{p.name || 'Someone'}</b> is still answering. Their plan appears here when they finish.
              </p>
            </article>
          ))}
        </div>
        {done.length > 0 && (
          <div className="lineup two">
            <div>
              <small>Combined budget</small>
              <b>Up to {money(total)} /mo</b>
            </div>
            <div>
              <small>Top priority</small>
              <b>{tops.length === 1 ? `${FACTOR_LABEL[tops[0]]} for everyone` : tops.map((f) => FACTOR_LABEL[f]).join(' vs ')}</b>
            </div>
          </div>
        )}
        <button className="go open" onClick={onOpenMap}>
          Open {others.length ? 'the group' : 'your'} map{' '}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </button>
        <button className="edit-link" onClick={() => onEdit(0)}>
          Edit my answers
        </button>
      </div>
      {celebrate && <Confetti />}
    </section>
  )
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) return
    const c = ref.current!
    const x = c.getContext('2d')!
    const dpr = devicePixelRatio
    const W = (c.width = innerWidth * dpr)
    const H = (c.height = innerHeight * dpr)
    const cols = ['#2F5BD3', '#86A4F2', '#D9480F', '#1F7A4C', '#F2B705', '#AEB1B6']
    const ps = Array.from({ length: 110 }, () => ({
      x: W * (0.2 + Math.random() * 0.6),
      y: -Math.random() * H * 0.3,
      vx: (Math.random() - 0.5) * 3 * dpr,
      vy: (2 + Math.random() * 3) * dpr,
      r: Math.random() * 6.3,
      vr: (Math.random() - 0.5) * 0.2,
      w: (5 + Math.random() * 5) * dpr,
      h: (3 + Math.random() * 3) * dpr,
      c: cols[(Math.random() * cols.length) | 0],
    }))
    const t0 = performance.now()
    let raf = 0
    const f = (t: number) => {
      const e = t - t0
      x.clearRect(0, 0, W, H)
      x.globalAlpha = Math.max(0, 1 - e / 3200)
      for (const p of ps) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.03 * dpr
        p.r += p.vr
        x.save()
        x.translate(p.x, p.y)
        x.rotate(p.r)
        x.fillStyle = p.c
        x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        x.restore()
      }
      if (e < 3200) raf = requestAnimationFrame(f)
      else c.hidden = true
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas id="confetti" ref={ref} />
}
