"use client";

import { useEffect, useState } from "react";

type Point = [string, number];

// Small inline chart of quarterly median asking rent since 2010.
export default function RentTrend({ nta, beds }: { nta: string; beds: string }) {
  const [state, setState] = useState<{ key: string; series: Point[]; source: string } | null>(null);
  const key = `${nta}|${beds}`;

  useEffect(() => {
    let live = true;
    fetch(`/api/trend?nta=${nta}&beds=${beds}`)
      .then((r) => r.json())
      .then((d) => live && setState({ key, series: d.series ?? [], source: d.source }))
      .catch(() => live && setState({ key, series: [], source: "none" }));
    return () => { live = false; };
  }, [nta, beds, key]);

  if (!state || state.key !== key) return <div className="mt-3 h-16 animate-pulse rounded-lg bg-stone-100" />;
  const s = state.series;
  if (s.length < 4) return null;

  const W = 280, H = 64, pad = 2;
  const vals = s.map((p) => p[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => pad + (i / (s.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * pad);
  const d = s.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const first = s[0], last = s[s.length - 1];
  const change = Math.round((last[1] / first[1] - 1) * 100);

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs text-stone-500">
        <span className="font-semibold uppercase tracking-wide">Rent since {first[0].slice(0, 4)}</span>
        <span>{change > 0 ? "+" : ""}{change}% · ${first[1].toLocaleString()} → ${last[1].toLocaleString()}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-16 w-full" role="img"
        aria-label={`${beds} median asking rent from ${first[0]} to ${last[0]}`}>
        <path d={`${d} L${x(s.length - 1)},${H} L${x(0)},${H} Z`} fill="rgb(99 102 241 / 0.12)" />
        <path d={d} fill="none" stroke="rgb(99 102 241)" strokeWidth="1.5" />
      </svg>
      <p className="text-[11px] text-stone-400">
        StreetEasy median asking rent, quarterly{state.source === "tiger" ? " · queried live from Tiger Data" : ""}
      </p>
    </div>
  );
}
