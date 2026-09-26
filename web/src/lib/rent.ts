// Typical rent by ZIP from Zillow ZORI, with expected rent by move-in month.
// Built by scripts/rent/build_zip_rent.py into public/data/zip_rent.json.

export const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
export type Month = (typeof MONTHS)[number];

export type ZipRentRow = {
  county: string;
  rent_12mo: number;
  rent_yoy: number | null;
  cheapest_month: Month;
  priciest_month: Month;
  season_swing: number;
  first_month_with_data: string; // "YYYY-MM"
  months_in_12mo: number;
} & Record<Month, number>;

export type ZipRent = { source: string; through: string; zips: Record<string, ZipRentRow> };

export type RentQuote = {
  rent: number; // avg_rent for the move-in month, or rent_12mo when no month is given
  rent12mo: number;
  cheapestMonth: Month;
  cheapestRent: number;
};

export async function loadZipRent(base = "/data"): Promise<ZipRent | null> {
  try {
    const r = await fetch(`${base}/zip_rent.json`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// moveMonth is 1-12. Returns null for ZIPs Zillow doesn't cover.
export function getRent(data: ZipRent, zip: string, moveMonth?: number): RentQuote | null {
  const row = data.zips[zip.padStart(5, "0")];
  if (!row) return null;
  const month = moveMonth && moveMonth >= 1 && moveMonth <= 12 ? MONTHS[moveMonth - 1] : null;
  return {
    rent: month ? row[month] : row.rent_12mo,
    rent12mo: row.rent_12mo,
    cheapestMonth: row.cheapest_month,
    cheapestRent: row[row.cheapest_month],
  };
}
