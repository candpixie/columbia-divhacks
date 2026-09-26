// Quarterly rent history for one neighborhood, served from Tiger Data (TimescaleDB continuous aggregate).
// Falls back to the exported rent_trend.json so the demo never breaks if the database is unreachable.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const BEDS = new Set(["studio", "1br", "2br", "3br"]);

let pool: Pool | null = null;
function db() {
  if (!process.env.TIGER_DATABASE_URL) return null;
  // libpq semantics for sslmode=require: encrypted, like psql/psycopg (node-pg otherwise demands full cert verification)
  const url = new URL(process.env.TIGER_DATABASE_URL);
  url.searchParams.set("uselibpqcompat", "true");
  pool ??= new Pool({ connectionString: url.toString(), max: 3, connectionTimeoutMillis: 4000 });
  return pool;
}

type Point = [string, number];

async function fromTiger(nta: string, beds: string): Promise<Point[] | null> {
  const p = db();
  if (!p) return null;
  const { rows } = await p.query<{ quarter: string; avg_rent: string }>(
    `SELECT to_char(quarter, 'YYYY-MM') AS quarter, avg_rent
       FROM rent_quarterly WHERE nta = $1 AND beds = $2 ORDER BY quarter`,
    [nta, beds],
  );
  return rows.map((r) => [r.quarter, Number(r.avg_rent)]);
}

async function fromFile(nta: string, beds: string): Promise<Point[]> {
  const file = path.join(process.cwd(), "public", "data", "rent_trend.json");
  const trend = JSON.parse(await readFile(file, "utf8"));
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
    return Response.json({ source: "static", series: await fromFile(nta, beds) });
  } catch {
    return Response.json({ source: "none", series: [] });
  }
}
