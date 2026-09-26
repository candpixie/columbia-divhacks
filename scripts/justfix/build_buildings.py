"""nycdb (Postgres) -> building-level tenant-protection data, rolled up to ZIP.

Needs a local nycdb with pluto_latest, rentstab_v2, hpd_violations and hpd_registrations loaded
(see scripts/justfix/README.md). Connection defaults to nycdb's own defaults; override with
NYCDB_URL, e.g. NYCDB_URL=postgresql://nycdb:nycdb@127.0.0.1:5432/nycdb

Outputs:
  data/processed/buildings.csv.gz     one row per residential PLUTO lot (gzipped CSV)
  data/processed/zip_protections.csv  one row per ZIP
"""

import os
import sys
from pathlib import Path

import pandas as pd
import psycopg

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
DB = os.environ.get("NYCDB_URL", "postgresql://nycdb:nycdb@127.0.0.1:5432/nycdb")

# Latest year in rentstab_v2 (DOF tax bills). Change here when nycdb publishes a newer year.
STAB_COL = "uc2023"

# Good Cause building exclusions, mirroring JustFixNYC/gce-screener useCriteriaResults.tsx
COOP_CLASSES = {"C6", "C8", "CC", "D0", "DC", "D4"}
EXCLUDED_PREFIXES = {"R": "condo", "W": "educational building", "H": "hotel",
                     "M": "religious facility", "I": "health facility"}
MANUFACTURED_HOUSING_BBL = "5013920002"
CO_CUTOFF_YEAR = 2009  # screener: CofO must predate 2009; we only have year built
SMALL_BUILDING_MAX = 10  # 10 or fewer units -> small-landlord / owner-occupied exemptions can apply
OWNER_CONTACT_TYPES = ("CorporateOwner", "IndividualOwner", "JointOwner", "HeadOfficer")

VIOLATIONS_SQL = """
    SELECT bbl, count(*) AS open_hpd_violations
    FROM hpd_violations
    WHERE violationstatus = 'Open' AND class IN ('B', 'C')
    GROUP BY bbl
"""
# Stopgap while nycdb's hpd_violations (~11M rows) is still loading: the same Open Data dataset
# (wvxf-dwi5) aggregated server-side to open B/C counts per boro/block/lot. Drop the table once
# hpd_violations is loaded.
PROVISIONAL_VIOLATIONS_SQL = "SELECT bbl, open_hpd_violations FROM tmp_open_bc_violations"

BUILDINGS_SQL = """
WITH viol AS ({violations})
SELECT p.bbl,
       p.address,
       p.zipcode AS zip,
       p.latitude AS lat,
       p.longitude AS lon,
       p.unitsres AS res_units,
       NULLIF(p.yearbuilt, 0) AS year_built,
       p.bldgclass,
       p.ownername,
       COALESCE(r.{stab_col}, 0) AS stab_units,
       COALESCE(v.open_hpd_violations, 0) AS open_hpd_violations
FROM pluto_latest p
LEFT JOIN rentstab_v2 r ON r.ucbbl = p.bbl
LEFT JOIN viol v ON v.bbl = p.bbl
WHERE p.unitsres > 0
"""

# Landlord portfolio, approximated the way Who Owns What starts: lots whose current HPD
# registration shares an owner-type contact's business address. Sum PLUTO units across them.
PORTFOLIO_SQL = f"""
WITH owner_addr AS (
    SELECT DISTINCT r.bbl,
           upper(concat_ws('|', c.businesshousenumber, c.businessstreetname,
                           c.businessapartment, c.businesszip)) AS addr
    FROM hpd_registrations r
    JOIN hpd_contacts c ON c.registrationid = r.registrationid
    WHERE c.type IN {OWNER_CONTACT_TYPES}
      AND r.registrationenddate >= current_date - interval '1 year'  -- skip long-lapsed owners
      AND c.businesshousenumber <> '' AND c.businessstreetname <> '' AND c.businesszip <> ''
),
addr_units AS (
    SELECT a.addr, sum(p.unitsres) AS units
    FROM (SELECT DISTINCT addr, bbl FROM owner_addr) a
    JOIN pluto_latest p ON p.bbl = a.bbl
    GROUP BY a.addr
)
SELECT o.bbl, max(u.units) AS portfolio_units
FROM owner_addr o JOIN addr_units u USING (addr)
GROUP BY o.bbl
"""


