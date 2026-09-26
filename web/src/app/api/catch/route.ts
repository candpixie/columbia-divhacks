// GET /api/catch?address=707 East 242 St, Bronx   (or ?bbl=2051150024)
// Address -> BBL via NYC GeoSearch (no key), then one Tiger query for the building's public record.
import { buildReport, type BuildingRow } from "@/lib/catch";
import { tiger } from "@/lib/db";

type Geo = { bbl: string; label: string } | null;

async function geocode(address: string): Promise<Geo> {
  const url = `https://geosearch.planninglabs.nyc/v2/search?size=1&text=${encodeURIComponent(address)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const f = (await res.json()).features?.[0];
  const bbl = f?.properties?.addendum?.pad?.bbl;
  return bbl ? { bbl: String(bbl), label: f.properties.label } : null;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const address = (q.get("address") ?? "").trim().slice(0, 200);
  let bbl = q.get("bbl") ?? "";
  let label = "";
  if (!/^\d{10}$/.test(bbl)) {
    if (address.length < 4) return Response.json({ error: "Enter an NYC street address" }, { status: 400 });
    const g = await geocode(address).catch(() => null);
    if (!g) return Response.json({ error: "Couldn't find that address in NYC" }, { status: 404 });
    ({ bbl, label } = g);
  }
  const db = tiger();
  if (!db) return Response.json({ error: "Database not configured" }, { status: 503 });
  try {
    const { rows } = await db.query<BuildingRow>("SELECT * FROM buildings WHERE bbl = $1", [bbl]);
    if (!rows[0]) return Response.json({ error: "No residential building record for that address", bbl, label }, { status: 404 });
    return Response.json({ ...buildReport(rows[0]), label, source: "tiger" });
  } catch (e) {
    console.error("catch lookup failed", e);
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}
