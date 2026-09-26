import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { cellToBoundary, cellToLatLng } from 'h3-js'
import type { FeatureCollection } from 'geojson'
import type { Cell } from '../types'
import type { CellResult } from '../score'

// MapLibre 6 loads its worker from a URL; let Vite bundle it and hand us that URL
setWorkerUrl(maplibreWorkerUrl)

const DARK = matchMedia('(prefers-color-scheme: dark)').matches
const STYLE = `https://basemaps.cartocdn.com/gl/${DARK ? 'dark-matter' : 'positron'}-gl-style/style.json`
const INK = DARK ? '#ECEEF1' : '#171C24'
const HALO = DARK ? '#111316' : '#FFFFFF'

export type Pin = { label: string; lat: number; lng: number; color: string }

// Fits pop, everything else recedes: out-of-range cells are barely tinted so the answer is the first thing you see.
const OPACITY = [
  'match', ['feature-state', 'status'],
  'green', 0.6, 'yellow', 0.42, 'gray', 0.07, 'custom', 0.62, 'none', 0.03,
  0.05,
] as unknown as number
const COLOR = [
  'case', ['==', ['feature-state', 'status'], 'custom'], ['coalesce', ['feature-state', 'color'], '#2F5BD3'],
  ['match', ['feature-state', 'status'], 'green', '#16a34a', 'yellow', '#eab308', 'gray', '#6b7280', '#2F5BD3'],
] as unknown as string

type Props = {
  cells: Cell[]
  results: CellResult[]
  pins: Pin[]
  selected: number | null
  loading: boolean
  onSelect: (i: number | null) => void
  colors?: (string | null)[] | null // Explore mode: one color per cell (null = not explored); overrides fit colors
  focus?: { i: number; n: number } | null // fly to cell i whenever n changes
  fitTo?: { cells: number[]; key: string } | null // frame these cells whenever key changes
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

export function MapView({ cells, results, pins, selected, loading, onSelect, colors, focus, fitTo }: Props) {
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
            'fill-color': COLOR,
            'fill-opacity': OPACITY,
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
    if (colors) colors.forEach((c, i) => map.setFeatureState({ source: 'cells', id: i }, c ? { status: 'custom', color: c } : { status: 'none' }))
    else results.forEach((r, i) => map.setFeatureState({ source: 'cells', id: i }, { status: r.status }))
  }, [ready, results, colors])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focus) return
    const [lat, lng] = cellToLatLng(cells[focus.i].h3)
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13.2), duration: 900 })
  }, [ready, focus, cells])

  const fitKey = fitTo?.key
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !fitTo || !fitTo.cells.length) return
    let [w, s, e, n] = [180, 90, -180, -90]
    for (const i of fitTo.cells) {
      for (const [lng, lat] of cellToBoundary(cells[i].h3, true)) {
        w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat)
      }
    }
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 13, duration: 900 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the set of matches changes
  }, [ready, fitKey, cells])

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
    map.setPaintProperty('cells-fill', 'fill-opacity', loading && !colors ? 0.08 : OPACITY)
  }, [ready, loading, colors])

  return <div ref={container} className="ms-map" />
}
