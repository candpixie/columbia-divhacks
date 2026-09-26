// Group rooms, synced through Supabase (Postgres tables + Realtime change feed).
//   room_people (room, id, data, joined_at)  one person's answers (Person as JSON)
//   room_times  (room, key, data)            transit minutes from every cell to one spot, base64 Uint8 (255 = over 2 h)
// Each person writes only their own row. Whoever adds a place fetches its travel times once and shares them.
// Table setup: app/supabase.sql
import { useEffect, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Factor, Person, Place, TravelTimes } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const db: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
export const roomsEnabled = db != null

// No 0/O/1/I so codes are easy to read aloud
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const newRoomCode = () => Array.from({ length: 6 }, () => ALPHABET[(Math.random() * ALPHABET.length) | 0]).join('')

export const roomUrl = (code: string) => `${location.origin}${location.pathname}?room=${code}`
export const roomFromUrl = () => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? null

// Tolerate rows written by older versions of the app
function readPerson(id: string, v: Partial<Person> & { places?: Place[] }): Person {
  return {
    id,
    name: v.name ?? '',
    color: v.color ?? '#2F5BD3',
    budget: v.budget ?? null,
    places: (v.places ?? []).map((p) => ({ ...p, lat: p.lat ?? null, lng: p.lng ?? null, address: p.address ?? '', name: p.name ?? '' })),
    ranking: (v.ranking as Factor[] | undefined) ?? ['commute', 'rent', 'safety'],
    done: v.done ?? false,
  }
}

const fail = ({ error }: { error: { message: string } | null }) => {
  if (error) throw new Error(error.message)
}

// joined_at is set once by the database, so the room keeps join order (and colors) stable
export async function joinRoom(code: string, p: Person) {
  if (!db) return
  fail(await db.from('room_people').upsert({ room: code, id: p.id, data: p }, { onConflict: 'room,id' }))
}

export async function writePerson(code: string, p: Person) {
  if (!db) return
  fail(await db.from('room_people').update({ data: p }).eq('room', code).eq('id', p.id))
}

export async function writeTimes(code: string, key: string, times: TravelTimes) {
  if (!db) return
  const bytes = Uint8Array.from(times, (t) => (Number.isFinite(t) ? Math.min(254, Math.round(t)) : 255))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  fail(await db.from('room_times').upsert({ room: code, key, data: btoa(s) }, { onConflict: 'room,key' }))
}

function decodeTimes(b64: string): TravelTimes {
  const s = atob(b64)
  const out = new Float32Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i)
    out[i] = b === 255 ? Infinity : b
  }
  return out
}

export type RoomState = {
  people: Person[] // everyone in the room, in join order
  times: Record<string, TravelTimes> // by coordKey
  loaded: boolean
  error: string | null
}

type PersonRow = { id: string; data: Person; joined_at: string }
type TimesRow = { key: string; data: string }

export function useRoom(code: string | null): RoomState {
  const [state, setState] = useState<RoomState>({ people: [], times: {}, loaded: false, error: null })

  useEffect(() => {
    if (!db || !code) return
    const client = db
    const rows = new Map<string, PersonRow>()
    const publish = () =>
      setState((s) => ({
        ...s,
        loaded: true,
        people: [...rows.values()].sort((a, b) => a.joined_at.localeCompare(b.joined_at)).map((r) => readPerson(r.id, r.data)),
      }))
    const addTimes = (list: TimesRow[]) =>
      setState((s) => ({ ...s, times: { ...s.times, ...Object.fromEntries(list.map((r) => [r.key, decodeTimes(r.data)])) } }))

    // Subscribe first, then load what's already there, so nothing written in between is missed
    const channel = client
      .channel(`room:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_people', filter: `room=eq.${code}` }, (msg) => {
        if (msg.eventType === 'DELETE') rows.delete((msg.old as PersonRow).id)
        else rows.set((msg.new as PersonRow).id, msg.new as PersonRow)
        publish()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_times', filter: `room=eq.${code}` }, (msg) => {
        if (msg.eventType !== 'DELETE') addTimes([msg.new as TimesRow])
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setState((s) => ({ ...s, error: `Live updates unavailable (${status})` }))
          return
        }
        const [people, times] = await Promise.all([
          client.from('room_people').select('id,data,joined_at').eq('room', code),
          client.from('room_times').select('key,data').eq('room', code),
        ])
        if (people.error || times.error) {
          setState((s) => ({ ...s, loaded: true, error: (people.error ?? times.error)!.message }))
          return
        }
        for (const r of people.data as PersonRow[]) if (!rows.has(r.id)) rows.set(r.id, r)
        publish()
        addTimes(times.data as TimesRow[])
      })

    return () => {
      client.removeChannel(channel)
    }
  }, [code])

  return state
}
