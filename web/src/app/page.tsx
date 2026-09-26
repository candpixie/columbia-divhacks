"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PLACES, placeById } from "@/lib/places";
import {
  bedsFor, loadData, nearestHex, rankNeighborhoods, scoreHexes,
  type Data, type Day, type Person,
} from "@/lib/score";
import { formatValue, goodness, loadLayers, percentile, type Layer } from "@/lib/layers";

import TrueCost from "@/components/TrueCost";
import RentTrend from "@/components/RentTrend";

const HexMap = dynamic(() => import("@/components/HexMap"), { ssr: false });

const PERSON_COLORS: [number, number, number][] = [[99, 102, 241], [236, 72, 153], [14, 165, 233]];
const hex = (c: [number, number, number]) => `rgb(${c.join(",")})`;
const money = (n: number) => `$${n.toLocaleString()}`;

const DEFAULT_PEOPLE: Person[] = [{ name: "You", place: "columbia", maxMin: 40, budget: 2000 }];

function readUrl(): { people: Person[]; day: Day } {
  const q = new URLSearchParams(window.location.search);
  const people = q.getAll("p").flatMap((s, k) => {
    const [place, maxMin, budget, name] = s.split(",");
    return placeById(place) ? [{ name: name || `Person ${k + 1}`, place, maxMin: +maxMin || 40, budget: +budget || 2000 }] : [];
  });
  return { people: people.length ? people.slice(0, 3) : DEFAULT_PEOPLE, day: q.get("day") === "sat" ? "saturday" : "weekday" };
}

