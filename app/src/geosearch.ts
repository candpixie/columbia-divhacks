// NYC GeoSearch (NYC Planning's public geocoder). No key, CORS open. NYC addresses only.
export type Suggestion = { label: string; lat: number; lng: number }

export async function autocomplete(text: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = `https://geosearch.planninglabs.nyc/v2/autocomplete?text=${encodeURIComponent(text)}`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const json = await res.json()
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const f of json.features ?? []) {
    const p = f.properties
    const label = `${p.name}, ${p.borough ?? p.locality ?? ''}`.replace(/, $/, '')
    const [lng, lat] = f.geometry.coordinates
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ label, lat, lng })
  }
  return out.slice(0, 6)
}
