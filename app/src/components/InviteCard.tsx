import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { roomUrl } from '../room'
import { MAX_PEOPLE } from '../onboarding/constants'
import { Logo } from '../onboarding/icons'
import type { Person } from '../types'

type Props = { code: string; people: Person[]; meId: string; hostName: string; toast: (m: string) => void }

// QR code + link for a group room, and who's in it so far
export function InviteCard({ code, people, meId, hostName, toast }: Props) {
  const url = roomUrl(code)
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(url, { width: 352, margin: 0, color: { dark: '#171C24', light: '#FFFFFF' } }).then(setQr, () => setQr(''))
  }, [url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied')
    } catch {
      toast(url)
    }
  }

  return (
    <div className="board">
      <div className="seats">
        {people.map((m) => (
          <div className="seat" key={m.id}>
            <div className="av" style={{ background: m.color }}>
              {(m.name || '?')[0].toUpperCase()}
            </div>
            <b>{m.id === meId ? 'You' : m.name || 'Someone'}</b>
            <small className={m.done ? 'ok' : ''}>{m.done ? 'done' : 'answering'}</small>
          </div>
        ))}
        {people.length < MAX_PEOPLE && (
          <div className="seat">
            <div className="empty">+</div>
            <b style={{ color: 'var(--faint)' }}>Invite</b>
            <small>&nbsp;</small>
          </div>
        )}
      </div>
      <div className="qrcard">
        <div className="qm">
          <Logo />
          Rentdezvous
        </div>
        <div id="qr" role="img" aria-label="QR code to join this search">
          {qr ? <img src={qr} alt="" /> : qr === '' ? <small>QR code unavailable</small> : null}
        </div>
        <b>Join {hostName ? `${hostName}'s` : 'our'} search</b>
        <small>Code {code}</small>
      </div>
      <div className="inl">
        <input className="input" readOnly value={url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button className="btn pri sm" onClick={copy}>
          Copy link
        </button>
      </div>
      <p className="note">Everyone scans or opens the link, answers the same questions, and the map shows places that work for all of you.</p>
    </div>
  )
}