export default function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [people, setPeople] = useState<Person[]>(DEFAULT_PEOPLE);
  const [day, setDay] = useState<Day>("weekday");
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [colorBy, setColorBy] = useState("fit");
  const [showSafety, setShowSafety] = useState(false);
  const [compareWith, setCompareWith] = useState<string | null>(null);

  // The URL only exists in the browser, so shared-link state is read after mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const s = readUrl();
    setPeople(s.people);
    setDay(s.day);
    setReady(true);
    loadData().then(setData);
    loadLayers().then(setLayers);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ready) return; // don't clobber a shared link before it's read
    const q = new URLSearchParams();
    people.forEach((p) => q.append("p", `${p.place},${p.maxMin},${p.budget},${p.name}`));
    if (day === "saturday") q.set("day", "sat");
    window.history.replaceState(null, "", `?${q}`);
  }, [people, day, ready]);

  const workIdx = useMemo(
    () => (data ? people.map((p) => { const pl = placeById(p.place)!; return nearestHex(data.hexes, pl.lat, pl.lng); }) : []),
    [data, people],
  );
  const results = useMemo(() => (data ? scoreHexes(data, day, people, workIdx) : []), [data, day, people, workIdx]);
  const ranked = useMemo(() => (data ? rankNeighborhoods(data, results, people) : []), [data, results, people]);
  const workPins = useMemo(
    () => people.map((p, k) => ({ ...placeById(p.place)!, color: PERSON_COLORS[k] })),
    [people],
  );
  const onPick = useCallback((nta: string) => setSelected(nta), []);

  const visibleLayers = useMemo(() => layers.filter((l) => showSafety || !l.optional), [layers, showSafety]);
  const activeLayer = visibleLayers.find((l) => l.id === colorBy);
  // Color by a data layer: red (worst in NYC) -> teal (best). Hexes that don't fit your search stay faint.
  const fill = useMemo(() => {
    if (!activeLayer || !data) return undefined;
    return (r: { i: number; fits: boolean }) => {
      const h = data.hexes[r.i];
      const v = activeLayer.hex ? activeLayer.hex[r.i] : activeLayer.nta[h.nta];
      if (v === undefined) return [200, 200, 200, 20] as [number, number, number, number];
      const g = goodness(activeLayer, v);
      const c = [Math.round(225 - 190 * g), Math.round(80 + 100 * g), Math.round(90 + 60 * g)];
      return [c[0], c[1], c[2], r.fits ? 200 : 60] as [number, number, number, number];
    };
  }, [activeLayer, data]);

  const update = (k: number, patch: Partial<Person>) =>
    setPeople((ps) => ps.map((p, i) => (i === k ? { ...p, ...patch } : p)));

  const sel = selected && data ? data.ntas[selected] : null;
  // Default comparison: the neighborhood with the biggest rent-vs-time tradeoff against the selected one.
  const compareTarget = useMemo(() => {
    const others = ranked.filter((r) => r.nta !== selected);
    if (compareWith && others.some((o) => o.nta === compareWith)) return compareWith;
    const me = ranked.find((r) => r.nta === selected);
    if (!others.length) return null;
    if (!me) return [...others].sort((x, y) => x.rent - y.rent)[0].nta;
    const mins = (r: typeof me) => r.times.reduce((a, b) => a + b, 0);
    const tradeoff = (o: typeof me) => {
      const dr = o.rent - me.rent;
      const dt = mins(o) - mins(me);
      return dr * dt < 0 ? Math.abs(dt) : -Infinity; // cheaper-but-longer or pricier-but-shorter
    };
    const best = [...others].sort((x, y) => tradeoff(y) - tradeoff(x))[0];
    return tradeoff(best) > -Infinity ? best.nta : [...others].sort((x, y) => x.rent - y.rent)[0].nta;
  }, [ranked, selected, compareWith]);
  const selRow = ranked.find((r) => r.nta === selected);
  const beds = bedsFor(people.length);
  const budget = people.reduce((s, p) => s + p.budget, 0);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-stone-100 text-stone-900">
      {data && <HexMap data={data} results={results} selectedNta={selected} workPins={workPins} onPick={onPick}
        fill={fill} fillKey={activeLayer?.id ?? "fit"} />}
      {!data && <div className="absolute inset-0 grid place-items-center text-stone-500">Loading the subway…</div>}

      <aside className="absolute left-4 top-4 bottom-4 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-2xl bg-white/95 p-4 shadow-xl backdrop-blur">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Rent Radius</h1>
          <p className="text-sm text-stone-500">Where you can afford to live and still get to work.</p>
        </header>

        <div className="flex rounded-lg bg-stone-100 p-1 text-sm">
          {(["weekday", "saturday"] as Day[]).map((d) => (
            <button key={d} onClick={() => setDay(d)}
              className={`flex-1 rounded-md py-1.5 ${day === d ? "bg-white shadow font-medium" : "text-stone-500"}`}>
              {d === "weekday" ? "Weekday 8am" : "Saturday noon"}
            </button>
          ))}
        </div>

        {layers.length > 0 && (
          <label className="block text-xs text-stone-500">Color the map by
            <select value={activeLayer ? colorBy : "fit"} onChange={(e) => setColorBy(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900">
              <option value="fit">Where you all fit (commute + rent)</option>
              {[...new Set(visibleLayers.map((l) => l.group))].map((g) => (
                <optgroup key={g} label={g}>
                  {visibleLayers.filter((l) => l.group === g).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </optgroup>
              ))}
            </select>
            {activeLayer && (
              <span className="mt-1 block">
                <span className="inline-block h-2 w-24 rounded-full align-middle" style={{ background: "linear-gradient(90deg, rgb(225,80,90), rgb(35,180,150))" }} />
                <span className="ml-2">worse → better in NYC · {activeLayer.source}, {activeLayer.year}</span>
              </span>
            )}
          </label>
        )}

        {people.map((p, k) => (
          <section key={k} className="rounded-xl border border-stone-200 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: hex(PERSON_COLORS[k]) }} />
              <input value={p.name} onChange={(e) => update(k, { name: e.target.value })}
                className="flex-1 bg-transparent text-sm font-medium outline-none" aria-label="Name" />
              {people.length > 1 && (
                <button onClick={() => setPeople((ps) => ps.filter((_, i) => i !== k))}
                  className="text-xs text-stone-400 hover:text-stone-700">Remove</button>
              )}
            </div>
            <label className="block text-xs text-stone-500">Works / studies at
              <select value={p.place} onChange={(e) => update(k, { place: e.target.value })}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900">
                {PLACES.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </select>
            </label>
            <label className="mt-2 block text-xs text-stone-500">Max commute: <b className="text-stone-900">{p.maxMin} min</b>
              <input type="range" min={15} max={75} step={5} value={p.maxMin}
                onChange={(e) => update(k, { maxMin: +e.target.value })} className="w-full" />
            </label>
            <label className="mt-1 block text-xs text-stone-500">Rent share: <b className="text-stone-900">{money(p.budget)}/mo</b>
              <input type="range" min={800} max={6000} step={100} value={p.budget}
                onChange={(e) => update(k, { budget: +e.target.value })} className="w-full" />
            </label>
          </section>
        ))}
        {people.length < 3 && (
          <button onClick={() => setPeople((ps) => [...ps, { name: `Roommate ${ps.length}`, place: "fidi", maxMin: 40, budget: 1500 }])}
            className="rounded-xl border border-dashed border-stone-300 py-2 text-sm text-stone-500 hover:border-stone-500 hover:text-stone-800">
            + Add roommate
          </button>
        )}

        {layers.some((l) => l.optional) && (
          <label className="flex items-center gap-2 text-xs text-stone-500">
            <input type="checkbox" checked={showSafety} onChange={(e) => setShowSafety(e.target.checked)} />
            Show safety data (per capita, never part of the ranking)
          </label>
        )}

        <section>
          <h2 className="mb-1 text-sm font-semibold">
            {ranked.length ? `${ranked.length} neighborhoods work` : "Nothing fits yet"}
            <span className="font-normal text-stone-500"> · {beds.toUpperCase()} under {money(budget)}</span>
          </h2>
          {!ranked.length && data && (
            <p className="text-sm text-stone-500">Try a longer commute or a bigger budget.</p>
          )}
          <ol className="space-y-1">
            {ranked.slice(0, 8).map((r) => (
              <li key={r.nta}>
                <button onClick={() => setSelected(r.nta)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-100 ${selected === r.nta ? "bg-stone-100" : ""}`}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="shrink-0 text-stone-500">{money(r.rent)}</span>
                  </div>
                  <div className="text-xs text-stone-500">{r.times.map((t, k) => `${people[k]?.name} ${t}m`).join(" · ")}</div>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </aside>

      {sel && (
        <aside className="absolute right-4 top-4 w-[20rem] max-w-[calc(100vw-2rem)] rounded-2xl bg-white/95 p-4 shadow-xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold leading-tight">{sel.name}</h2>
              <p className="text-xs text-stone-500">{sel.borough}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-stone-400 hover:text-stone-800" aria-label="Close">✕</button>
          </div>
          <p className="mt-3 text-sm">
            {beds.toUpperCase()} median <b>{money(sel.rent[beds])}</b>/mo
            {sel.trend !== null && <span className="text-stone-500"> · {sel.trend > 0 ? "+" : ""}{sel.trend}% vs last year</span>}
          </p>
          {sel.estimated && <p className="text-xs text-amber-700">Borough estimate, no neighborhood data</p>}
          {selected && !sel.estimated && <RentTrend nta={selected} beds={beds} />}
          <p className={`mt-1 text-sm ${sel.rent[beds] <= budget ? "text-emerald-700" : "text-rose-700"}`}>
            {sel.rent[beds] <= budget ? "Fits" : "Over"} your combined {money(budget)}
          </p>
          <div className="mt-3 space-y-1 text-sm">
            {selRow
              ? selRow.times.map((t, k) => (
                <div key={k} className="flex justify-between">
                  <span><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: hex(PERSON_COLORS[k]) }} />{people[k]?.name}</span>
                  <span>{t} min</span>
                </div>
              ))
              : <p className="text-stone-500">Commute is over someone&apos;s limit from here.</p>}
          </div>
          {data && selected && compareTarget && (
            <TrueCost data={data} people={people} workIdx={workIdx} beds={beds} a={selected} b={compareTarget}
              options={ranked} onChangeB={setCompareWith} />
          )}
          {visibleLayers.length > 0 && selected && (
            <div className="mt-3 max-h-[45vh] space-y-3 overflow-y-auto border-t border-stone-200 pt-3">
              {[...new Set(visibleLayers.map((l) => l.group))].map((g) => (
                <div key={g}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">{g}</h3>
                  {visibleLayers.filter((l) => l.group === g).map((l) => {
                    const v = l.nta[selected];
                    if (v === undefined) return null;
                    const pct = percentile(l, v);
                    return (
                      <div key={l.id} className="mt-1 text-sm" title={l.note ?? `${l.source}, ${l.year}`}>
                        <div className="flex justify-between gap-2">
                          <span>{l.label}</span>
                          <span className="shrink-0 text-stone-600">{formatValue(l, v)}</span>
                        </div>
                        {pct !== null && (
                          <div className="mt-0.5 h-1 rounded-full bg-stone-100">
                            <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: pct >= 50 ? "rgb(35,180,150)" : "rgb(225,120,90)" }} />
                          </div>
                        )}
                        {l.note && l.optional && <p className="text-xs text-stone-400">{l.note}</p>}
                      </div>
                    );
                  })}
                </div>
              ))}
              <p className="text-xs text-stone-400">Bars: how this neighborhood compares with the rest of NYC.</p>
            </div>
          )}
        </aside>
      )}
    </main>
  );
}
