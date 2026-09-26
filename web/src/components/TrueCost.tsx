"use client";

import { commute, type Data, type Day, type NtaResult, type Person, type Rent } from "@/lib/score";
import { incomeFromBudget, splitRent, trueCost, type CostBreakdown } from "@/lib/trueCost";

type Props = {
  data: Data;
  people: Person[];
  workIdx: number[];
  beds: keyof Rent;
  a: string; // selected NTA
  b: string; // comparison NTA
  options: NtaResult[];
  onChangeB: (nta: string) => void;
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const hrs = (n: number) => (Math.abs(n) < 10 ? n.toFixed(1) : Math.round(n).toString());

// Commute from the neighborhood's best-connected hex (lowest worst-case weekday commute).
function costsFor(data: Data, people: Person[], workIdx: number[], beds: keyof Rent, nta: string): CostBreakdown[] | null {
  const hexIdx = data.hexes.flatMap((h, i) => (h.nta === nta ? [i] : []));
  if (!hexIdx.length) return null;
  const time = (day: Day, i: number, w: number) => commute(data, day, i, w);
  const best = hexIdx.reduce((a, i) =>
    Math.max(...workIdx.map((w) => time("weekday", i, w))) < Math.max(...workIdx.map((w) => time("weekday", a, w))) ? i : a);
  const shares = splitRent(data.ntas[nta].rent[beds], people.map((p) => p.budget));
  return people.map((p, k) => trueCost({
    rentShare: shares[k],
    weekdayMin: time("weekday", best, workIdx[k]),
    saturdayMin: time("saturday", best, workIdx[k]),
    annualIncome: p.income ?? incomeFromBudget(p.budget),
  }));
}

export default function TrueCost({ data, people, workIdx, beds, a, b, options, onChangeB }: Props) {
  const ca = costsFor(data, people, workIdx, beds, a);
  const cb = costsFor(data, people, workIdx, beds, b);
  if (!ca || !cb) return null;
  const sum = (c: CostBreakdown[], f: (x: CostBreakdown) => number) => c.reduce((s, x) => s + f(x), 0);
  const rentDelta = sum(cb, (x) => x.rent) - sum(ca, (x) => x.rent);
  const hourDelta = sum(cb, (x) => x.hoursPerWeek) - sum(ca, (x) => x.hoursPerWeek);
  const timeDelta = sum(cb, (x) => x.timeValue) - sum(ca, (x) => x.timeValue);
  const totalDelta = sum(cb, (x) => x.total) - sum(ca, (x) => x.total);
  const nameA = data.ntas[a].name;
  const nameB = data.ntas[b].name;
  const who = people.length > 1 ? "you all" : "you";

  // The headline: cheaper rent that quietly costs time (or the reverse).
  let headline: string;
  const sameTime = Math.abs(hourDelta) < 0.5;
  const sameRent = Math.abs(rentDelta) < 25;
  if (sameTime && sameRent) {
    headline = `${nameB} costs about the same as ${nameA} in rent and time.`;
  } else if (sameTime) {
    headline = `${nameB} is ${money(Math.abs(rentDelta))}/mo ${rentDelta < 0 ? "cheaper" : "more"}, with about the same commute.`;
  } else if (rentDelta < 0 && hourDelta > 0) {
    headline = `${nameB} is ${money(-rentDelta)}/mo cheaper, but costs ${who} ${hrs(hourDelta)} more hours a week (${money(Math.abs(timeDelta))} of your time).`;
  } else if (rentDelta > 0 && hourDelta < 0) {
    headline = `${nameB} costs ${money(rentDelta)}/mo more, but gives ${who} back ${hrs(-hourDelta)} hours a week (worth ${money(Math.abs(timeDelta))}).`;
  } else {
    headline = `${nameB} ${totalDelta < 0 ? "wins" : "loses"} on both: ${money(Math.abs(rentDelta))}/mo ${rentDelta < 0 ? "less" : "more"} rent and ${hrs(Math.abs(hourDelta))} ${hourDelta < 0 ? "fewer" : "more"} hours a week.`;
  }

  return (
    <div className="mt-3 rounded-xl bg-stone-50 p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
        <span className="font-semibold uppercase tracking-wide">True cost</span>
        <label>vs{" "}
          <select value={b} onChange={(e) => onChangeB(e.target.value)} className="rounded border border-stone-200 bg-white px-1 py-0.5 text-stone-900">
            {options.filter((o) => o.nta !== a).map((o) => <option key={o.nta} value={o.nta}>{o.name}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug">{headline}</p>
      <table className="mt-2 w-full text-xs">
        <thead className="text-stone-400">
          <tr><th className="text-left font-normal">per month</th><th className="text-right font-normal">{nameA.split("-")[0]}</th><th className="text-right font-normal">{nameB.split("-")[0]}</th></tr>
        </thead>
        <tbody>
          <tr><td>Rent</td><td className="text-right">{money(sum(ca, (x) => x.rent))}</td><td className="text-right">{money(sum(cb, (x) => x.rent))}</td></tr>
          <tr><td>Fares</td><td className="text-right">{money(sum(ca, (x) => x.fare))}</td><td className="text-right">{money(sum(cb, (x) => x.fare))}</td></tr>
          <tr><td>Commute hours / week</td><td className="text-right">{hrs(sum(ca, (x) => x.hoursPerWeek))}</td><td className="text-right">{hrs(sum(cb, (x) => x.hoursPerWeek))}</td></tr>
          <tr><td>Value of that time</td><td className="text-right">{money(sum(ca, (x) => x.timeValue))}</td><td className="text-right">{money(sum(cb, (x) => x.timeValue))}</td></tr>
          <tr className="font-semibold"><td>True cost</td><td className="text-right">{money(sum(ca, (x) => x.total))}</td><td className="text-right">{money(sum(cb, (x) => x.total))}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-snug text-stone-400">
        5 weekday + 1 Saturday round trips a week. Time valued at half your hourly pay (US DOT standard); pay estimated from the landlord 40x rule unless linked.
      </p>
    </div>
  );
}
