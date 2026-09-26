import { useMemo, useState } from 'react'
import { latLngToCell } from 'h3-js'
import type { Data } from '../data'
import { coordKey, located, type Person } from '../types'
import type { SetPerson } from '../fields/Fields'
import { decodeVisited, encodeVisited, KIND_ICON, type ExplorePlace, type Suggestion } from '../passport'

type Props = {
  data: Data
  me: Person
  setMe: SetPerson
  group: Person[] // everyone in the room (just you when solo)
  places: ExplorePlace[]
  stampMode: boolean
  setStampMode: (b: boolean) => void
  suggestions: Suggestion[]
  origin: string | null
  setOrigin: (key: string) => void
  toast: (m: string) => void
}

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']
const short = (n: string) => n.split(/[-(]/)[0].trim()

export function ExplorePanel({ data, me, setMe, group, stampMode, setStampMode, suggestions, origin, setOrigin, toast }: Props) {
  const [note, setNote] = useState('')
  const total = data.cells.length
  const visitedOf = (p: Person) => decodeVisited(p.visited, total)
  const ntasOf = (s: Set<number>) => new Set([...s].map((i) => data.cells[i].nta))
  const mine = visitedOf(me)
  const myNtas = ntasOf(mine)
  const totalNtas = Object.keys(data.neighborhoods).length
  const pct = (100 * mine.size) / total

  const stamp = (cells: number[]) =>
    setMe((p) => {
      const s = decodeVisited(p.visited, total)
      cells.forEach((c) => s.add(c))
      return { ...p, visited: encodeVisited(s, total) }
    })

  const cellFor = (lat: number, lng: number): number | null => {
    const h = latLngToCell(lat, lng, 8)
    const i = data.cells.findIndex((c) => c.h3 === h)
    return i >= 0 ? i : null
  }

  async function importPhotos(files: FileList | null) {
    if (!files?.length) return
    setNote(`Reading ${files.length} photos on your device…`)
    const exifr = (await import('exifr')).default
    const cells: number[] = []
    let located = 0
    for (const f of Array.from(files)) {
      try {
        const g = await exifr.gps(f)
        if (g?.latitude) {
          located++
          const i = cellFor(g.latitude, g.longitude)
          if (i != null) cells.push(i)
        }
      } catch {
        /* no GPS in this file */
      }
    }
    stamp(cells)
    setNote(`${files.length} photos · ${located} had a location · ${new Set(cells).size} places in NYC stamped. Nothing was uploaded.`)
  }

  function imHere() {
    if (!navigator.geolocation) return setNote("This browser can't share location. Tap the map instead.")
    setNote('Finding you, once. Not tracked.')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const i = cellFor(pos.coords.latitude, pos.coords.longitude)
        if (i == null) return setNote("You're outside the NYC map right now.")
        stamp([i])
        setNote(`Stamped ${short(data.neighborhoods[data.cells[i].nta]?.name ?? 'this spot')}.`)
      },
      () => setNote('Location permission was denied. Tap the map to stamp instead.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const board = useMemo(
    () =>
      group
        .map((p) => ({ p, ntas: ntasOf(decodeVisited(p.visited, total)) }))
        .sort((a, b) => b.ntas.size - a.ntas.size),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, total],
  )

  // Conversation starters: places only one person in the room has explored
  const starters = useMemo(() => {
    const out: { who: Person; name: string }[] = []
    const seen = new Set<string>()
    for (const { p, ntas } of board) {
      if (p.id === me.id) continue
      for (const n of ntas) {
        const name = short(data.neighborhoods[n]?.name ?? n)
        const others = board.filter((b) => b.p.id !== p.id && [...b.ntas].some((x) => short(data.neighborhoods[x]?.name ?? x) === name))
        if (!others.length && !seen.has(name)) {
          seen.add(name)
          out.push({ who: p, name })
        }
        if (out.length >= 3) return out
      }
    }
    return out
  }, [board, me.id, data])

  const origins = group.flatMap((p) => located(p.places).map((pl) => ({ key: coordKey(pl), label: `${p.id === me.id ? 'Your' : `${p.name || 'Someone'}'s`} ${pl.name || 'place'}` })))
  const solo = group.length <= 1

  return (
    <>
      <section className="ms-sec">
        <div className="xp-stats">
          <div><b>{pct > 0 && pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</b><span>of NYC explored</span></div>
          <div><b>{myNtas.size}<small>/{totalNtas}</small></b><span>neighborhood stamps</span></div>
        </div>
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">Add stamps</h2>
        <div className="xp-actions">
          <label className="xp-act">
            <span aria-hidden>📷</span>Photos
            <input type="file" accept="image/*" multiple hidden onChange={(e) => importPhotos(e.target.files)} />
          </label>
          <button className="xp-act" onClick={imHere}><span aria-hidden>📍</span>I'm here</button>
          <button className="xp-act" aria-pressed={stampMode} onClick={() => setStampMode(!stampMode)}>
            <span aria-hidden>👆</span>{stampMode ? 'Tapping on' : 'Tap map'}
          </button>
        </div>
        <p className="note">{note || 'No background tracking. Photo locations are read on your device and never uploaded.'}</p>
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">{solo ? 'I have 30 minutes' : 'We have 30 minutes'}</h2>
        {origins.length ? (
          <select className="input xp-select" value={origin ?? ''} onChange={(e) => setOrigin(e.target.value)} aria-label="Starting from">
            {origins.map((o) => <option key={o.key} value={o.key}>From {o.label}</option>)}
          </select>
        ) : (
          <p className="note">Add a place in Find a place to get ideas from there.</p>
        )}
        <ol className="xp-ideas">
          {suggestions.map((s) => (
            <li key={s.nta}>
              <b>{s.name}</b>
              <span className="note">
                {s.minutes < 3 ? 'walking distance' : `${s.minutes} min`} · {solo ? 'never stamped' : 'none of you have been'}
              </span>
              {s.place && <span className="xp-place">{KIND_ICON[s.place.kind] ?? '📍'} {s.place.name}</span>}
            </li>
          ))}
          {origin && !suggestions.length && <p className="note">Travel times are loading, or you've explored everything within 30 minutes.</p>}
        </ol>
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">{solo ? 'Your passport' : 'Room leaderboard'}</h2>
        <ol className="xp-board">
          {board.map(({ p, ntas }, k) => (
            <li key={p.id}>
              <span className="xp-rank">{k + 1}</span>
              <i className="ms-dot" style={{ background: p.color }} />
              <span className="xp-who">{p.id === me.id ? 'You' : p.name || 'Someone'}</span>
              <span className="note">{ntas.size} stamps</span>
            </li>
          ))}
        </ol>
        {solo && (
          <button className="edit-link" onClick={() => toast('Tap "Search with others" at the top to invite friends, then compare passports')}>
            Compare with friends →
          </button>
        )}
        {starters.map((s) => (
          <p key={s.name} className="xp-starter" style={{ borderLeftColor: s.who.color }}>
            Only <b>{s.who.name || 'someone'}</b> has been to <b>{s.name}</b>. Ask them what's good there.
          </p>
        ))}
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">Stamps by borough</h2>
        {BOROUGHS.map((b) => {
          const all = Object.values(data.neighborhoods).filter((n) => n.borough === b).length
          const got = [...myNtas].filter((n) => data.neighborhoods[n]?.borough === b)
          return (
            <div key={b} className="xp-boro">
              <div><span>{b}</span><span className="note">{got.length}/{all}</span></div>
              <i><i style={{ width: `${(100 * got.length) / Math.max(1, all)}%` }} /></i>
              {got.length > 0 && <p>{got.map((n) => short(data.neighborhoods[n]?.name ?? n)).sort().join(' · ')}</p>}
            </div>
          )
        })}
      </section>
    </>
  )
}
