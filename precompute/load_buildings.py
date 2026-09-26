"""What's the Catch: per-building signals, loaded into Tiger Data.

Joins Alina's buildings.csv.gz (nycdb: rent-stabilized units, open HPD violations, Good Cause,
landlord portfolio) with citywide counts per BBL from NYC Open Data:
  - 311 HEAT/HOT WATER complaints, last two heating seasons (since 2024-10-01)
  - Bedbug filings: latest infested-unit count reported by the landlord
  - Residential evictions executed since 2023-01-01
and precomputes per-unit percentiles, so the report card can compare a building to the city.

Table: buildings (bbl primary key). Usage: TIGER_DATABASE_URL=... .venv/bin/python precompute/load_buildings.py
"""

import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_layers import soql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HEAT_SINCE = "2024-10-01"
EVICT_SINCE = "2023-01-01"


def counts_by_bbl(dataset, where, name, value="count(*)"):
    rows = soql("data.cityofnewyork.us", dataset,
                {"$select": f"bbl, {value} as n", "$where": f"{where} AND bbl IS NOT NULL", "$group": "bbl"}, name)
    df = pd.DataFrame([(str(r["bbl"]).split(".")[0], float(r["n"])) for r in rows if r.get("bbl")], columns=["bbl", "n"])
    s = df.groupby("bbl").n.sum()  # the same BBL can appear as "123" and "123.0"
    return s[s.index.str.fullmatch(r"\d{10}")]


def pct_rank(values: pd.Series, mask: pd.Series) -> pd.Series:
    """Percentile (0-100) among buildings in `mask`; higher = worse."""
    out = pd.Series(np.nan, index=values.index)
    out[mask] = values[mask].rank(pct=True, method="max") * 100
    return out.round()


def main():
    b = pd.read_csv(ROOT / "data" / "processed" / "buildings.csv.gz", dtype={"bbl": str, "zip": str})
    b = b[b.res_units > 0].copy()
    print(f"{len(b)} residential buildings", file=sys.stderr)

    heat = counts_by_bbl("erm2-nwe9", f"complaint_type = 'HEAT/HOT WATER' AND created_date >= '{HEAT_SINCE}'", "catch_heat")
    evict = counts_by_bbl("6z8x-wfk4", f"residential_commercial_ind = 'Residential' AND executed_date >= '{EVICT_SINCE}'", "catch_evict")
    bed_rows = soql("data.cityofnewyork.us", "wz6d-d3jb", {
        "$select": "bbl, max(filing_date) as last_filing, max(infested_dwelling_unit_count) as infested",
        "$where": "bbl IS NOT NULL AND filing_date >= '2023-01-01'", "$group": "bbl"}, "catch_bedbug")
    bed = pd.DataFrame(bed_rows)
    bed["bbl"] = bed.bbl.astype(str).str.split(".").str[0]
    bed["infested"] = pd.to_numeric(bed["infested"], errors="coerce")
    bed = bed.groupby("bbl").agg(last_filing=("last_filing", "max"), infested=("infested", "max"))
    print(f"heat {len(heat)}, evictions {len(evict)}, bedbug filings {len(bed)} buildings", file=sys.stderr)

    b = b.drop_duplicates("bbl").set_index("bbl")
    b["heat_complaints"] = heat.reindex(b.index).fillna(0).astype(int)
    b["evictions"] = evict.reindex(b.index).fillna(0).astype(int)
    b["bedbug_infested_units"] = pd.to_numeric(bed["infested"].reindex(b.index), errors="coerce")
    b["bedbug_filed"] = bed["last_filing"].reindex(b.index).str[:10]

    # Compare like with like: buildings with 6+ units (where 311 heat and HPD rules mostly apply)
    big = b.res_units >= 6
    b["heat_per_unit"] = b.heat_complaints / b.res_units
    b["evict_per_unit"] = b.evictions / b.res_units
    b["heat_pct"] = pct_rank(b.heat_per_unit, big)
    b["violations_pct"] = pct_rank(b.violations_per_unit, big)
    b["evict_pct"] = pct_rank(b.evict_per_unit, big)

    cols = ["address", "zip", "lat", "lon", "res_units", "year_built", "stab_units", "open_hpd_violations",
            "violations_per_unit", "good_cause_likely", "good_cause_reason", "bldgclass", "portfolio_units",
            "heat_complaints", "evictions", "bedbug_infested_units", "bedbug_filed", "heat_pct", "violations_pct", "evict_pct"]
    out = b[cols].reset_index()
    ints = ["res_units", "year_built", "stab_units", "open_hpd_violations", "portfolio_units",
            "heat_complaints", "evictions", "bedbug_infested_units"]
    out[ints] = out[ints].round().astype("Int64")  # nullable ints: "1969.0" -> 1969, NaN -> NULL
    out = out.astype(object).where(out.notna(), None)

    with psycopg.connect(os.environ["TIGER_DATABASE_URL"], autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS buildings")
        conn.execute("""
          CREATE TABLE buildings (
            bbl text PRIMARY KEY, address text, zip text, lat double precision, lon double precision,
            res_units int, year_built int, stab_units int, open_hpd_violations int, violations_per_unit real,
            good_cause_likely boolean, good_cause_reason text, bldgclass text, portfolio_units int,
            heat_complaints int, evictions int, bedbug_infested_units int, bedbug_filed date,
            heat_pct real, violations_pct real, evict_pct real)""")
        with conn.cursor().copy("COPY buildings FROM STDIN") as cp:
            for r in out.itertuples(index=False):
                cp.write_row(list(r))
        n = conn.execute("SELECT count(*) FROM buildings").fetchone()[0]
        print(f"loaded {n} buildings into Tiger", file=sys.stderr)
        for label, sql in [
            ("worst heat (6+ units)", "SELECT address, zip, res_units, heat_complaints FROM buildings WHERE res_units>=6 ORDER BY heat_complaints DESC LIMIT 5"),
        ]:
            print(label, conn.execute(sql).fetchall(), file=sys.stderr)


if __name__ == "__main__":
    main()
