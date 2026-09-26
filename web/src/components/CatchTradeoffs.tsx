"use client";

// The cheap-rent tradeoff for one building: what living here costs in commute time,
// and what nearby cheaper (or pricier) neighborhoods would cost you in hours and money.
import { useEffect, useMemo, useState } from "react";
import { PLACES, placeById } from "@/lib/places";
import { commute, loadData, nearestHex, UNREACHABLE, type Data, type Rent } from "@/lib/score";
import { incomeFromBudget, trueCost } from "@/lib/trueCost";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const hrs = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString());
const short = (name: string) => name.split(/[-(]/)[0].trim();
const BEDS: (keyof Rent)[] = ["studio", "1br", "2br", "3br"];

type Option = { nta: string; name: string; rent: number; wk: number; sat: number; hours: number; timeValue: number; total: number };

export default function CatchTradeoffs({ lat, lon }: { lat: number; lon: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [work, setWork] = useState("columbia");
  const [beds, setBeds] = useState<keyof Rent>("1br");
  const [rentInput, setRentInput] = useState("");

  useEffect(() => { loadData().then(setData).catch(() => setData(null)); }, []);

  const result = useMemo(() => {
    if (!data) return null;
    const place = placeById(work)!;
    const w = nearestHex(data.hexes, place.lat, place.lng);
    const home = nearestHex(data.hexes, lat, lon);
    const homeNta = data.hexes[home].nta;
    const median = data.ntas[homeNta]?.rent[beds];
    const rent = Number(rentInput) > 300 ? Number(rentInput) : median;
    if (!rent) return null;
    const income = incomeFromBudget(rent); // assume they just clear the landlord 40x rule
    const cost = (r: number, wk: number, sat: number) => trueCost({ rentShare: r, weekdayMin: wk, saturdayMin: sat, annualIncome: income });

    // Same map cell (e.g. next door to campus): use straight walking time instead of the 0 in the table.
    const walk = Math.max(3, Math.round((Math.hypot((lat - place.lat) * 111_320, (lon - place.lng) * 84_300) * 1.3) / 80));
    const wk = home === w ? walk : commute(data, "weekday", home, w);
    const sat = home === w ? walk : commute(data, "saturday", home, w);
    if (wk === UNREACHABLE) return { unreachable: true as const, place: place.name };
    const here = cost(rent, wk, sat);

    // best-connected hex in every other neighborhood
    const best = new Map<string, { wk: number; sat: number }>();
    data.hexes.forEach((h, i) => {
      const t = commute(data, "weekday", i, w);
      if (t === UNREACHABLE || h.nta === homeNta) return;
      const cur = best.get(h.nta);
      if (!cur || t < cur.wk) best.set(h.nta, { wk: t, sat: commute(data, "saturday", i, w) });
    });
    const options: Option[] = [...best.entries()].flatMap(([nta, t]) => {
      const r = data.ntas[nta]?.rent[beds];
      if (!r || data.ntas[nta].estimated) return [];
      const c = cost(r, t.wk, t.sat);
      return [{ nta, name: short(data.ntas[nta].name), rent: r, wk: t.wk, sat: t.sat, hours: c.hoursPerWeek, timeValue: c.timeValue, total: c.total }];
    });
    // cheaper but longer: the biggest savings that still keep the commute under an hour
    const cheaper = options.filter((o) => o.rent <= rent - 150 && o.wk > wk && o.wk <= 60)
      .sort((a, b) => a.rent - b.rent).slice(0, 2);
    // pricier but shorter: the biggest time win within +$600
    const faster = options.filter((o) => o.wk < wk - 5 && o.rent > rent && o.rent <= rent + 600)
      .sort((a, b) => a.wk - b.wk).slice(0, 1);
    return { unreachable: false as const, place: place.name, rent, median, wk, sat, here, income, cheaper, faster };
  }, [data, work, beds, rentInput, lat, lon]);

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">The cheap-rent tradeoff</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <label className="text-xs text-stone-500">You work / study at
          <select value={work} onChange={(e) => setWork(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900">
            {PLACES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500">Size
          <select value={beds} onChange={(e) => { setBeds(e.target.value as keyof Rent); setRentInput(""); }} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900">
            {BEDS.map((b) => <option key={b} value={b}>{b === "studio" ? "Studio" : b.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="col-span-2 text-xs text-stone-500 sm:col-span-1">Asking rent ($/mo)
          <input inputMode="numeric" value={rentInput} onChange={(e) => setRentInput(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={result && !result.unreachable && result.median ? `${result.median} (area median)` : "e.g. 2400"}
            className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900" />
        </label>
      </div>

      {!data && <div className="mt-4 h-24 animate-pulse rounded-xl bg-stone-100" />}
      {result?.unreachable && <p className="mt-4 text-sm text-stone-600">No subway route from here to {result.place} within 90 minutes.</p>}
      {result && !result.unreachable && (
        <>
          <p className="mt-4 text-sm leading-relaxed">
            From here, <b>{result.wk} min</b> each way to {result.place} ({result.sat} on Saturdays): about{" "}
            <b>{hrs(result.here.hoursPerWeek)} hours a week</b> commuting, worth <b>{money(result.here.timeValue)}/mo</b> of your time.
            True cost <b>{money(result.here.total)}/mo</b>.
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Landlords usually want income ≥ 40× rent: {money(result.rent * 40)}/yr for {money(result.rent)}/mo.
          </p>
          <ul className="mt-3 space-y-2">
            {[...result.cheaper, ...result.faster].map((o) => {
              const save = result.rent - o.rent;
              const dh = o.hours - result.here.hoursPerWeek;
              const dv = o.timeValue - result.here.timeValue;
              const net = o.total - result.here.total;
              return (
                <li key={o.nta} className="rounded-xl bg-stone-50 p-3 text-sm">
                  <p className="font-medium">
                    {save > 0
                      ? <>{o.name} is <span className="text-emerald-700">{money(save)}/mo cheaper</span>, but costs you <span className="text-rose-700">{hrs(dh)} more hours a week</span></>
                      : <>{o.name} is <span className="text-rose-700">{money(-save)}/mo more</span>, but gives you back <span className="text-emerald-700">{hrs(-dh)} hours a week</span></>}
                  </p>
                  <p className="text-xs text-stone-500">
                    {o.wk} min each way · that time is worth {money(Math.abs(dv))}/mo ·{" "}
                    {net < 0 ? <b className="text-emerald-700">saves {money(-net)}/mo overall</b> : <b className="text-rose-700">costs {money(net)}/mo more overall</b>}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-stone-400">
            Area median rents (StreetEasy) unless you enter the asking rent. 5 weekday + 1 Saturday round trips; time valued at half your hourly pay (US DOT), pay estimated from the 40× rule.
          </p>
        </>
      )}
    </section>
  );
}
