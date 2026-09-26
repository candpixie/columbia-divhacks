export type Cell = { h3: string; nta: string; lat: number; lng: number }

export type Beds = 'studio' | '1br' | '2br' | '3br'

export type Neighborhood = {
  name: string
  borough: string
  rent: Record<Beds, number>
  rentEstimated: boolean
  violentPer1k: number
}

export type Factor = 'commute' | 'rent' | 'safety'

export type SafetyPref = 'none' | 'median' | 'lowerThird'

export type Place = {
  id: string
  name: string // label, e.g. "Work"
  address: string
  lat: number | null // null until the address is picked from search
  lng: number | null
  maxMin: number
}

export type LocatedPlace = Place & { lat: number; lng: number }

// One person's answers. In a group room, each person's copy is synced to everyone.
export type Person = {
  id: string
  name: string
  color: string
  budget: number | null
  places: Place[]
  ranking: Factor[] // most important first; drives stretch-cost weights and the safety limit
  done: boolean // finished onboarding; only finished people count on the group map
  visited?: string // NYC Passport: explored cells as a packed bitset (see passport.ts); synced with the room
}

// minutes per cell index; Infinity = not reachable within the search limit
export type TravelTimes = Float32Array

// by coordKey
export type TimesState = Record<string, TravelTimes | 'loading' | { error: string }>

export const located = (places: Place[]): LocatedPlace[] =>
  places.filter((p): p is LocatedPlace => p.lat != null && p.lng != null)

// travel times are shared by location, so two people with the same office reuse one lookup
export const coordKey = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
