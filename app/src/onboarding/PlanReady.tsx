import { useEffect, useRef } from 'react'
import type { Person } from '../types'
import { FACTOR_LABEL, money, type StepId } from './constants'
import { summary, type Answers } from './summary'
import { Mark, StepIcon } from './icons'

type Props = { person: Person; celebrate: boolean; onOpenMap: () => void; onEdit: (step: number) => void }

const CARD_ROWS: [StepId, string][] = [
  ['budget', 'Budget'],
  ['places', 'Your places'],
  ['rank', 'Priorities'],
]

function Card({ name, color, d, you }: { name: string; color: string; d: Answers; you?: boolean }) {
  return (
    <article className="pc">
      <div className="hd">
        <div className="av" style={{ background: color }}>
          {name[0]}
        </div>
        <div>
          <b>{you ? 'You' : name}</b>
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
              <div className="v">{summary(id, d)}</div>
            </div>
          </li>
        ))}
      </ol>
    </article>
  )
}

export function PlanReady({ person, celebrate, onOpenMap, onEdit }: Props) {
  const mates = person.mates
  const done = mates.filter((m) => m.data && m.status === 'Done')
  const me: Answers = person
  const lead = !person.together
    ? "Here's what Reach will search for. Your map shows the neighborhoods that fit."
    : !mates.length
      ? "Here's your part. Invite someone from your map and their answers will appear next to yours."
      : done.length
        ? `${done.map((m) => m.name).join(' and ')} finished too, so your map shows places that work for all of you.`
        : `We'll add ${mates.map((m) => m.name).join(' and ')} as soon as they finish. You can open your map now.`

  const all: Answers[] = [me, ...done.map((m) => m.data!)]
  const total = all.reduce((a, d) => a + (d.budget ?? 0), 0)
  const tops = [...new Set(all.map((d) => d.ranking[0]))]

  return (
    <section className="plan">
      <Mark />
      <div className="plan-in">
        <h1>Your plan is ready.</h1>
        <p className="lead">{lead}</p>
        <div className={`cards${!person.together || !mates.length ? ' solo' : ''}`}>
          <Card name="You" color="var(--accent)" d={me} you />
          {person.together &&
            mates.map((m) =>
              m.status === 'Done' ? (
                <Card key={m.name} name={m.name} color={m.color} d={m.data!} />
              ) : (
                <article className="pc wait" key={m.name}>
                  <div className="av" style={{ background: m.color, width: 40, height: 40 }}>
                    {m.name[0]}
                  </div>
                  <div className="dots">
                    <i />
                    <i />
                    <i />
                  </div>
                  <p>
                    <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{m.name}</b> is {m.status === 'Invited' ? 'yet to open the invite' : 'still answering'}. Their plan appears here when they finish.
                  </p>
                </article>
              ),
            )}
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
          Open your map{' '}
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
