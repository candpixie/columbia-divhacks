import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadData, type Data } from './data'
import { safetyPref, scoreCell } from './score'
import { travelTimesTo } from './traveltime'
import { coordKey, located, type Person, type TimesState, type TravelTimes } from './types'
import { MapView, type FocusRow, type Pin } from './components/MapView'
import { Panel } from './components/Panel'
import { CellDetail } from './components/CellDetail'
import type { SetPerson } from './fields/Fields'
import { Landing } from './onboarding/Landing'
import { Wizard } from './onboarding/Wizard'
import { PlanReady } from './onboarding/PlanReady'
import { FACTOR_LABEL, PERSON_COLORS, hue, newPerson, type StepId } from './onboarding/constants'
import { joinRoom, newRoomCode, roomFromUrl, useRoom, writePerson, writeTimes } from './room'

type View = 'landing' | 'wizard' | 'plan' | 'map'

const HOST_STEPS: StepId[] = ['budget', 'places', 'rank', 'invite']
const JOINER_STEPS: StepId[] = ['budget', 'places', 'rank']

// Remember who you are in each room, so a refresh (or reopening the link) doesn't make you a new person
const saved = (code: string): Person | null => {
  try {
    return JSON.parse(localStorage.getItem(`rentdezvous:${code}`) ?? 'null')
  } catch {
    return null
  }
}
const save = (code: string, p: Person) => {
  try {
    localStorage.setItem(`rentdezvous:${code}`, JSON.stringify(p))
  } catch {
    /* private mode: identity just won't survive a refresh */
  }
}

const joinCode = roomFromUrl()

