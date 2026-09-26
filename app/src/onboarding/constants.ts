// Content and options from the Reach NYC prototype (reach-nyc-onboarding branch),
// trimmed to what the map can use: budget, places + commute limits, and commute/rent/safety priorities.
import type { Factor, Person } from '../types'

export type StepId = 'budget' | 'places' | 'rank' | 'invite'

export const STEPS: { id: StepId; k: string; title: string; sub: string }[] = [
  { id: 'budget', k: 'Budget', title: "What's the most you'd spend?", sub: 'Your share of the rent each month.' },
  { id: 'places', k: 'Your places', title: 'Where do you need to get to?', sub: "Add the places you go regularly and how long you're willing to travel to each." },
  { id: 'rank', k: 'Priorities', title: 'What matters most?', sub: "Put what you're least willing to stretch at the top. Rentdezvous bends the bottom one first." },
  { id: 'invite', k: 'Searching', title: 'Are you searching on your own?', sub: 'Search together and Rentdezvous only shows places that work for everyone.' },
]

export const MINS = [15, 20, 30, 45, 60]
export const MAX_PLACES = 5
export const LABELS = ['Work', 'School', 'Family', 'Partner', 'Gym', 'Friends', 'Place of worship']
export const HUE: Record<string, string> = {
  Work: '#2F5BD3',
  School: '#7C4DBC',
  Family: '#D9480F',
  Partner: '#C2185B',
  Gym: '#1F7A4C',
  Friends: '#B8860B',
  'Place of worship': '#0F766E',
}
export const hue = (label: string) => HUE[label] ?? '#0F766E'

export const FACTOR_LABEL: Record<Factor, string> = { commute: 'Commute', rent: 'Rent', safety: 'Safety' }
export const FACTOR_NOTE: Record<Factor, string> = {
  commute: 'Travel times to your places',
  rent: 'Your share against your budget',
  safety: 'Reported violent crime per resident',
}

// What safety's rank means for where you look (see SAFETY_BY_RANK in score.ts)
export const SAFETY_RANK_NOTE = ['Only the lowest-crime third of the city', 'At or below the city median', 'No safety limit, shown as info only']

// One color per person in a group, in join order (the first is the host)
export const PERSON_COLORS = ['#2F5BD3', '#D9480F', '#1F7A4C', '#7C4DBC']
export const MAX_PEOPLE = PERSON_COLORS.length

export const money = (n: number) => '$' + n.toLocaleString('en-US')

export const newPerson = (color = PERSON_COLORS[0], name = ''): Person => ({
  id: crypto.randomUUID(),
  name,
  color,
  budget: 3200,
  places: [{ id: crypto.randomUUID(), name: 'Work', address: '', lat: null, lng: null, maxMin: 30 }],
  ranking: ['commute', 'rent', 'safety'],
  done: false,
})
