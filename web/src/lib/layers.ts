// Public-data layers: every dataset is one number per neighborhood (and optionally per hex).

export type Layer = {
  id: string;
  label: string;
  group: string;
  unit: string;
  better: "low" | "high" | "none";
  source: string;
  year: string;
  optional: boolean;
  note?: string;
  nta: Record<string, number>;
  hex?: number[];
};

export async function loadLayers(base = "/data"): Promise<Layer[]> {
  try {
    const r = await fetch(`${base}/layers.json`);
    return r.ok ? (await r.json()).layers : [];
  } catch {
    return [];
  }
}

// Share of NYC neighborhoods this one beats (0-100), or null when "better" has no direction.
export function percentile(layer: Layer, value: number): number | null {
  if (layer.better === "none") return null;
  const vals = Object.values(layer.nta);
  const worse = vals.filter((v) => (layer.better === "low" ? v > value : v < value)).length;
  return Math.round((100 * worse) / Math.max(1, vals.length - 1));
}

// 0 = worst in the city, 1 = best, by rank (so a few outliers don't wash out the map).
export function goodness(layer: Layer, value: number): number {
  const vals = Object.values(layer.nta);
  const below = vals.filter((v) => v < value).length / Math.max(1, vals.length - 1);
  return layer.better === "low" ? 1 - below : below;
}

export function formatValue(layer: Layer, v: number): string {
  if (layer.unit === "min walk") return v >= 60 ? "60+ min walk" : `${v} min walk`;
  const n = v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  return `${n} ${layer.unit}`;
}
