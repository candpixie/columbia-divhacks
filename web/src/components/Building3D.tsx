"use client";

// Photorealistic 3D view of a building and its block (Google Map Tiles API, the same 3D city as Google Earth).
// Renders nothing until NEXT_PUBLIC_GOOGLE_MAPS_KEY is set. Google requires its logo and data credits on screen.
import { useEffect, useRef, useState } from "react";
import { Deck } from "@deck.gl/core";
import { Tile3DLayer } from "@deck.gl/geo-layers";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";

type TileWithCredits = { content?: { gltf?: { asset?: { copyright?: string } } } };

export default function Building3D({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [credits, setCredits] = useState("");
  const [failed, setFailed] = useState(false);
  const [spinning, setSpinning] = useState(true);
  const spin = useRef(true);

  useEffect(() => {
    if (!KEY || !el.current) return;
    const seen = new Map<string, number>();
    let bearing = 20;
    const view = { latitude: lat, longitude: lon, zoom: 17.3, pitch: 58, bearing, maxPitch: 75, minZoom: 14, maxZoom: 20 };
    let deck: Deck | null = null;
    try {
      deck = new Deck({
        parent: el.current,
        initialViewState: view,
        controller: { touchRotate: true, dragRotate: true },
        onInteractionStateChange: (s: { isDragging?: boolean }) => { if (s.isDragging) { spin.current = false; setSpinning(false); } },
        layers: [
          new Tile3DLayer({
            id: "google-3d",
            data: ROOT,
            loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": KEY } } },
            operation: "terrain+draw",
            onTileLoad: (tile: TileWithCredits) => {
              for (const c of (tile.content?.gltf?.asset?.copyright ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
                seen.set(c, (seen.get(c) ?? 0) + 1);
              }
              setCredits([...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).join("; "));
            },
            onTileError: () => setFailed(true),
          }),
        ],
      });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- WebGL init failure is only knowable here
      setFailed(true);
    }
    // slow orbit around the building until the user grabs the view
    let raf = 0;
    const tick = () => {
      if (spin.current && deck) {
        bearing = (bearing + 0.08) % 360;
        deck.setProps({ initialViewState: { ...view, bearing } });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); deck?.finalize(); };
  }, [lat, lon]);

  if (!KEY) return null;
  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Look around before you sign</h3>
        {!spinning && (
          <button onClick={() => { spin.current = true; setSpinning(true); }} className="text-xs text-stone-500 hover:text-stone-900">Resume orbit</button>
        )}
      </div>
      <div className="relative mt-3 aspect-[4/3] w-full bg-stone-200" aria-label={`3D view of ${label} and its block`}>
        <div ref={el} className="absolute inset-0" />
        {failed && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-stone-600">3D view unavailable right now.</p>}
        <div className="pointer-events-none absolute bottom-1 left-2 right-2 flex items-end justify-between gap-2 text-[10px] text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
          <span className="text-sm font-semibold tracking-tight">Google</span>
          <span className="truncate">{credits}</span>
        </div>
      </div>
      <p className="px-5 py-2 text-[11px] text-stone-400">Drag to look around. Photorealistic 3D Tiles © Google.</p>
    </section>
  );
}
