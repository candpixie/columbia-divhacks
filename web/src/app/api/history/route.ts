// GET /api/history?bbl=2051150024
// The landlord's track record for one building: which problems got fixed, how fast, and which never did.
// Live from NYC Open Data (HPD violations + 311 heat), cached for a day.
const SODA = "https://data.cityofnewyork.us/resource";
const DAY = 86_400_000;
const SINCE_YEAR = 2016;

type Violation = { novissueddate?: string; currentstatusdate?: string; violationstatus?: string; class?: string; novdescription?: string };
type MonthCount = { y: string; m: string; n: string };

const CATEGORIES: [string, RegExp][] = [
  ["Heat & hot water", /heat|hot water|boiler/i],
  ["Leaks & water damage", /leak|water damage|plumbing|drain|faucet|toilet|basin|water supply/i],
  ["Mold", /mold|mildew/i],
  ["Pests", /roach|mice|rat[s ]|rodent|vermin|bed ?bug|insect|infestation/i],
  ["Lead paint", /lead/i],
  ["Fire & gas safety", /smoke|carbon monoxide|fire|egress|sprinkler|gas/i],
  ["Doors, locks & windows", /door|lock|window|guard/i],
  ["Electrical", /electric|outlet|wiring|light fixture/i],
  ["Paint & plaster", /paint|plaster|ceiling|wall/i],
];

async function soda<T>(dataset: string, params: Record<string, string>): Promise<T[]> {
  const url = `${SODA}/${dataset}.json?${new URLSearchParams(params)}`;
  const res = await fetch(url, { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`${dataset} ${res.status}`);
  return res.json();
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export async function GET(request: Request) {
  const bbl = new URL(request.url).searchParams.get("bbl") ?? "";
  if (!/^\d{10}$/.test(bbl)) return Response.json({ error: "bad bbl" }, { status: 400 });
  const [boro, block, lot] = [bbl[0], String(+bbl.slice(1, 6)), String(+bbl.slice(6))];

  try {
    const [violations, heat] = await Promise.all([
      soda<Violation>("wvxf-dwi5", {
        $select: "novissueddate,currentstatusdate,violationstatus,class,novdescription",
        $where: `boroid='${boro}' AND block='${block}' AND lot='${lot}' AND novissueddate >= '${SINCE_YEAR}-01-01'`,
        $limit: "20000",
      }),
      soda<MonthCount>("erm2-nwe9", {
        $select: "date_extract_y(created_date) as y, date_extract_m(created_date) as m, count(*) as n",
        $where: `bbl='${bbl}' AND complaint_type='HEAT/HOT WATER' AND created_date >= '2019-10-01'`,
        $group: "y,m",
      }),
    ]);

    const now = Date.now();
    const byYear = new Map<number, { issued: number; fixed: number; open: number }>();
    const fixDays: number[] = [];
    let openOverYear = 0;
    const cats = new Map<string, { total: number; open: number }>();
    for (const v of violations) {
      if (!v.novissueddate) continue;
      const issued = Date.parse(v.novissueddate);
      const y = new Date(issued).getFullYear();
      const closed = /close/i.test(v.violationstatus ?? "");
      const row = byYear.get(y) ?? { issued: 0, fixed: 0, open: 0 };
      row.issued++;
      if (closed) {
        row.fixed++;
        const done = Date.parse(v.currentstatusdate ?? "");
        if (done > issued) fixDays.push((done - issued) / DAY);
      } else {
        row.open++;
        if (now - issued > 365 * DAY) openOverYear++;
      }
      byYear.set(y, row);
      const cat = CATEGORIES.find(([, re]) => re.test(v.novdescription ?? ""))?.[0] ?? "Other";
      const c = cats.get(cat) ?? { total: 0, open: 0 };
      c.total++;
      if (!closed) c.open++;
      cats.set(cat, c);
    }

    // Heating season = Oct through May, labeled by its start year ("2024-25").
    const seasons = new Map<number, number>();
    for (const r of heat) {
      const y = +r.y, m = +r.m;
      const start = m >= 10 ? y : m <= 5 ? y - 1 : null;
      if (start !== null) seasons.set(start, (seasons.get(start) ?? 0) + +r.n);
    }
    const heatBySeason = [...seasons.entries()].sort((a, b) => a[0] - b[0])
      .map(([s, n]) => ({ season: `${s}–${String(s + 1).slice(2)}`, complaints: n }));

    const total = violations.length;
    const fixed = [...byYear.values()].reduce((s, r) => s + r.fixed, 0);
    // Latest winter vs the average of the winters before it (a two-winter comparison hides long climbs).
    const last = heatBySeason.at(-1)?.complaints ?? 0;
    const earlier = heatBySeason.slice(0, -1).map((h) => h.complaints);
    const base = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0;
    const heatTrend = heatBySeason.length < 2 || (last < 5 && base < 5) ? "none"
      : last > base * 1.5 ? "worse" : last < base * 0.67 ? "better" : "steady";

    return Response.json({
      bbl,
      since: SINCE_YEAR,
      violations: {
        total,
        fixed,
        open: total - fixed,
        openOverYear,
        medianDaysToFix: median(fixDays) === null ? null : Math.round(median(fixDays)!),
        byYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, r]) => ({ year, ...r })),
        categories: [...cats.entries()].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.total - a.total),
      },
      heat: { bySeason: heatBySeason, trend: heatTrend },
      sources: ["NYC HPD Housing Maintenance Code Violations", "NYC 311 (HEAT/HOT WATER)"],
    });
  } catch (e) {
    console.error("history lookup failed", e);
    return Response.json({ error: "History unavailable right now" }, { status: 502 });
  }
}
