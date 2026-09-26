"""ZIP-level data -> NTA neighborhoods: Zillow rent (ZORI) and IRS income, plus rent burden.

ZIPs are joined through NYC's MODZCTA areas (each MODZCTA groups one or more ZIPs).
MODZCTA values are split across NTAs by estimated residents, like the precinct crosswalk.

Inputs (downloaded manually into data/extra related crime : safety data/):
  Zip_zori_uc_sfrcondomfr_sm_month.csv   Zillow Observed Rent Index by ZIP, monthly
  22zpallagi.csv                         IRS SOI individual income tax stats by ZIP, 2022
Outputs:
  data/zip/zip_nta_crosswalk.csv, data/zip/nyc_irs_2022.csv (NYC slice), data/zip/nyc_zori.csv
  web/public/data/zip_by_nta.json
  web/public/data/layers.json  (adds/replaces the ZIP-based layers)
"""

import csv
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_layers import OUT, Geo, population, soql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "extra related crime : safety data"
ZIPDIR = ROOT / "data" / "zip"

# IRS agi_stub brackets (AGI, $): 1: 1-25k, 2: 25-50k, 3: 50-75k, 4: 75-100k, 5: 100-200k, 6: 200k+
BRACKETS = [(1, 25_000), (25_000, 50_000), (50_000, 75_000), (75_000, 100_000), (100_000, 200_000), (200_000, 400_000)]


def median_from_brackets(counts):
    """Estimate median AGI by linear interpolation inside the bracket holding the 50th percentile."""
    total = sum(counts)
    if total <= 0:
        return None
    half, cum = total / 2, 0
    for (lo, hi), n in zip(BRACKETS, counts):
        if cum + n >= half:
            return lo + (hi - lo) * (half - cum) / n
        cum += n
    return BRACKETS[-1][1]