def good_cause(b):
    """(likely, reason) from building-level data only. Tenant-level criteria (rent under the
    cutoff, whether *this* unit is stabilized, owner occupancy, subsidies) are not checked."""
    cls = b.bldgclass or ""
    if b.bbl == MANUFACTURED_HOUSING_BBL:
        return False, "manufactured housing (excluded)"
    if isinstance(b.ownername, str) and "HOUSING AUTHORITY" in b.ownername.upper():
        return False, "NYCHA (other protections)"
    if cls in COOP_CLASSES:
        return False, "co-op (excluded)"
    for prefix, name in EXCLUDED_PREFIXES.items():
        if cls.startswith(prefix):
            return False, f"{name} (excluded)"
    if b.res_units > 0 and b.stab_units >= b.res_units:
        return False, "all units rent stabilized (stronger protections)"
    if pd.notna(b.year_built) and b.year_built >= CO_CUTOFF_YEAR:
        return False, f"built {int(b.year_built)} (new construction exempt)"

    partial = " some units stabilized; the rest may be covered." if b.stab_units > 0 else ""
    if b.res_units > SMALL_BUILDING_MAX:
        return True, f"{int(b.res_units)} units, pre-{CO_CUTOFF_YEAR}, not condo/co-op.{partial}".strip()
    if pd.notna(b.portfolio_units) and b.portfolio_units > SMALL_BUILDING_MAX:
        return True, (f"{int(b.res_units)} units, but landlord may own ~{int(b.portfolio_units)} units; "
                      f"covered unless the owner lives here.{partial}").strip()
    return False, f"{int(b.res_units)} units, no sign landlord owns >{SMALL_BUILDING_MAX} (small-landlord exemption may apply)"


