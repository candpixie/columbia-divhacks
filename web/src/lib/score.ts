// Shared scoring: used by the web map and the iMessage agent.
// Filter first (every commute <= max, rent <= combined budget), then rank.

export type Hex = { h3: string; nta: string; lat: number; lng: number };
export type Rent = { studio: number; "1br": number; "2br": number; "3br": number };
export type Nta = { name: string; borough: string; rent: Rent; estimated: boolean; trend: number | null };
export type Person = { name: string; place: string; maxMin: number; budget: number };
export type Day = "weekday" | "saturday";

export type Data = {
  hexes: Hex[];
  ntas: Record<string, Nta>;
  matrix: Record<Day, Uint8Array>;
};

export const UNREACHABLE = 255;

export function bedsFor(n: number): keyof Rent {
  return n <= 1 ? "1br" : n === 2 ? "2br" : "3br";
}

export function nearestHex(hexes: Hex[], lat: number, lng: number): number {
  let best = 0;
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  hexes.forEach((h, i) => {
    const d = (h.lat - lat) ** 2 + ((h.lng - lng) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// minutes from hex `home` to hex `work`
export function commute(data: Data, day: Day, home: number, work: number): number {
  return data.matrix[day][home * data.hexes.length + work];
}

export type HexResult = {
  i: number;
  times: number[]; // per person
  worst: number;
  rent: number; // whole unit
  fits: boolean;
};

export function scoreHexes(data: Data, day: Day, people: Person[], workIdx: number[]): HexResult[] {
  const beds = bedsFor(people.length);
  const budget = people.reduce((s, p) => s + p.budget, 0);
  return data.hexes.map((h, i) => {
    const times = workIdx.map((w) => commute(data, day, i, w));
    const worst = Math.max(...times);
    const rent = data.ntas[h.nta]?.rent[beds] ?? Infinity;
    const fits = times.every((t, k) => t !== UNREACHABLE && t <= people[k].maxMin) && rent <= budget;
    return { i, times, worst, rent, fits };
  });
}

export type NtaResult = {
  nta: string;
  name: string;
  rent: number;
  times: number[]; // best hex in the neighborhood, per person
  worst: number;
  score: number;
};

// Aggregate fitting hexes to neighborhoods and rank.
// score = 0.6 * rent headroom + 0.4 * commute slack (both 0-1). Essentials/reliability join when their data lands.
export function rankNeighborhoods(data: Data, results: HexResult[], people: Person[]): NtaResult[] {
  const budget = people.reduce((s, p) => s + p.budget, 0);
  const best = new Map<string, HexResult>();
  for (const r of results) {
    if (!r.fits) continue;
    const nta = data.hexes[r.i].nta;
    const cur = best.get(nta);
    if (!cur || r.worst < cur.worst) best.set(nta, r);
  }
  const maxAllowed = Math.max(...people.map((p) => p.maxMin));
  return [...best.entries()]
    .map(([nta, r]) => {
      const headroom = Math.max(0, (budget - r.rent) / budget);
      const slack = Math.max(0, (maxAllowed - r.worst) / maxAllowed);
      return {
        nta,
        name: data.ntas[nta].name,
        rent: r.rent,
        times: r.times,
        worst: r.worst,
        score: 0.6 * headroom + 0.4 * slack,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function loadData(base = "/data"): Promise<Data> {
  const [hexes, ntas, wk, sat] = await Promise.all([
    fetch(`${base}/hexes.json`).then((r) => r.json()),
    fetch(`${base}/ntas.json`).then((r) => r.json()),
    fetch(`${base}/matrix_weekday.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}/matrix_saturday.bin`).then((r) => r.arrayBuffer()),
  ]);
  return { hexes, ntas, matrix: { weekday: new Uint8Array(wk), saturday: new Uint8Array(sat) } };
}
