import type { Cell, TravelTimes } from './types'

// Public transit times from every cell to one place, arriving 9:00 AM on the next weekday.
// Goes through the dev-server proxy (vite.config.ts), which adds the API credentials.

const MAX_SECONDS = 2 * 60 * 60

function nextWeekdayNineAm(): string {
  const tz = 'America/New_York'
  const d = new Date()
  do d.setDate(d.getDate() + 1)
  while ([0, 6].includes(new Date(d.toLocaleString('en-US', { timeZone: tz })).getDay()))
  const date = d.toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')!
    .value.replace('GMT', '') // e.g. "-4"
  const sign = offset.startsWith('-') ? '-' : '+'
  const hours = String(Math.abs(parseInt(offset, 10))).padStart(2, '0')
  return `${date}T09:00:00${sign}${hours}:00`
}

const cache = new Map<string, Promise<TravelTimes>>()

export function travelTimesTo(lat: number, lng: number, cells: Cell[]): Promise<TravelTimes> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
  let p = cache.get(key)
  if (!p) {
    p = fetchTimes(lat, lng, cells)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

async function fetchTimes(lat: number, lng: number, cells: Cell[]): Promise<TravelTimes> {
  const body = {
    locations: [
      { id: 'place', coords: { lat, lng } },
      ...cells.map((c, i) => ({ id: String(i), coords: { lat: c.lat, lng: c.lng } })),
    ],
    arrival_searches: [
      {
        id: 'to-place',
        arrival_location_id: 'place',
        departure_location_ids: cells.map((_, i) => String(i)),
        arrival_time: nextWeekdayNineAm(),
        travel_time: MAX_SECONDS,
        properties: ['travel_time'],
        transportation: { type: 'public_transport' },
      },
    ],
  }
  const res = await fetch('/api/traveltime/time-filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`TravelTime ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const times = new Float32Array(cells.length).fill(Infinity)
  for (const loc of json.results?.[0]?.locations ?? []) {
    times[Number(loc.id)] = loc.properties[0].travel_time / 60
  }
  return times
}
