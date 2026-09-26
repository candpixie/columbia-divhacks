"use client";

// Landlord track record: problems reported vs fixed per year, what's still open, and heat by winter.
import { useEffect, useState } from "react";

type History = {
  since: number;
  violations: {
    total: number; fixed: number; open: number; openOverYear: number; medianDaysToFix: number | null;
    byYear: { year: number; issued: number; fixed: number; open: number }[];
    categories: { name: string; total: number; open: number }[];
  };
  heat: { bySeason: { season: string; complaints: number }[]; trend: "worse" | "better" | "steady" | "none" };
  sources: string[];
};

const n = (x: number) => x.toLocaleString();
const TREND = {
  worse: { text: "Getting worse", cls: "bg-rose-100 text-rose-800" },
  better: { text: "Getting better", cls: "bg-emerald-100 text-emerald-800" },
  steady: { text: "About the same", cls: "bg-stone-100 text-stone-700" },
  none: { text: "", cls: "" },
};

function fixTime(days: number | null) {
  if (days === null) return "";
  if (days < 45) return `${days} days`;
  if (days < 365) return `about ${Math.round(days / 30)} months`;
  return `about ${(days / 365).toFixed(1)} years`;
}

export default function TrackRecord({ bbl }: { bbl: string }) {
  const [h, setH] = useState<History | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/history?bbl=${bbl}`)
      .then((r) => r.json())
      .then((d) => { if (!live) return; if (d.error) setErr(true); else setH(d); })
      .catch(() => live && setErr(true));
    return () => { live = false; };
  }, [bbl]);

  if (err) return null;
  if (!h) return <div className="mt-4 h-40 animate-pulse rounded-2xl bg-white" />;
  const v = h.violations;
  const maxYear = Math.max(1, ...v.byYear.map((y) => y.issued));
  const maxHeat = Math.max(1, ...h.heat.bySeason.map((s) => s.complaints));
  const t = TREND[h.heat.trend];

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Track record: does the landlord fix things?</h3>

      {v.total === 0 ? (
        <p className="mt-3 text-sm text-stone-600">No housing code violations recorded since {h.since}.</p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed">
            Since {h.since}, inspectors recorded <b>{n(v.total)} problems</b>. <b className="text-emerald-700">{n(v.fixed)} were fixed</b>
            {v.medianDaysToFix !== null && <>, typically in <b>{fixTime(v.medianDaysToFix)}</b></>}.
            {v.open > 0 && <> <b className="text-rose-700">{n(v.open)} still open</b>{v.openOverYear > 0 && <>, {n(v.openOverYear)} of them for over a year</>}.</>}
          </p>

          <div className="mt-3 flex h-24 items-end gap-1" role="img" aria-label="Problems reported per year, fixed versus still open">
            {v.byYear.map((y) => (
              <div key={y.year} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${(y.issued / maxYear) * 72}px` }}
                  title={`${y.year}: ${y.issued} reported, ${y.fixed} fixed, ${y.open} open`}>
                  <div className="bg-emerald-400" style={{ height: `${(y.fixed / y.issued) * 100}%` }} />
                  <div className="bg-rose-500" style={{ height: `${(y.open / y.issued) * 100}%` }} />
                </div>
                <span className="text-[10px] text-stone-400">{String(y.year).slice(2)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 flex gap-3 text-[11px] text-stone-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />fixed</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-500" />still open</span>
            <span>problems reported per year</span>
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {v.categories.filter((c) => c.name !== "Other").slice(0, 6).map((c) => (
              <span key={c.name} className={`rounded-full px-2.5 py-1 text-xs ${c.open ? "bg-rose-50 text-rose-800" : "bg-stone-100 text-stone-600"}`}>
                {c.name}: {n(c.total)}{c.open ? ` (${c.open} open)` : ""}
              </span>
            ))}
          </div>
        </>
      )}

      {h.heat.bySeason.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">No-heat complaints, by winter</p>
            {t.text && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.cls}`}>{t.text}</span>}
          </div>
          <div className="mt-2 space-y-1">
            {h.heat.bySeason.map((s) => (
              <div key={s.season} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-stone-500">{s.season}</span>
                <div className="h-3 rounded-sm bg-amber-400" style={{ width: `${Math.max(1, (s.complaints / maxHeat) * 70)}%` }} />
                <span className="text-stone-600">{n(s.complaints)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-stone-400">Source: {h.sources.join(", ")}. &quot;Fixed&quot; means the city closed the violation.</p>
    </section>
  );
}
