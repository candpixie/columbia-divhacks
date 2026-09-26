"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatchReport, Flag } from "@/lib/catch";

const EXAMPLES = [
  { label: "707 E 242nd St, Bronx", q: "707 East 242 Street Bronx" },
  { label: "106 Morningside Dr", q: "106 Morningside Drive Manhattan" },
  { label: "189 Schermerhorn St", q: "189 Schermerhorn St Brooklyn" },
];

const DOT: Record<Flag["level"], string> = { red: "bg-rose-500", amber: "bg-amber-400", green: "bg-emerald-500" };
const TINT: Record<Flag["level"], string> = { red: "bg-rose-50", amber: "bg-amber-50", green: "bg-emerald-50" };

type Result = (CatchReport & { label?: string }) | { error: string };

export default function CatchPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function lookup(address: string) {
    if (address.trim().length < 4) return;
    setQ(address);
    setLoading(true);
    setResult(null);
    const url = new URL(window.location.href);
    url.searchParams.set("address", address);
    window.history.replaceState(null, "", url);
    try {
      const r = await fetch(`/api/catch?address=${encodeURIComponent(address)}`);
      setResult(await r.json());
    } catch {
      setResult({ error: "Lookup failed. Check your connection and try again." });
    } finally {
      setLoading(false);
    }
  }

  // Shared links (e.g. from the group-chat agent) open straight to a report.
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("address");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (a) lookup(a);
  }, []);

  const report = result && !("error" in result) ? result : null;
  const reds = report?.flags.filter((f) => f.level === "red").length ?? 0;

  return (
    <main className="min-h-dvh bg-stone-100 px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">← Rent Radius map</Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">What&apos;s the catch?</h1>
        <p className="mt-1 text-stone-600">
          Listings show you the apartment. The public record shows you the building: heat, repairs, bedbugs,
          evictions, rent stabilization and who really owns it.
        </p>

        <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); lookup(q); }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Enter an NYC address, e.g. 106 Morningside Dr"
            aria-label="NYC street address"
            className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-500"
          />
          <button disabled={loading} className="rounded-xl bg-stone-900 px-5 py-3 font-medium text-white disabled:opacity-50">
            {loading ? "Checking…" : "Check"}
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {EXAMPLES.map((e) => (
            <button key={e.q} onClick={() => lookup(e.q)}
              className="rounded-full border border-stone-300 bg-white px-3 py-1 text-stone-600 hover:border-stone-500 hover:text-stone-900">
              {e.label}
            </button>
          ))}
        </div>

        {loading && <div className="mt-6 h-48 animate-pulse rounded-2xl bg-white" />}

        {result && "error" in result && (
          <p className="mt-6 rounded-2xl bg-white p-5 text-stone-600">{result.error}</p>
        )}

        {report && (
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-stone-400">
              {report.units} apartments{report.yearBuilt ? ` · built ${report.yearBuilt}` : ""} · BBL {report.bbl}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{report.address}</h2>
            {report.label && report.label.toUpperCase().split(",")[0] !== report.address && (
              <p className="text-sm text-stone-500">Searched: {report.label}</p>
            )}
            <p className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-medium ${reds ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>
              {report.verdict}
            </p>

            <ul className="mt-4 space-y-2">
              {report.flags.map((f) => (
                <li key={f.title} className={`rounded-xl p-3 ${TINT[f.level]}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[f.level]}`} aria-label={f.level} />
                    <div>
                      <p className="font-medium">{f.title}</p>
                      <p className="text-sm text-stone-600">{f.detail}</p>
                      <p className="mt-0.5 text-xs text-stone-400">Source: {f.source}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {report.links.length > 0 && (
              <div className="mt-5 border-t border-stone-200 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">What you can do</h3>
                <ul className="mt-2 space-y-2">
                  {report.links.map((l) => (
                    <li key={l.id}>
                      <a href={l.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 hover:underline">{l.label} ↗</a>
                      <p className="text-sm text-stone-500">{l.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-4 text-xs text-stone-400">
              Public records only (NYC 311, HPD, DOI, DHCR via nycdb), queried from Tiger Data. Not legal advice.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
