"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Data, HexResult } from "@/lib/score";

type Props = {
  data: Data;
  results: HexResult[];
  selectedNta: string | null;
  fill?: (r: HexResult) => [number, number, number, number]; // overrides the default fit coloring
  fillKey?: string; // change when `fill` changes
  workPins: { lat: number; lng: number; color: [number, number, number] }[];
  onPick: (nta: string) => void;
};

// green (short worst commute) -> amber (near the limit)
function color(r: HexResult, maxMin: number, selected: boolean): [number, number, number, number] {
  if (!r.fits) return [120, 120, 130, 18];
  const t = Math.min(1, r.worst / Math.max(1, maxMin));
  const c: [number, number, number] = [Math.round(40 + 200 * t), Math.round(170 - 60 * t), Math.round(120 - 80 * t)];
  return [...c, selected ? 230 : 150];
}

export default function HexMap({ data, results, selectedNta, workPins, onPick, fill, fillKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const overlay = useRef<MapboxOverlay | null>(null);

  useEffect(() => {
    if (!el.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
      container: el.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-73.94, 40.73],
      zoom: 10.6,
      attributionControl: { compact: true },
      });
    } catch {
      el.current.innerHTML =
        '<div style="display:grid;place-items:center;height:100%;color:#78716c">This browser can\'t draw the map (WebGL is off).</div>';
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    overlay.current = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay.current);
    return () => map.remove();
  }, []);

  useEffect(() => {
    const maxMin = Math.max(1, ...results.map((r) => (r.fits ? r.worst : 0)));
    overlay.current?.setProps({
      layers: [
        new H3HexagonLayer<HexResult>({
          id: "hexes",
          data: results,
          getHexagon: (r) => data.hexes[r.i].h3,
          getFillColor: (r) => (fill ? fill(r) : color(r, maxMin, data.hexes[r.i].nta === selectedNta)),
          getLineColor: (r) => (data.hexes[r.i].nta === selectedNta ? [20, 20, 30, 255] : [255, 255, 255, 60]),
          lineWidthMinPixels: 1,
          extruded: false,
          pickable: true,
          onClick: (info) => info.object && onPick(data.hexes[info.object.i].nta),
          updateTriggers: { getFillColor: [results, selectedNta, fillKey], getLineColor: [selectedNta] },
        }),
        new ScatterplotLayer({
          id: "work",
          data: workPins,
          getPosition: (p) => [p.lng, p.lat],
          getFillColor: (p) => p.color,
          getLineColor: [255, 255, 255],
          stroked: true,
          lineWidthMinPixels: 2,
          radiusMinPixels: 8,
        }),
      ],
    });
  }, [data, results, selectedNta, workPins, onPick, fill, fillKey]);

  return <div ref={el} className="absolute inset-0" />;
}