export default function App() {
  const restored = joinCode ? saved(joinCode) : null
  const [me, setMe] = useState<Person>(() => restored ?? newPerson())
  const [roomCode, setRoomCode] = useState<string | null>(joinCode)
  const [joined, setJoined] = useState(restored != null)
  const [together, setTogether] = useState<boolean | null>(joinCode ? true : null)
  const [view, setView] = useState<View>(restored ? (restored.done ? 'map' : 'wizard') : 'landing')
  const [step, setStep] = useState(0)
  const [celebrate, setCelebrate] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number>(undefined)
  const room = useRoom(roomCode)
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    loadData().then(setData, (e) => setLoadError(String(e)))
  }, [])

  // Share travel times for my own places as soon as I pick them, whatever screen I'm on,
  // so everyone else's map fills in without waiting for me to open it
  const sharedTimes = useRef(new Set<string>())
  useEffect(() => {
    if (!data || !roomCode || !joined) return
    for (const pl of located(me.places)) {
      const key = coordKey(pl)
      if (room.times[key] || sharedTimes.current.has(key)) continue
      sharedTimes.current.add(key)
      travelTimesTo(pl.lat, pl.lng, data.cells)
        .then((tt) => writeTimes(roomCode, key, tt))
        .catch(() => sharedTimes.current.delete(key))
    }
  }, [data, roomCode, joined, me.places, room.times])
  const isJoiner = joinCode != null && room.people[0]?.id !== me.id
  const steps = isJoiner ? JOINER_STEPS : HOST_STEPS

  const toast = useCallback((m: string) => {
    setToastMsg(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2400)
  }, [])

  useEffect(() => {
    if (room.error) toast(`Group sync problem: ${room.error}`)
  }, [room.error, toast])

  // Keep my entry in the room up to date (and remembered on this device)
  useEffect(() => {
    if (!roomCode || !joined) return
    save(roomCode, me)
    const t = setTimeout(() => writePerson(roomCode, me).catch(() => toast("Couldn't sync your answers")), 250)
    return () => clearTimeout(t)
  }, [me, roomCode, joined, toast])

  // Everyone in the room, with my own entry taken from local state so my edits show instantly
  const people = useMemo(() => {
    if (!roomCode || !joined) return [me]
    const others = room.people.filter((p) => p.id !== me.id)
    const mine = room.people.findIndex((p) => p.id === me.id)
    const list = [...others]
    list.splice(mine < 0 ? list.length : mine, 0, me)
    return list
  }, [room.people, me, roomCode, joined])

  const startRoom = useCallback(() => {
    const code = newRoomCode()
    setRoomCode(code)
    setJoined(true)
    history.replaceState(null, '', `?room=${code}`)
    joinRoom(code, me).catch(() => toast("Couldn't start the group"))
  }, [me, toast])

  const joinAsGuest = () => {
    if (!roomCode) return
    const color = PERSON_COLORS.find((c) => !room.people.some((p) => p.color === c)) ?? PERSON_COLORS[room.people.length % PERSON_COLORS.length]
    const p = { ...me, color, name: me.name.trim() }
    setMe(p)
    setJoined(true)
    joinRoom(roomCode, p).catch(() => toast("Couldn't join the group"))
    goStep(0)
  }

  const goStep = (i: number) => {
    setStep(i)
    setView('wizard')
  }

  const finish = () => {
    setMe((p) => ({ ...p, done: true }))
    setCelebrate(true)
    setView('plan')
  }

  return (
    <>
      {view === 'landing' && (
        <Landing
          questions={steps.length}
          onStart={joinCode && !joined ? joinAsGuest : () => goStep(0)}
          join={
            joinCode && !joined
              ? { hostName: room.people[0]?.name ?? '', count: room.people.length, loaded: room.loaded, name: me.name, setName: (name) => setMe((p) => ({ ...p, name })) }
              : undefined
          }
        />
      )}
      {view === 'wizard' && (
        <Wizard
          me={me}
          setMe={setMe}
          steps={steps}
          step={Math.min(step, steps.length - 1)}
          setStep={setStep}
          onBackToLanding={() => setView('landing')}
          onFinish={finish}
          together={together}
          setTogether={setTogether}
          roomCode={roomCode}
          roomPeople={people}
          startRoom={startRoom}
          toast={toast}
        />
      )}
      {view === 'plan' && <PlanReady me={me} people={people} together={!!roomCode} celebrate={celebrate} onOpenMap={() => setView('map')} onEdit={goStep} />}
      {view === 'map' && (
        <MapScreen data={data} loadError={loadError} me={me} setMe={setMe} people={people} roomCode={roomCode} roomTimes={room.times} startRoom={startRoom} toast={toast} />
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  )
}

type MapScreenProps = {
  data: Data | null
  loadError: string | null
  me: Person
  setMe: SetPerson
  people: Person[]
  roomCode: string | null
  roomTimes: Record<string, TravelTimes>
  startRoom: () => void
  toast: (m: string) => void
}

const OTHERS_GRACE_MS = 5000 // give a place's owner time to share its travel times before fetching them ourselves

function MapScreen({ data, loadError, me, setMe, people, roomCode, roomTimes, startRoom, toast }: MapScreenProps) {
  const [localTimes, setLocalTimes] = useState<TimesState>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const shared = useRef(new Set<string>()) // travel times this device has already uploaded to the room

  // Who counts: everyone who has finished onboarding, plus me
  const group = useMemo(() => people.filter((p) => p.done || p.id === me.id), [people, me.id])
  const counted = useMemo(() => {
    const v = viewId && group.find((p) => p.id === viewId)
    return v ? [v] : group
  }, [group, viewId])

  // Every place anyone in the group needs travel times for
  const needed = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; mine: boolean }>()
    for (const p of group) for (const pl of located(p.places)) m.set(coordKey(pl), { lat: pl.lat, lng: pl.lng, mine: p.id === me.id || !!m.get(coordKey(pl))?.mine })
    return m
  }, [group, me.id])

  useEffect(() => {
    if (!data) return
    const timers: number[] = []
    for (const [key, pl] of needed) {
      if (roomTimes[key]) continue
      const have = localTimes[key]
      if (have instanceof Float32Array) {
        if (roomCode && !shared.current.has(key)) {
          shared.current.add(key) // share it with the group, once
          writeTimes(roomCode, key, have).catch(() => shared.current.delete(key))
        }
        continue
      }
      if (have) continue // loading or failed
      const fetchNow = () => {
        setLocalTimes((t) => (t[key] ? t : { ...t, [key]: 'loading' }))
        travelTimesTo(pl.lat, pl.lng, data.cells).then(
          (tt) => setLocalTimes((t) => ({ ...t, [key]: tt })),
          (e) => setLocalTimes((t) => ({ ...t, [key]: { error: e.message } })),
        )
      }
      if (pl.mine || !roomCode) fetchNow()
      else timers.push(window.setTimeout(fetchNow, OTHERS_GRACE_MS))
    }
    return () => timers.forEach(clearTimeout)
  }, [data, needed, roomTimes, localTimes, roomCode])

  const times: TimesState = useMemo(() => {
    const t: TimesState = { ...localTimes, ...roomTimes }
    for (const key of needed.keys()) if (!t[key]) t[key] = 'loading' // someone else's place, not shared yet
    return t
  }, [localTimes, roomTimes, needed])

  const results = useMemo(() => (data ? data.cells.map((_, i) => scoreCell(data, i, group, counted, times)) : []), [data, group, counted, times])

  const counts = useMemo(() => {
    const c = { green: 0, yellow: 0, gray: 0 }
    for (const r of results) if (r.status !== 'neutral') c[r.status]++
    return c
  }, [results])

  const pins: Pin[] = useMemo(
    () =>
      counted.flatMap((p) =>
        located(p.places).map((pl) => ({
          lat: pl.lat,
          lng: pl.lng,
          label: group.length > 1 ? `${p.id === me.id ? 'You' : p.name || 'Someone'} · ${pl.name || 'Place'}` : pl.name,
          color: group.length > 1 ? p.color : hue(pl.name),
        })),
      ),
    [counted, group.length, me.id],
  )

  // "Your top 3 here" on the focused hexagon, in my own priority order
  const focusRows = useMemo((): FocusRow[] | null => {
    if (!data || selected == null) return null
    const r = results[selected]
    const hood = data.neighborhoods[data.cells[selected].nta]
    const named = group.length > 1
    return me.ranking.slice(0, 3).map((f, i): FocusRow => {
      const row = (value: string, ok: boolean | null) => ({ rank: i + 1, label: FACTOR_LABEL[f], value, ok })
      if (f === 'commute') {
        const all = r.people.flatMap((pr) => pr.commutes.map((c) => ({ ...c, who: pr.person })))
        if (!all.length) return row('No places yet', null)
        if (all.some((c) => c.minutes == null)) return row('Loading…', null)
        const worst = all.reduce((a, c) => (c.minutes! / c.maxMin > a.minutes! / a.maxMin ? c : a))
        const mins = Number.isFinite(worst.minutes!) ? `${Math.round(worst.minutes!)} min` : '2 h+'
        const who = named ? `${worst.who.id === me.id ? 'You' : worst.who.name || 'Someone'}, ` : ''
        return row(`${who}${mins}${named ? '' : ` to ${worst.name || 'place'}`}`, all.every((c) => c.minutes! <= c.maxMin))
      }
      if (f === 'rent') {
        const budgeted = r.people.some((pr) => pr.person.budget != null)
        return row(named ? `$${Math.round(r.share).toLocaleString()} each` : `$${Math.round(r.rent).toLocaleString()}`, budgeted ? !r.issues.some((x) => x.factor === 'rent') : null)
      }
      const limited = r.people.some((pr) => safetyPref(pr.person) !== 'none')
      return row(`${hood.violentPer1k.toFixed(1)} violent / 1k`, limited ? !r.issues.some((x) => x.factor === 'safety') : null)
    })
  }, [data, selected, results, group.length, me.id, me.ranking])

  const loading = [...needed.keys()].some((k) => times[k] === 'loading')
  const onSelect = useCallback((i: number | null) => setSelected(i), [])
  const viewName = viewId ? (viewId === me.id ? 'you' : (group.find((p) => p.id === viewId)?.name ?? null)) : null

  if (loadError) return <div className="fatal">Couldn't load map data: {loadError}</div>
  if (!data) return <div className="fatal">Loading…</div>

  return (
    <div className="ms-layout">
      <Panel
        me={me}
        setMe={setMe}
        people={people}
        view={viewId}
        setView={setViewId}
        roomCode={roomCode}
        startRoom={startRoom}
        toast={toast}
        times={times}
        counts={counts}
      />
      <main className="ms-map-wrap">
        <MapView cells={data.cells} results={results} pins={pins} selected={selected} loading={loading} focusRows={focusRows} onSelect={onSelect} />
        {selected != null && (
          <CellDetail
            hood={data.neighborhoods[data.cells[selected].nta]}
            result={results[selected]}
            groupSize={group.length}
            viewName={viewName}
            onClose={() => setSelected(null)}
          />
        )}
      </main>
    </div>
  )
}
