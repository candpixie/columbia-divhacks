import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { cellToBoundary } from 'h3-js'
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

type Props = {
  cells: Cell[]
  results: CellResult[]
  pins: Pin[]
  selected: number | null
  loading: boolean
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

// Bounding box of the scored cells, [[west, south], [east, north]]
function cellBounds(cells: Cell[]): [[number, number], [number, number]] {
  const lngs = cells.map((c) => c.lng)
  const lats = cells.map((c) => c.lat)
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]]
}

export function MapView({ cells, results, pins, selected, loading, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // open framed on NYC and keep the camera there, so NJ and the rest of the world stay out of view
    const [[w, s], [e, n]] = cellBounds(cells)
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLE,
      bounds: [[w, s], [e, n]],
      fitBoundsOptions: { padding: 24 },
      maxBounds: [[w - 0.08, s - 0.05], [e + 0.08, n + 0.05]],
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
            'fill-opacity': [
              'match', ['feature-state', 'status'],
              'green', 0.55,
              'yellow', 0.6,
              'gray', 0.22,
              0.15,
            ],
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
    map.setPaintProperty('cells-fill', 'fill-opacity', loading ? 0.08 : [
      'match', ['feature-state', 'status'], 'green', 0.55, 'yellow', 0.6, 'gray', 0.22, 0.15,
    ])
  }, [ready, loading])

  return <div ref={container} className="ms-map" />
}
