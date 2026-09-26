import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { cellToBoundary } from 'h3-js'
import type { FeatureCollection } from 'geojson'
import type { Cell } from '../types'
import type { CellResult } from '../score'
import { ICONS, KINDS, spotsIn, type Spot } from '../focus'

// MapLibre 6 loads its worker from a URL; let Vite bundle it and hand us that URL
setWorkerUrl(maplibreWorkerUrl)

const DARK = matchMedia('(prefers-color-scheme: dark)').matches
const STYLE = `https://basemaps.cartocdn.com/gl/${DARK ? 'dark-matter' : 'positron'}-gl-style/style.json`
const INK = DARK ? '#ECEEF1' : '#171C24'
const HALO = DARK ? '#111316' : '#FFFFFF'

export type Pin = { label: string; lat: number; lng: number; color: string }

// One line of the "your top 3 here" card on a focused hexagon; ok = within your limit, null = no limit set
export type FocusRow = { rank: number; label: string; value: string; ok: boolean | null }

const STATUS_OPACITY: ExpressionSpecification = ['match', ['feature-state', 'status'], 'green', 0.55, 'yellow', 0.6, 'gray', 0.22, 0.15]
// the focused hexagon is nearly clear so its streets and places show through
const fillOpacity = (loading: boolean): ExpressionSpecification => ['case', ['boolean', ['feature-state', 'focus'], false], 0.07, loading ? 0.08 : STATUS_OPACITY]
const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const icon = (path: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`

type Props = {
  cells: Cell[]
  results: CellResult[]
  pins: Pin[]
  selected: number | null
  loading: boolean
  focusRows: FocusRow[] | null
  onSelect: (i: number | null) => void
}

function cellsGeoJSON(cells: Cell[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map((c, i) => {
      const ring = cellToBoundary(c.h3, true) // [lng, lat]
      return {
        type: 'Feature',
        id: i,
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
      }
    }),
  }
}

function pinsGeoJSON(pins: Pin[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature',
      properties: { name: p.label, color: p.color },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  }
}

export function MapView({ cells, results, pins, selected, loading, focusRows, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLE,
      center: [-73.94, 40.72],
      zoom: 10.3,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      // hexes go under the first label layer so neighborhood and street names stay readable
      const firstLabel = map.getStyle().layers.find((l: { type: string }) => l.type === 'symbol')
      const font = firstLabel ? (map.getLayoutProperty(firstLabel.id, 'text-font') as string[]) : undefined

      map.addSource('cells', { type: 'geojson', data: cellsGeoJSON(cells) })
      map.addLayer(
        {
          id: 'cells-fill',
          type: 'fill',
          source: 'cells',
          paint: {
            'fill-color': [
              'match', ['feature-state', 'status'],
              'green', '#16a34a',
              'yellow', '#eab308',
              'gray', '#6b7280',
              '#2F5BD3',
            ],
            'fill-opacity': fillOpacity(false),
            'fill-opacity-transition': { duration: 300 },
            'fill-color-transition': { duration: 300 },
          },
        },
        firstLabel?.id,
      )
      map.addLayer(
        { id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': HALO, 'line-width': 0.6, 'line-opacity': 0.6 } },
        firstLabel?.id,
      )
      map.addLayer({
        id: 'cells-selected',
        type: 'line',
        source: 'cells',
        filter: ['==', ['id'], -1],
        paint: { 'line-color': INK, 'line-width': 3 },
      })

      // everything outside the focused hexagon is washed out; the hexagon is a hole in this world-sized polygon
      map.addSource('focus-mask', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer(
        { id: 'focus-mask', type: 'fill', source: 'focus-mask', paint: { 'fill-color': HALO, 'fill-opacity': DARK ? 0.72 : 0.8, 'fill-opacity-transition': { duration: 400 } } },
        'cells-selected',
      )

      map.addSource('places', { type: 'geojson', data: pinsGeoJSON([]) })
      map.addLayer({
        id: 'places-dot',
        type: 'circle',
        source: 'places',
        paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': HALO, 'circle-stroke-width': 2.5 },
      })
      map.addLayer({
        id: 'places-label',
        type: 'symbol',
        source: 'places',
        layout: { 'text-field': ['get', 'name'], 'text-offset': [0, -1.6], 'text-size': 13, ...(font ? { 'text-font': font } : {}) },
        paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 2 },
      })

      map.on('click', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['cells-fill'] })[0]
        onSelectRef.current(f ? Number(f.id) : null)
      })
      map.on('mouseenter', 'cells-fill', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'cells-fill', () => (map.getCanvas().style.cursor = ''))
      setReady(true)
    })
    return () => map.remove()
  }, [cells])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    results.forEach((r, i) => map.setFeatureState({ source: 'cells', id: i }, { status: r.status }))
  }, [ready, results])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('places') as GeoJSONSource).setData(pinsGeoJSON(pins))
  }, [ready, pins])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('cells-selected', ['==', ['id'], selected ?? -1])
  }, [ready, selected])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setPaintProperty('cells-fill', 'fill-opacity', fillOpacity(loading))
  }, [ready, loading])

  // ---------- Focus on the selected hexagon: zoom to it, wash out the rest, and float bubbles over its places ----------
  const markers = useRef<Marker[]>([])
  const card = useRef<Marker | null>(null)
  const focused = useRef<number | null>(null)
  const before = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const rowsRef = useRef(focusRows)

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const clear = () => {
      markers.current.forEach((m) => m.remove())
      markers.current = []
      card.current?.remove()
      card.current = null
    }
    clear()
    if (focused.current != null) map.setFeatureState({ source: 'cells', id: focused.current }, { focus: false })
    const mask = map.getSource('focus-mask') as GeoJSONSource
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

    if (selected == null) {
      focused.current = null
      mask.setData({ type: 'FeatureCollection', features: [] })
      if (before.current) map.easeTo({ ...before.current, duration: reduce ? 0 : 700 })
      before.current = null
      return
    }

    if (focused.current == null) before.current = { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() }
    focused.current = selected
    map.setFeatureState({ source: 'cells', id: selected }, { focus: true })
    const ring = cellToBoundary(cells[selected].h3, true)
    mask.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD, [...ring, ring[0]].reverse()] } })

    const bounds = ring.reduce((b, p) => b.extend(p as [number, number]), new LngLatBounds(ring[0] as [number, number], ring[0] as [number, number]))
    const wide = (container.current?.clientWidth ?? 0) > 720
    map.fitBounds(bounds, {
      padding: wide ? { top: 150, bottom: 60, left: 390, right: 90 } : { top: 110, bottom: 30, left: 24, right: 24 },
      maxZoom: 16.6,
      duration: reduce ? 0 : 900,
    })

    let cancelled = false
    const top = ring.reduce((a, p) => (p[1] > a[1] ? p : a), ring[0]) // northernmost corner, for the top-3 card
    const place = () => {
      if (cancelled) return
      // MapLibre positions a marker with a transform on its element, so the animated card goes one level inside
      const el = document.createElement('div')
      el.innerHTML = cardHTML(rowsRef.current)
      card.current = new Marker({ element: el, anchor: 'bottom', offset: [0, -8] }).setLngLat(top as [number, number]).addTo(map)
      addSpots(map, spotsIn(map, cells[selected].h3))
    }
    const addSpots = (m: MapLibreMap, spots: Spot[]) => {
      // Rough screen boxes of bubbles already placed (and the top-3 card), so a new bubble can go above
      // its point, below it, or be left out when both spots are taken
      type Box = { l: number; r: number; t: number; b: number }
      const boxes: Box[] = []
      const tp = m.project(top as [number, number])
      boxes.push({ l: tp.x - 125, r: tp.x + 125, t: tp.y - 130, b: tp.y })
      const hit = (q: Box) => boxes.some((o) => q.l < o.r && q.r > o.l && q.t < o.b && q.b > o.t)
      const shown: Spot[] = []
      const flips: boolean[] = []
      for (const sp of spots) {
        const pt = m.project([sp.lng, sp.lat])
        const w = Math.min(260, 70 + 6.3 * Math.max(sp.name.length + (sp.more ? 9 : 0), 8)), h = 44
        const up = { l: pt.x - w / 2, r: pt.x + w / 2, t: pt.y - 10 - h, b: pt.y - 6 }
        const down = { l: up.l, r: up.r, t: pt.y + 6, b: pt.y + 10 + h }
        const box = !hit(up) ? up : !hit(down) ? down : null
        if (!box) continue
        boxes.push(box)
        shown.push(sp)
        flips.push(box === down)
      }
      shown.forEach((sp, i) => {
        const k = KINDS.find((x) => x.kind === sp.kind)!
        const flip = flips[i]
        const el = document.createElement('div')
        el.innerHTML = `<div class="hf-bub${flip ? ' flip' : ''}" style="animation-delay:${i * 70}ms"><span class="hf-ic" style="background:${k.color}">${icon(ICONS[sp.kind])}</span><span><b>${k.label}</b><small>${esc(sp.name)}${sp.more ? ` · +${sp.more} more` : ''}</small></span></div>`
        markers.current.push(new Marker({ element: el, anchor: flip ? 'top' : 'bottom', offset: [0, flip ? 8 : -8] }).setLngLat([sp.lng, sp.lat]).addTo(m))
      })
      if (!shown.length) {
        const el = document.createElement('div')
        el.innerHTML = '<div class="hf-bub quiet"><span><b>No mapped places here yet</b><small>OpenStreetMap has little data for this area</small></span></div>'
        const c = cells[selected]
        markers.current.push(new Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(m))
      }
    }
    // wait for the camera to land and the new tiles to load before reading places from them
    const settle = () => (map.loaded() ? place() : map.once('idle', place))
    if (map.isMoving()) map.once('moveend', settle)
    else settle()
    return () => {
      cancelled = true
    }
  }, [ready, selected, cells])

  // keep the top-3 card current as answers or travel times change
  useEffect(() => {
    rowsRef.current = focusRows
    if (card.current) card.current.getElement().innerHTML = cardHTML(focusRows)
  }, [focusRows])

  // Escape leaves the focused hexagon
  useEffect(() => {
    if (selected == null) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onSelectRef.current(null)
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [selected])

  return <div ref={container} className="ms-map" />
}

function cardHTML(rows: FocusRow[] | null): string {
  if (!rows?.length) return ''
  return `<div class="hf-card"><div class="hf-card-h">Your top 3 here</div>${rows
    .map((r) => `<div class="hf-row"><i class="hf-rk">${r.rank}</i><span>${esc(r.label)}</span><b>${esc(r.value)}</b><i class="hf-tone ${r.ok == null ? 'na' : r.ok ? 'ok' : 'no'}"></i></div>`)
    .join('')}</div>`
}
