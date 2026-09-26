// Quarterly rent history for one neighborhood, served from Tiger Data (TimescaleDB continuous aggregate).
// Falls back to the exported rent_trend.json so the demo never breaks if the database is unreachable.
import { tiger } from "@/lib/db";

const BEDS = new Set(["studio", "1br", "2br", "3br"]);

type Point = [string, number];

async function fromTiger(nta: string, beds: string): Promise<Point[] | null> {
  const p = tiger();
  if (!p) return null;
  const { rows } = await p.query<{ quarter: string; avg_rent: string }>(
    `SELECT to_char(quarter, 'YYYY-MM') AS quarter, avg_rent
       FROM rent_quarterly WHERE nta = $1 AND beds = $2 ORDER BY quarter`,
    [nta, beds],
  );
  return rows.map((r) => [r.quarter, Number(r.avg_rent)]);
}

// Static export of the same aggregate, fetched over HTTP (serverless functions can't read /public on Vercel).
async function fromFile(origin: string, nta: string, beds: string): Promise<Point[]> {
  const res = await fetch(new URL("/data/rent_trend.json", origin));
  const trend = await res.json();
  return trend[nta]?.[beds] ?? [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nta = url.searchParams.get("nta") ?? "";
  const beds = url.searchParams.get("beds") ?? "1br";
  if (!/^[A-Z]{2}\d{4}$/.test(nta) || !BEDS.has(beds)) {
    return Response.json({ error: "bad nta or beds" }, { status: 400 });
  }
  try {
    const series = await fromTiger(nta, beds);
    if (series) return Response.json({ source: "tiger", series });
  } catch (e) {
    console.error("tiger query failed, using static file", e);
  }
  try {
    return Response.json({ source: "static", series: await fromFile(url.origin, nta, beds) });
  } catch {
    return Response.json({ source: "none", series: [] });
  }
}
