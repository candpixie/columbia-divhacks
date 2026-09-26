// "What's the Catch": turns one building's public records into plain-language flags.
// Rules only, no AI: every flag cites its dataset and time window.
import { getJustFixLinks, type JustFixLink } from "./justfix";

export type BuildingRow = {
  bbl: string;
  address: string;
  zip: string;
  lat: number;
  lon: number;
  res_units: number;
  year_built: number | null;
  stab_units: number;
  open_hpd_violations: number;
  violations_per_unit: number;
  good_cause_likely: boolean;
  good_cause_reason: string | null;
  portfolio_units: number | null;
  heat_complaints: number;
  evictions: number;
  bedbug_infested_units: number | null;
  bedbug_filed: string | null;
  heat_pct: number | null;
  violations_pct: number | null;
  evict_pct: number | null;
};

export type Flag = {
  level: "red" | "amber" | "green";
  title: string;
  detail: string;
  source: string;
};

export type CatchReport = {
  bbl: string;
  address: string;
  units: number;
  yearBuilt: number | null;
  verdict: string;
  flags: Flag[];
  links: JustFixLink[];
  lat: number;
  lon: number;
};

const n = (x: number) => x.toLocaleString();
const plural = (x: number, w: string) => `${n(x)} ${w}${x === 1 ? "" : "s"}`;
const worseThan = (pct: number | null) => (pct === null ? "" : ` Worse than ${Math.min(99, Math.round(pct))}% of NYC buildings with 6+ units.`);

export function buildReport(b: BuildingRow): CatchReport {
  const flags: Flag[] = [];
  const big = b.res_units >= 6;

  // Heat: 311 HEAT/HOT WATER, since Oct 2024 (two heating seasons)
  if (b.heat_complaints > 0) {
    const perUnit = b.heat_complaints / Math.max(1, b.res_units);
    const level = big && (b.heat_pct ?? 0) >= 90 ? "red" : big && (b.heat_pct ?? 0) >= 70 ? "amber" : perUnit >= 1 ? "amber" : "green";
    flags.push({
      level,
      title: `${plural(b.heat_complaints, "no-heat / hot-water complaint")} since Oct 2024`,
      detail: `${perUnit.toFixed(1)} per apartment.${big ? worseThan(b.heat_pct) : ""} One outage can bring many calls from different tenants.`,
      source: "NYC 311 (HEAT/HOT WATER)",
    });
  } else {
    flags.push({ level: "green", title: "No heat or hot-water complaints since Oct 2024", detail: "Two heating seasons with no 311 heat complaints.", source: "NYC 311" });
  }

  // HPD violations (open, class B/C)
  if (b.open_hpd_violations > 0) {
    const level = big && (b.violations_pct ?? 0) >= 90 ? "red" : "amber";
    flags.push({
      level,
      title: `${plural(b.open_hpd_violations, "open housing code violation")}`,
      detail: `Class B/C (hazardous / immediately hazardous), ${b.violations_per_unit.toFixed(2)} per apartment.${big ? worseThan(b.violations_pct) : ""}`,
      source: "NYC HPD violations",
    });
  }

  // Bedbugs: landlord-filed annual report
  if (b.bedbug_infested_units !== null && b.bedbug_infested_units > 0) {
    flags.push({
      level: "red",
      title: `Bedbugs reported in ${plural(Math.min(b.bedbug_infested_units, b.res_units), "apartment")}`,
      detail: `From the landlord's own bedbug filing${b.bedbug_filed ? ` (${b.bedbug_filed})` : ""}.`,
      source: "NYC HPD Bedbug Reporting",
    });
  }

  // Evictions executed by city marshals
  if (b.evictions > 0) {
    flags.push({
      level: big && (b.evict_pct ?? 0) >= 90 ? "red" : "amber",
      title: `${plural(b.evictions, "eviction")} carried out since 2023`,
      detail: `Executed by city marshals.${big ? worseThan(b.evict_pct) : ""}`,
      source: "NYC DOI Evictions",
    });
  }

  // Protections (good news for a renter)
  if (b.stab_units > 0) {
    // DHCR and PLUTO count units differently; never claim more stabilized units than the building has.
    const stab = Math.min(b.stab_units, b.res_units);
    flags.push({
      level: "green",
      title: stab >= 0.9 * b.res_units
        ? "All or nearly all apartments are rent-stabilized"
        : `${plural(stab, "rent-stabilized apartment")} registered here`,
      detail: "Rent increases on stabilized units are capped by the Rent Guidelines Board. Ask whether your unit is one, and request its rent history.",
      source: "NYC DHCR rent stabilization (via nycdb)",
    });
  }
  if (b.good_cause_likely) {
    flags.push({
      level: "green",
      title: "Likely covered by Good Cause Eviction",
      detail: b.good_cause_reason ?? "Building likely meets the criteria.",
      source: "NY Good Cause Eviction law, building criteria (via nycdb)",
    });
  }
  if (b.portfolio_units && b.portfolio_units >= 1000) {
    flags.push({
      level: "amber",
      title: `Landlord controls ~${n(b.portfolio_units)} apartments`,
      detail: "A large portfolio. See their other buildings and track record on Who Owns What.",
      source: "HPD registrations (via JustFix / nycdb)",
    });
  }

  const reds = flags.filter((f) => f.level === "red").length;
  const ambers = flags.filter((f) => f.level === "amber").length;
  const verdict = reds ? `${plural(reds, "red flag")}${ambers ? `, ${ambers} to check` : ""}`
    : ambers ? `${plural(ambers, "thing")} to check` : "No red flags in the public record";

  const order = { red: 0, amber: 1, green: 2 } as const;
  return {
    bbl: b.bbl,
    address: b.address,
    units: b.res_units,
    yearBuilt: b.year_built,
    verdict,
    flags: flags.sort((x, y) => order[x.level] - order[y.level]),
    links: getJustFixLinks({ bbl: b.bbl, stab_units: Math.min(b.stab_units, b.res_units), open_hpd_violations: b.open_hpd_violations, good_cause_likely: b.good_cause_likely }),
    lat: b.lat,
    lon: b.lon,
  };
}