def main():
    ZIPDIR.mkdir(parents=True, exist_ok=True)
    geo = Geo()
    pop = population(geo)

    rows = soql("data.cityofnewyork.us", "pri4-ifjk", {"$select": "modzcta,zcta,pop_est,the_geom"}, "modzcta_full")
    modz = {r["modzcta"]: shape(r["the_geom"]) for r in rows if r.get("the_geom")}
    zip_to_modz = {}
    for r in rows:
        for z in str(r.get("zcta", "")).replace(" ", "").split(","):
            if z:
                zip_to_modz[z] = r["modzcta"]
        zip_to_modz.setdefault(r["modzcta"], r["modzcta"])

    # MODZCTA x NTA pieces, weighted by NTA residents in the overlap
    pieces = []
    for mz, poly in modz.items():
        for i in geo.tree.query(poly, predicate="intersects"):
            nta_poly, code = geo.polys[i], geo.codes[i]
            inter = poly.intersection(nta_poly).area
            if inter > 0:
                pieces.append((mz, code, pop.get(code, 0) * inter / nta_poly.area))
    nta_total = {}
    for _, code, r in pieces:
        nta_total[code] = nta_total.get(code, 0) + r
    with open(ZIPDIR / "zip_nta_crosswalk.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["modzcta", "nta", "share_of_nta_residents"])
        for mz, code, r in sorted(pieces):
            if nta_total.get(code):
                w.writerow([mz, code, round(r / nta_total[code], 4)])

    def to_nta(values):
        """Resident-weighted average of MODZCTA values for each NTA."""
        out = {}
        for code in geo.codes:
            num = den = 0.0
            for mz, c, r in pieces:
                if c == code and mz in values and values[mz] is not None and r > 0:
                    num += values[mz] * r
                    den += r
            if den > 0:
                out[code] = num / den
        return out

    # --- IRS income (2022 tax year) ---
    irs = pd.read_csv(SRC / "22zpallagi.csv", usecols=["STATE", "zipcode", "agi_stub", "N1", "A00100"],
                      dtype={"zipcode": str})
    irs = irs[(irs.STATE == "NY") & irs.zipcode.isin(zip_to_modz)]
    irs.to_csv(ZIPDIR / "nyc_irs_2022.csv", index=False)
    irs["modzcta"] = irs.zipcode.map(zip_to_modz)
    g = irs.groupby(["modzcta", "agi_stub"]).N1.sum().unstack(fill_value=0)
    median_income = {mz: median_from_brackets([g.loc[mz].get(s, 0) for s in range(1, 7)]) for mz in g.index}
    returns = irs.groupby("modzcta").N1.sum()
    low_income_share = {mz: 100 * (g.loc[mz].get(1, 0) + g.loc[mz].get(2, 0)) / returns[mz] for mz in g.index}

    # --- Zillow rent index ---
    z = pd.read_csv(SRC / "Zip_zori_uc_sfrcondomfr_sm_month.csv", dtype={"RegionName": str})
    z = z[(z.State == "NY") & z.RegionName.isin(zip_to_modz)]
    months = [c for c in z.columns if c[:2] == "20"]
    z[["RegionName"] + months[-25:]].to_csv(ZIPDIR / "nyc_zori.csv", index=False)
    latest, year_ago = months[-1], months[-13]
    z["modzcta"] = z.RegionName.map(zip_to_modz)
    zg = z.groupby("modzcta")[[latest, year_ago]].mean()
    zori = {mz: float(v) for mz, v in zg[latest].dropna().items()}
    zori_yoy = {mz: float(100 * (zg.loc[mz, latest] / zg.loc[mz, year_ago] - 1))
                for mz in zg.index if pd.notna(zg.loc[mz, latest]) and pd.notna(zg.loc[mz, year_ago])}

    inc_n = to_nta(median_income)
    low_n = to_nta(low_income_share)
    zori_n = to_nta(zori)
    yoy_n = to_nta(zori_yoy)
    ntas = json.loads((OUT / "ntas.json").read_text())
    burden = {c: 100 * 12 * ntas[c]["rent"]["1br"] / inc_n[c]
              for c in inc_n if c in ntas and ntas[c]["rent"].get("1br")}

    by_nta = {c: {
        "median_income_est": round(inc_n[c], -2) if c in inc_n else None,
        "low_income_share_pct": round(low_n[c], 1) if c in low_n else None,
        "rent_burden_1br_pct": round(burden[c]) if c in burden else None,
        "zillow_rent": round(zori_n[c], -1) if c in zori_n else None,
        "zillow_rent_yoy_pct": round(yoy_n[c], 1) if c in yoy_n else None,
    } for c in geo.codes}
    (OUT / "zip_by_nta.json").write_text(json.dumps({
        "zillow_month": latest, "irs_tax_year": 2022,
        "note": "Median income estimated from IRS AGI brackets per tax return (not per household). "
                "Rent burden = 12 x StreetEasy 1BR median / that income.",
        "ntas": by_nta,
    }, separators=(",", ":")))

    def layer(id, label, group, unit, better, source, year, vals, note=None, digits=1):
        l = {"id": id, "label": label, "group": group, "unit": unit, "better": better, "source": source,
             "year": year, "optional": False, "nta": {k: round(v, digits) for k, v in vals.items()}}
        if note:
            l["note"] = note
        return l

    new = [
        layer("rent_burden", "1BR rent as % of local income", "Housing equity", "% of median income", "low",
              "StreetEasy + IRS SOI", "2026 rent / 2022 income", burden, digits=0,
              note="What a typical 1BR here costs relative to what people living here earn."),
        layer("median_income", "Median income (est.)", "Housing equity", "$ per tax return", "none",
              "IRS SOI by ZIP", "2022", inc_n, digits=-2),
        layer("low_income_share", "Tax returns under $50k", "Housing equity", "% of returns", "none",
              "IRS SOI by ZIP", "2022", low_n),
        layer("zillow_rent", "Zillow typical rent", "Housing equity", "$ / month", "low",
              "Zillow Observed Rent Index", latest[:7], zori_n, digits=-1),
        layer("zillow_rent_yoy", "Rent change, last 12 months", "Housing equity", "% change", "low",
              "Zillow Observed Rent Index", latest[:7], yoy_n),
    ]
    doc = json.loads((OUT / "layers.json").read_text())
    ids = {l["id"] for l in new}
    doc["layers"] = [l for l in doc["layers"] if l["id"] not in ids] + new
    (OUT / "layers.json").write_text(json.dumps(doc, separators=(",", ":")))

    print(f"{len(modz)} MODZCTAs, {len(pieces)} MODZCTA-NTA pieces")
    print(f"IRS: {irs.zipcode.nunique()} NYC ZIPs; Zillow: {z.RegionName.nunique()} NYC ZIPs, latest {latest}")
    print(f"NTAs with income {len(inc_n)}, burden {len(burden)}, zillow {len(zori_n)}")


if __name__ == "__main__":
    main()
