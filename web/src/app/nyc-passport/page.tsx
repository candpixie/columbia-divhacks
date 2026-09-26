"use client";

// NYC Passport: light up the city as you explore it, collect neighborhood stamps,
// find places you've never been within 30 minutes, and compare with friends (Beli-style, no accounts).
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { latLngToCell } from "h3-js";
import { PLACES, placeById } from "@/lib/places";
import { commute, loadData, nearestHex, UNREACHABLE, type Data, type HexResult } from "@/lib/score";
import { decode, demoVisits, encode, load, save, shareLink } from "@/lib/passport";

const HexMap = dynamic(() => import("@/components/HexMap"), { ssr: false });

type Place = { name: string; kind: string; lat: number; lon: number; hex: number; nta: string };
type Friend = { name: string; visited: Set<number> };

const ME: [number, number, number] = [79, 70, 229];
const FRIEND: [number, number, number] = [236, 72, 153];
const BOTH: [number, number, number] = [147, 51, 234];
const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
const KIND_ICON: Record<string, string> = { Park: "🌳", Library: "📚", Museum: "🏛️", Gallery: "🖼️", Market: "🧺", Viewpoint: "🌇" };
const short = (n: string) => n.split(/[-(]/)[0].trim();

export default function PassportPage() {
  const [data, setData] = useState<Data | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [name, setName] = useState("");
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [friends, setFriends] = useState<Friend[]>([]);
  const [focusFriend, setFocusFriend] = useState<string | null>(null);
  const [stampMode, setStampMode] = useState(false);
  const [from, setFrom] = useState("columbia");
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadData().then(setData);
    fetch("/data/explore.json").then((r) => r.json()).then(setPlaces).catch(() => {});
  }, []);

  // Restore my passport, and pick up a friend's shared link (?friend=...&name=...).
  useEffect(() => {
    if (!data) return;
    const total = data.hexes.length;
    const saved = load();
    const q = new URLSearchParams(window.location.search);
    const fr = (saved?.friends ?? []).map((f) => ({ name: f.name, visited: decode(f.code, total) }));
    const code = q.get("friend");
    if (code) {
      const fname = (q.get("name") ?? "A friend").slice(0, 30);
      if (!fr.some((f) => f.name === fname)) fr.push({ name: fname, visited: decode(code, total) });
      window.history.replaceState(null, "", "/nyc-passport");
    }
    /* eslint-disable react-hooks/set-state-in-effect -- restoring browser-only state once data is loaded */
    setName(saved?.name ?? "");
    setVisited(saved ? decode(saved.code, total) : new Set());
    setFriends(fr);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [data]);

  useEffect(() => {
    if (!ready || !data) return;
    const total = data.hexes.length;
    save({ name, code: encode(visited, total), friends: friends.map((f) => ({ name: f.name, code: encode(f.visited, total) })) });
  }, [ready, data, name, visited, friends]);

  const stamp = useCallback((cells: number[]) => {
    setVisited((v) => { const n = new Set(v); cells.forEach((c) => n.add(c)); return n; });
  }, []);

  function hexFor(lat: number, lon: number): number | null {
    if (!data) return null;
    const cell = latLngToCell(lat, lon, 8);
    const i = data.hexes.findIndex((h) => h.h3 === cell);
    if (i >= 0) return i;
    const n = nearestHex(data.hexes, lat, lon);
    const h = data.hexes[n];
    return Math.hypot((h.lat - lat) * 111, (h.lng - lon) * 84) < 1 ? n : null; // within ~1 km of residential NYC
  }

  async function importPhotos(files: FileList | null) {
    if (!files?.length) return;
    setNote(`Reading ${files.length} photos on your device…`);
    const exifr = (await import("exifr")).default;
    const cells: number[] = [];
    let located = 0;
    for (const f of Array.from(files)) {
      try {
        const gps = await exifr.gps(f);
        if (gps?.latitude) {
          located++;
          const i = hexFor(gps.latitude, gps.longitude);
          if (i !== null) cells.push(i);
        }
      } catch { /* not a photo with GPS */ }
    }
    stamp(cells);
    setNote(`${files.length} photos · ${located} had a location · ${new Set(cells).size} places in NYC stamped. Photos never left your device.`);
  }

  function imHere() {
    if (!navigator.geolocation) return setNote("This browser can't share location. Tap the map instead.");
    setNote("Finding you (just once, not tracked)…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const i = hexFor(p.coords.latitude, p.coords.longitude);
        if (i === null) return setNote("You're outside the NYC map right now.");
        stamp([i]);
        setNote(`Stamped ${short(data!.ntas[data!.hexes[i].nta]?.name ?? "this spot")}.`);
      },
      () => setNote("Location permission was denied. Tap the map to stamp instead."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const onPickHex = useCallback((i: number) => {
    if (!stampMode) return;
    setVisited((v) => { const n = new Set(v); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  }, [stampMode]);
  const onPick = useCallback(() => {}, []);

  // ---- stats ----
  const ntaOf = useCallback((set: Set<number>) => new Set([...set].map((i) => data?.hexes[i]?.nta).filter(Boolean) as string[]), [data]);
  const myNtas = useMemo(() => ntaOf(visited), [ntaOf, visited]);
  const totalNtas = data ? new Set(data.hexes.map((h) => h.nta)).size : 0;
  const rawPct = data ? (100 * visited.size) / data.hexes.length : 0;
  const pct = rawPct > 0 && rawPct < 10 ? rawPct.toFixed(1) : Math.round(rawPct).toString();

  const leaderboard = useMemo(() => {
    const rows = [{ name: name || "You", me: true, ntas: myNtas.size, hexes: visited.size },
      ...friends.map((f) => ({ name: f.name, me: false, ntas: ntaOf(f.visited).size, hexes: f.visited.size }))];
    return rows.sort((a, b) => b.ntas - a.ntas);
  }, [name, myNtas, visited, friends, ntaOf]);

  // Conversation starters: neighborhoods only a friend has stamped.
  const starters = useMemo(() => {
    if (!data) return [];
    const mine = new Set([...myNtas].map((n) => short(data.ntas[n]?.name ?? n)));
    return friends.flatMap((f) => {
      // NYC splits some neighborhoods (e.g. two "Sunset Park"s); dedupe by the name people actually say
      const names = [...new Set([...ntaOf(f.visited)].map((n) => short(data.ntas[n]?.name ?? n)))].filter((n) => !mine.has(n));
      return names.slice(0, 2).map((name) => ({ friend: f.name, nta: name, name }));
    });
  }, [data, friends, ntaOf, myNtas]);

  // ---- I have 30 minutes ----
  const suggestions = useMemo(() => {
    if (!data || !places.length) return [];
    const p = placeById(from);
    if (!p) return [];
    const start = nearestHex(data.hexes, p.lat, p.lng);
    const best = new Map<string, { hex: number; t: number }>();
    data.hexes.forEach((h, i) => {
      const t = commute(data, "weekday", start, i);
      if (t === UNREACHABLE || t > 30 || myNtas.has(h.nta)) return;
      const cur = best.get(h.nta);
      if (!cur || t < cur.t) best.set(h.nta, { hex: i, t });
    });
    const byNta = new Map<string, Place[]>();
    places.forEach((pl) => byNta.set(pl.nta, [...(byNta.get(pl.nta) ?? []), pl]));
    const order = ["Museum", "Market", "Viewpoint", "Park", "Gallery", "Library"];
    return [...best.entries()]
      .filter(([nta]) => byNta.has(nta))
      .sort((a, b) => a[1].t - b[1].t)
      .slice(0, 5)
      .map(([nta, v]) => {
        const pick = [...byNta.get(nta)!].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
        return { nta, name: short(data.ntas[nta]?.name ?? nta), minutes: v.t, place: pick };
      });
  }, [data, places, from, myNtas]);

  // ---- map coloring ----
  const focus = friends.find((f) => f.name === focusFriend);
  const suggestNtas = useMemo(() => new Set(suggestions.map((s) => s.nta)), [suggestions]);
  const results: HexResult[] = useMemo(() => (data ? data.hexes.map((_, i) => ({ i, times: [], worst: 0, rent: 0, fits: true })) : []), [data]);
  const fill = useMemo(() => (r: { i: number }) => {
    const mine = visited.has(r.i);
    const theirs = focus?.visited.has(r.i) ?? false;
    if (mine && theirs) return [...BOTH, 210] as [number, number, number, number];
    if (mine) return [...ME, 190] as [number, number, number, number];
    if (theirs) return [...FRIEND, 170] as [number, number, number, number];
    if (data && suggestNtas.has(data.hexes[r.i].nta)) return [245, 158, 11, 90] as [number, number, number, number];
    return [120, 120, 130, 14] as [number, number, number, number];
  }, [visited, focus, suggestNtas, data]);
  const pins = useMemo(() => suggestions.map((s) => ({ lat: s.place.lat, lng: s.place.lon, color: [245, 158, 11] as [number, number, number] })), [suggestions]);

  async function copyShare() {
    if (!data) return;
    const link = shareLink({ name: name || "A friend", visited }, data.hexes.length, window.location.origin);
    try { await navigator.clipboard.writeText(link); setNote("Your passport link is copied. Send it to a friend."); }
    catch { setNote(link); }
  }

  function addFriendFromLink(text: string) {
    if (!data) return;
    try {
      const u = new URL(text.trim());
      const code = u.searchParams.get("friend");
      if (!code) throw new Error();
      const fname = (u.searchParams.get("name") ?? "A friend").slice(0, 30);
      setFriends((fs) => [...fs.filter((f) => f.name !== fname), { name: fname, visited: decode(code, data.hexes.length) }]);
      setNote(`Added ${fname}'s passport.`);
    } catch { setNote("That doesn't look like an NYC Passport link."); }
  }

  function addDemoFriends() {
    if (!data) return;
    const find = (words: string[]) => Object.entries(data.ntas).filter(([, n]) => words.some((w) => n.name.includes(w))).map(([c]) => c);
    setFriends((fs) => [
      ...fs.filter((f) => !f.name.endsWith("(demo)")),
      { name: "Maya (demo)", visited: demoVisits(data.hexes, find(["Flushing", "Sunset Park", "Jackson Heights", "Astoria", "Chinatown"]), 7) },
      { name: "Jordan (demo)", visited: demoVisits(data.hexes, find(["Williamsburg", "Bushwick", "Harlem", "Red Hook", "Greenpoint"]), 11) },
    ]);
    setNote("Added two demo friends (fictional).");
  }

  const stampsByBorough = useMemo(() => {
    if (!data) return [];
    return BOROUGHS.map((b) => ({
      borough: b,
      total: Object.values(data.ntas).filter((n) => n.borough === b).length,
      mine: [...myNtas].filter((c) => data.ntas[c]?.borough === b).map((c) => short(data.ntas[c].name)).sort(),
    }));
  }, [data, myNtas]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-stone-100 text-stone-900">
      {data && <HexMap data={data} results={results} selectedNta={null} workPins={pins} onPick={onPick} onPickHex={onPickHex}
        fill={fill} fillKey={`${visited.size}-${focusFriend}-${[...suggestNtas].join()}`} />}

      <aside className="absolute left-4 top-4 bottom-4 flex w-[23rem] max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto rounded-2xl bg-white/95 p-4 shadow-xl backdrop-blur">
        <header>
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span className="font-semibold uppercase tracking-widest text-indigo-700">NYC Passport</span>
            <Link href="/" className="hover:text-stone-900">Rent Radius map →</Link>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 30))} placeholder="Your name"
            className="mt-2 w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-stone-300" aria-label="Your name" />
          <div className="mt-2 flex gap-6">
            <div><p className="text-3xl font-semibold text-indigo-700">{pct}%</p><p className="text-xs text-stone-500">of NYC explored</p></div>
            <div><p className="text-3xl font-semibold">{myNtas.size}<span className="text-base text-stone-400">/{totalNtas}</span></p><p className="text-xs text-stone-500">neighborhood stamps</p></div>
          </div>
        </header>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Add stamps</h2>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="cursor-pointer rounded-xl border border-stone-200 p-2 text-center hover:border-stone-400">
              📷<br />Photos
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => importPhotos(e.target.files)} />
            </label>
            <button onClick={imHere} className="rounded-xl border border-stone-200 p-2 hover:border-stone-400">📍<br />I&apos;m here</button>
            <button onClick={() => setStampMode((m) => !m)} className={`rounded-xl border p-2 ${stampMode ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-stone-200 hover:border-stone-400"}`}>
              👆<br />{stampMode ? "Tapping on" : "Tap map"}
            </button>
          </div>
          <p className="text-xs text-stone-500">{note || "No background tracking. Photo locations are read on your device and never uploaded."}</p>
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">I have 30 minutes</h2>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[55%] rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs" aria-label="Starting from">
              {PLACES.map((p) => <option key={p.id} value={p.id}>from {p.name}</option>)}
            </select>
          </div>
          <ol className="mt-2 space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.nta} className="rounded-xl bg-amber-50 p-2.5 text-sm">
                <p className="font-medium">{s.name} <span className="font-normal text-stone-500">· {s.minutes < 3 ? "walking distance" : `${s.minutes} min`} · never stamped</span></p>
                <p className="text-xs text-stone-600">{KIND_ICON[s.place.kind] ?? "📍"} {s.place.name} ({s.place.kind.toLowerCase()})</p>
              </li>
            ))}
            {!suggestions.length && data && <p className="text-sm text-stone-500">You&apos;ve stamped everything within 30 minutes of here. Impressive.</p>}
          </ol>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Friends</h2>
            <button onClick={copyShare} className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white">Share my passport</button>
          </div>
          <ol className="mt-2 space-y-1">
            {leaderboard.map((r, k) => (
              <li key={r.name + k}>
                <button disabled={r.me} onClick={() => setFocusFriend((f) => (f === r.name ? null : r.name))}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${focusFriend === r.name ? "bg-pink-50" : "hover:bg-stone-50"}`}>
                  <span><span className="mr-2 text-stone-400">{k + 1}</span>{r.me ? <b>{r.name}</b> : r.name}</span>
                  <span className="text-stone-500">{r.ntas} stamps</span>
                </button>
              </li>
            ))}
          </ol>
          {starters.length > 0 && (
            <div className="mt-2 space-y-1">
              {starters.slice(0, 3).map((s) => (
                <p key={s.friend + s.nta} className="rounded-lg bg-pink-50 px-2 py-1.5 text-xs text-pink-900">
                  💬 Only {s.friend.replace(" (demo)", "")} has been to <b>{s.name}</b>. Ask them what&apos;s good there.
                </p>
              ))}
            </div>
          )}
          <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); addFriendFromLink(String(f.get("link") ?? "")); e.currentTarget.reset(); }}>
            <input name="link" placeholder="Paste a friend's passport link" className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2 py-1 text-xs" />
            <button className="rounded-lg border border-stone-200 px-2 text-xs">Add</button>
          </form>
          <button onClick={addDemoFriends} className="mt-1 text-xs text-stone-400 underline hover:text-stone-700">Add demo friends</button>
          <p className="mt-1 flex gap-3 text-[11px] text-stone-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: `rgb(${ME})` }} />you</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: `rgb(${FRIEND})` }} />friend</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: `rgb(${BOTH})` }} />both</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />30-min ideas</span>
          </p>
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Stamps</h2>
          <div className="mt-2 space-y-3">
            {stampsByBorough.map((b) => (
              <div key={b.borough}>
                <div className="flex justify-between text-xs"><span className="font-medium">{b.borough}</span><span className="text-stone-500">{b.mine.length}/{b.total}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-stone-100"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(100 * b.mine.length) / Math.max(1, b.total)}%` }} /></div>
                {b.mine.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {b.mine.map((n) => <span key={n} className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-800">✓ {n}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
