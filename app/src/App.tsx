import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadData, type Data } from './data'
import { scoreCell } from './score'
import { travelTimesTo } from './traveltime'
import { located, type Mate, type Person, type TimesState } from './types'
import { MapView } from './components/MapView'
import { Panel } from './components/Panel'
import { CellDetail } from './components/CellDetail'
import type { SetPerson } from './fields/Fields'
import { Landing } from './onboarding/Landing'
import { Wizard } from './onboarding/Wizard'
import { PlanReady } from './onboarding/PlanReady'
import { INITIAL_PERSON, MATE_COLORS, mateProfile } from './onboarding/constants'

type View = 'landing' | 'wizard' | 'plan' | 'map'

export default function App() {
  const [view, setView] = useState<View>('landing')
  const [step, setStep] = useState(0)
  const [celebrate, setCelebrate] = useState(false)
  const [person, setPerson] = useState<Person>(INITIAL_PERSON)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number>(undefined)

  const toast = useCallback((m: string) => {
    setToastMsg(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2400)
  }, [])

  // Prototype: an invited friend opens the link, answers, then finishes (simulated, as in the Reach NYC prototype)
  const invite = useCallback(
    (name: string) => {
      setPerson((p) => {
        if (p.mates.length >= 3) {
          toast('You can search with up to 3 people')
          return p
        }
        const mate: Mate = { name: name.split(' ')[0], color: MATE_COLORS[p.mates.length % 3], status: 'Invited', data: null }
        const setMate = (patch: Partial<Mate>) =>
          setPerson((q) => ({ ...q, mates: q.mates.map((m) => (m.name === mate.name ? { ...m, ...patch } : m)) }))
        setTimeout(() => setMate({ status: 'Answering' }), 1800)
        setTimeout(() => {
          setMate({ status: 'Done', data: mateProfile() })
          toast(`${mate.name} finished their answers`)
        }, 5200)
        return { ...p, mates: [...p.mates, mate] }
      })
    },
    [toast],
  )

  const goStep = (i: number) => {
    setStep(i)
    setView('wizard')
  }

  return (
    <>
      {view === 'landing' && <Landing onStart={() => goStep(0)} />}
      {view === 'wizard' && (
        <Wizard
          person={person}
          setPerson={setPerson}
          step={step}
          setStep={setStep}
          onBackToLanding={() => setView('landing')}
          onFinish={() => {
            setCelebrate(true)
            setView('plan')
          }}
          invite={invite}
          toast={toast}
        />
      )}
      {view === 'plan' && <PlanReady person={person} celebrate={celebrate} onOpenMap={() => setView('map')} onEdit={goStep} />}
      {view === 'map' && <MapScreen person={person} setPerson={setPerson} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  )
}

function MapScreen({ person, setPerson }: { person: Person; setPerson: SetPerson }) {
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [times, setTimes] = useState<TimesState>({})
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    loadData().then(setData, (e) => setLoadError(String(e)))
  }, [])

  const places = useMemo(() => located(person.places), [person.places])

  // fetch transit times for any place (or moved place) we don't have yet; keyed by id + coordinates
  const timeKey = (p: (typeof places)[number]) => `${p.id}@${p.lat},${p.lng}`
  useEffect(() => {
    if (!data) return
    for (const pl of places) {
      const key = timeKey(pl)
      if (times[key]) continue
      setTimes((t) => ({ ...t, [key]: 'loading' }))
      travelTimesTo(pl.lat, pl.lng, data.cells).then(
        (tt) => setTimes((t) => ({ ...t, [key]: tt })),
        (e) => setTimes((t) => ({ ...t, [key]: { error: e.message } })),
      )
    }
  }, [data, places, times])

  // scoring looks times up by place id
  const timesById = useMemo(() => Object.fromEntries(places.map((p) => [p.id, times[timeKey(p)]]).filter(([, v]) => v)), [places, times])

  const results = useMemo(() => (data ? data.cells.map((_, i) => scoreCell(data, i, person, timesById)) : []), [data, person, timesById])

  const counts = useMemo(() => {
    const c = { green: 0, yellow: 0, gray: 0 }
    for (const r of results) if (r.status !== 'neutral') c[r.status]++
    return c
  }, [results])

  const loading = places.some((p) => timesById[p.id] === 'loading')
  const onSelect = useCallback((i: number | null) => setSelected(i), [])

  if (loadError) return <div className="fatal">Couldn't load map data: {loadError}</div>
  if (!data) return <div className="fatal">Loading…</div>

  return (
    <div className="ms-layout">
      <Panel person={person} setPerson={setPerson} times={timesById} counts={counts} />
      <main className="ms-map-wrap">
        <MapView cells={data.cells} results={results} places={places} selected={selected} loading={loading} onSelect={onSelect} />
        {selected != null && (
          <CellDetail hood={data.neighborhoods[data.cells[selected].nta]} result={results[selected]} onClose={() => setSelected(null)} />
        )}
      </main>
    </div>
  )
}