def build():
    with psycopg.connect(DB) as conn:
        tables = {r[0] for r in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")}
        if "hpd_violations" in tables:
            violations, source = VIOLATIONS_SQL, "nycdb hpd_violations"
        elif "tmp_open_bc_violations" in tables:
            violations, source = PROVISIONAL_VIOLATIONS_SQL, "PROVISIONAL tmp_open_bc_violations (Open Data aggregate)"
        else:
            sys.exit("hpd_violations is not loaded (see scripts/justfix/README.md)")
        print(f"violations source: {source}")
        sql = BUILDINGS_SQL.format(violations=violations, stab_col=STAB_COL)
        b = pd.read_sql(sql, conn, dtype={"bbl": str, "zip": str})
        portfolio = pd.read_sql(PORTFOLIO_SQL, conn, dtype={"bbl": str}).set_index("bbl")
    b = b.join(portfolio, on="bbl")
    b["zip"] = b["zip"].str.strip().str.zfill(5).where(b["zip"].notna())
    b["violations_per_unit"] = (b["open_hpd_violations"] / b["res_units"]).round(3)
    flags = [good_cause(r) for r in b.itertuples()]
    b["good_cause_likely"] = [f[0] for f in flags]
    b["good_cause_reason"] = [f[1] for f in flags]

    cols = ["bbl", "address", "zip", "lat", "lon", "res_units", "year_built", "stab_units",
            "open_hpd_violations", "violations_per_unit", "good_cause_likely", "good_cause_reason",
            "bldgclass", "portfolio_units"]
    b = b[cols].sort_values("bbl")
    b["year_built"] = b["year_built"].astype("Int64")
    b["portfolio_units"] = b["portfolio_units"].astype("Int64")

    # ZIP roll-up. The violations median is over multifamily (3+ unit) buildings, which is what
    # HPD regulates; over all lots it would be 0 almost everywhere.
    has_zip = b[b["zip"].notna()]
    multi = has_zip[has_zip["res_units"] >= 3]
    z = has_zip.groupby("zip").agg(
        stab_units=("stab_units", "sum"),
        res_units=("res_units", "sum"),
        stab_buildings=("stab_units", lambda s: int((s > 0).sum())),
        buildings=("bbl", "size"),
        open_hpd_violations=("open_hpd_violations", "sum"),
        good_cause_likely_units=("res_units", lambda s: int(s[has_zip.loc[s.index, "good_cause_likely"]].sum())),
    )
    z["stab_share"] = (z["stab_units"] / z["res_units"]).round(4)
    z["median_violations_per_unit"] = multi.groupby("zip")["violations_per_unit"].median().round(3)
    z["good_cause_likely_share"] = (z["good_cause_likely_units"] / z["res_units"]).round(4)
    z = z[["stab_units", "res_units", "stab_share", "stab_buildings", "median_violations_per_unit",
           "buildings", "open_hpd_violations", "good_cause_likely_units", "good_cause_likely_share"]]

    PROCESSED.mkdir(parents=True, exist_ok=True)
    b.to_csv(PROCESSED / "buildings.csv.gz", index=False)  # ~13 MB; plain CSV is over GitHub's 100 MB limit
    z.to_csv(PROCESSED / "zip_protections.csv")
    return b, z


def checks(b, z):
    failures = []

    def check(ok, msg):
        print(f"  [{'ok' if ok else 'FAIL'}] {msg}")
        if not ok:
            failures.append(msg)

    print(f"\nSanity checks ({len(b):,} residential lots, {len(z)} ZIPs)")
    rent = pd.read_csv(PROCESSED / "zip_rent.csv", dtype={"zip": str})
    rent_zips = set(rent["zip"])
    overlap = rent_zips & set(z.index)
    # Single-building ZIPs (e.g. 10162) are ZORI ZIPs that PLUTO files under the surrounding ZIP.
    check(len(overlap) >= 0.95 * len(rent_zips),
          f"{len(overlap)} of {len(rent_zips)} zip_rent.csv ZIPs have buildings"
          + (f" (no PLUTO residential lots: {sorted(rent_zips - overlap)})" if overlap != rent_zips else ""))
    check(z["stab_share"].between(0, 1).all(),
          f"stab_share within 0..1 (max {z['stab_share'].max():.3f})")
    over = b[b["stab_units"] > b["res_units"]]
    print(f"  [info] {len(over):,} lots report more stabilized units than PLUTO residential units "
          f"(counted as fully stabilized)")
    print(f"  [info] {b['zip'].isna().sum():,} lots have no ZIP in PLUTO (kept in buildings.csv, not rolled up)")
    print(f"  [info] {b['bbl'].isin(b.loc[b['stab_units'] > 0, 'bbl']).sum():,} lots with stabilized units, "
          f"{b['stab_units'].sum():,} stabilized units total")
    print(f"  [info] {b['good_cause_likely'].sum():,} lots / {b.loc[b['good_cause_likely'], 'res_units'].sum():,} "
          f"units flagged good_cause_likely")

    print("\nTop 10 ZIPs by stabilized units:")
    print(z.sort_values("stab_units", ascending=False).head(10)[
        ["stab_units", "res_units", "stab_share", "stab_buildings", "median_violations_per_unit"]].to_string())
    print("\nGood Cause reasons (lots):")
    reason = b["good_cause_reason"].str.replace(r"^\d+ units", "N units", regex=True) \
        .str.replace(r"~\d+", "~N", regex=True).str.replace(r"built \d+", "built 2009+", regex=True)
    print(reason.value_counts().to_string())

    if failures:
        sys.exit(f"\n{len(failures)} sanity check(s) failed: {failures}")
    print("\nAll sanity checks passed.")


if __name__ == "__main__":
    checks(*build())
