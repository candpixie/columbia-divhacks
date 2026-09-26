import type { Neighborhood } from '../types'
import { bedsFor, type CellResult } from '../score'

type Props = { hood: Neighborhood; result: CellResult; groupSize: number; viewName: string | null; onClose: () => void }

const STATUS_TEXT = { green: 'Fits everything', yellow: 'Close', gray: 'Out of range', neutral: '' }
const BEDS_LABEL = { studio: 'Studio', '1br': '1BR', '2br': '2BR', '3br': '3BR' }
const fmtMin = (m: number | null) => (m == null ? '…' : Number.isFinite(m) ? `${Math.round(m)} min` : '2 h+')

export function CellDetail({ hood, result, groupSize, viewName, onClose }: Props) {
  const group = groupSize > 1
  const beds = BEDS_LABEL[bedsFor(groupSize)]
  return (
    <div className="ms-detail" role="dialog" aria-label={hood.name}>
      <div className="ms-detail-head">
        <div>
          <h3>{hood.name}</h3>
          <span className="note">{hood.borough}</span>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {result.status !== 'neutral' && (
        <span className={`ms-status ${result.status}`}>
          {STATUS_TEXT[result.status]}
          {viewName ? ` for ${viewName}` : group ? ' for everyone' : ''}
        </span>
      )}

      <dl className="ms-dl">
        {result.people.map((pr) =>
          pr.commutes.map((c, i) => (
            <div key={pr.person.id + i}>
              <dt>
                {group && <i className="ms-dot" style={{ background: pr.person.color }} />}
                {group ? `${pr.person.name || 'Someone'} · ` : ''}
                {c.name || 'Place'}
              </dt>
              <dd className={c.minutes != null && c.minutes > c.maxMin ? 'ms-over' : ''}>{fmtMin(c.minutes)}</dd>
            </div>
          )),
        )}
        <div>
          <dt>
            {beds} rent{hood.rentEstimated ? ' (borough estimate)' : ''}
          </dt>
          <dd>${Math.round(result.rent).toLocaleString()}</dd>
        </div>
        {group && (
          <div>
            <dt>Each person's share</dt>
            <dd>${Math.round(result.share).toLocaleString()}</dd>
          </div>
        )}
        <div>
          <dt>Violent crime</dt>
          <dd>{hood.violentPer1k.toFixed(1)} per 1k residents</dd>
        </div>
      </dl>

      {result.issues.length > 0 && (
        <>
          <h4 className="ms-h">To make this fit</h4>
          <ul className="ms-fixes">
            {result.issues.map((x) => (
              <li key={x.what} style={{ borderLeftColor: group ? result.people.find((p) => p.person.id === x.personId)?.person.color : undefined }}>
                <b>{x.fix[0].toUpperCase() + x.fix.slice(1)}</b>
                <span className="note">{x.what}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
