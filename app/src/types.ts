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

export type Mate = { name: string; color: string; status: 'Invited' | 'Answering' | 'Done'; data: MateAnswers | null }

export type MateAnswers = {
  budget: number
  places: { name: string; address: string; maxMin: number }[]
  ranking: Factor[]
}

export type Person = {
  budget: number | null
  places: Place[]
  together: boolean | null
  mates: Mate[] // prototype placeholder for the invite step
  ranking: Factor[] // most important first; drives stretch-cost weights and the safety limit
}

// minutes per cell index; Infinity = not reachable within the search limit
export type TravelTimes = Float32Array

export type TimesState = Record<string, TravelTimes | 'loading' | { error: string }>

export const located = (places: Place[]): LocatedPlace[] =>
  places.filter((p): p is LocatedPlace => p.lat != null && p.lng != null)
