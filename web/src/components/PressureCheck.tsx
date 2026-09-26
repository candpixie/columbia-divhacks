"use client";

// "Is it really that competitive, or is the broker pressuring me?"
// Neighborhood market heat (StreetEasy price cuts + inventory + rent trend) plus where this asking rent sits.
import { useEffect, useState } from "react";

type Comp = {
  asOf: string;
  city: { discount: number; invYoy: number; byMonth: { month: number; discount: number }[] };
  ntas: Record<string, { heat: number; label: string; discount: number; invYoy: number; rentYoy: number; inventory: number }>;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TONE: Record<string, string> = {
  "Very competitive": "bg-rose-100 text-rose-800",
  Competitive: "bg-amber-100 text-amber-800",
  "Room to negotiate": "bg-emerald-100 text-emerald-800",
};

export default function PressureCheck({ nta, name, rent, median, typedRent }: {
  nta: string; name: string; rent: number; median: number | undefined; typedRent: boolean;
}) {
  const [c, setC] = useState<Comp | null>(null);
  useEffect(() => { fetch("/data/competition.json").then((r) => r.json()).then(setC).catch(() => {}); }, []);
  if (!c) return null;
  const m = c.ntas[nta];
  const now = new Date().getMonth() + 1;
  const best = [...c.city.byMonth].sort((a, b) => b.discount - a.discount).slice(0, 2).map((x) => MONTHS[x.month - 1]);
  const worst = [...c.city.byMonth].sort((a, b) => a.discount - b.discount)[0];
  const thisMonth = c.city.byMonth.find((x) => x.month === now);

  // Where this asking rent sits vs the neighborhood median
  const vsMedian = typedRent && median ? rent / median - 1 : null;
  let priceCall: { text: string; tone: string } | null = null;
  if (vsMedian !== null) {
    if (vsMedian <= -0.1) priceCall = { tone: "text-rose-700", text: `This rent is ${pct(-vsMedian)} below the area median. Priced like this, it will likely go within a day or two: have your documents ready before the viewing.` };
    else if (vsMedian >= 0.1) priceCall = { tone: "text-emerald-700", text: `This rent is ${pct(vsMedian)} above the area median. Places priced above the market tend to sit, so "apply today" is probably pressure. Ask about a lower rent or a free month.` };
    else priceCall = { tone: "text-stone-700", text: "This rent is close to the area median: a fair price for the market." };
  }

  return (
    <div className="mt-4 rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Pressure check: is &quot;apply today&quot; real?</p>
        {m && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[m.label]}`}>{m.label}</span>}
      </div>

      {m ? (
        <ul className="mt-2 space-y-1 text-sm text-stone-700">
          <li>
            <b>{pct(m.discount)}</b> of listings in {name} cut their price lately (NYC: {pct(c.city.discount)}).
            {m.discount < c.city.discount * 0.7 ? " Landlords here rarely need to budge." : m.discount > c.city.discount * 1.2 ? " Landlords here often lower prices." : ""}
          </li>
          <li>
            Listings are <b>{m.invYoy < 0 ? `down ${pct(-m.invYoy)}` : `up ${pct(m.invYoy)}`}</b> vs a year ago
            {m.invYoy < -0.05 ? " (less supply, more competition)" : m.invYoy > 0.05 ? " (more choice for you)" : ""}.
          </li>
          {m.rentYoy !== 0 && <li>Asking rents are <b>{m.rentYoy > 0 ? "up" : "down"} {Math.abs(m.rentYoy)}%</b> vs last year.</li>}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-stone-500">Not enough listings here to judge competition.</p>
      )}

      {priceCall ? <p className={`mt-2 text-sm font-medium ${priceCall.tone}`}>{priceCall.text}</p>
        : <p className="mt-2 text-xs text-stone-500">Enter the asking rent above to see whether this price will go fast.</p>}

      <p className="mt-2 text-xs text-stone-500">
        Timing: citywide, the most listings cut prices in <b>{best.join(" and ")}</b>; the fewest in {MONTHS[worst.month - 1]}.
        {thisMonth && <> Right now ({MONTHS[now - 1]}) about {pct(thisMonth.discount)} typically do.</>}
      </p>

      <details className="mt-3 text-xs text-stone-600">
        <summary className="cursor-pointer font-medium text-stone-800">Your rights + what to have ready</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Application fees are capped at $20 in New York State.</li>
          <li>A security deposit can be at most one month&apos;s rent.</li>
          <li>Under NYC&apos;s FARE Act (2025), you don&apos;t pay the fee of a broker the landlord hired.</li>
          <li>Have ready: photo ID, last 2–3 pay stubs or an offer letter, bank statements, credit report, landlord reference. Landlords usually want yearly income of 40× the rent, or a guarantor.</li>
        </ul>
        <p className="mt-1 text-[11px] text-stone-400">General information, not legal advice. Check nyc.gov for current rules.</p>
      </details>
      <p className="mt-2 text-[11px] text-stone-400">StreetEasy listings data through {c.asOf}, 3-month averages.</p>
    </div>
  );
}
