import type { Neighborhood } from '../types'
import type { CellResult } from '../score'

type Props = { hood: Neighborhood; result: CellResult; onClose: () => void }

const STATUS_TEXT = { green: 'Fits everything', yellow: 'Close', gray: 'Out of range', neutral: '' }

export function CellDetail({ hood, result, onClose }: Props) {
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
      {result.status !== 'neutral' && <span className={`ms-status ${result.status}`}>{STATUS_TEXT[result.status]}</span>}

      <dl className="ms-dl">
        {result.commutes.map((c, i) => (
          <div key={i}>
            <dt>{c.name || 'Place'}</dt>
            <dd>{c.minutes == null ? '…' : Number.isFinite(c.minutes) ? `${Math.round(c.minutes)} min` : '2 h+'}</dd>
          </div>
        ))}
        <div>
          <dt>1BR rent{hood.rentEstimated ? ' (borough estimate)' : ''}</dt>
          <dd>${Math.round(result.rent).toLocaleString()}</dd>
        </div>
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
              <li key={x.what}>
                <b>{x.fix}</b>
                <span className="note">{x.what}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
