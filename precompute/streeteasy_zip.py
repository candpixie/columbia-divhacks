"""Put StreetEasy rental inventory onto NYC ZIPs and check StreetEasy against Zillow ZORI.

Inputs:
  data/rentprices/rentalIndex_All.csv       StreetEasy Rent Index ($), monthly, by borough (+ NYC)
  data/rentprices/rentalInventory_All.csv   StreetEasy active rental listings, monthly, by neighborhood
  data/rentprices/County_zori_uc_sfrcondomfr_sm_month.csv   Zillow ZORI by county
  data/zips/rent_by_zip.csv, raw/zillow/zip_zori.csv        Zillow ZORI by ZIP (analyze_zip_rent.py)
  raw/geo/nta2020.geojson   https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=1000
  raw/geo/modzcta.geojson   https://data.cityofnewyork.us/resource/pri4-ifjk.geojson?$limit=1000

StreetEasy neighborhoods have no public boundaries, so each one is matched by name to
2020 NTAs, and its listings are split over the ZIP (MODZCTA) pieces of those NTAs in
proportion to residents (ZIP population x share of ZIP area in the piece).
NTAs with no StreetEasy neighborhood (e.g. Ocean Hill, Cypress Hills) get no listings,
and Staten Island (52 listings, no neighborhoods) is left out.

Outputs (data/zips/):
  streeteasy_nta_crosswalk.csv       se_neighborhood, nta2020, ntaname
  streeteasy_zip_crosswalk.csv       se_neighborhood, zip, share of that neighborhood's listings
  streeteasy_inventory_by_zip.csv    zip, borough, monthly listing counts (2010-01 ..)
  index_vs_zori_by_borough.csv       month, borough, StreetEasy index, county ZORI, ZIP-median ZORI
  inventory_vs_zori_by_zip.csv       zip-level listings, inventory change, ZORI level and change
  streeteasy_vs_zori.txt             the printed comparison
"""

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
SE = ROOT / "data" / "rentprices"
ZIPS = ROOT / "data" / "zips"
RAW = ROOT / "raw"
COUNTY = {"Manhattan": "New York County", "Brooklyn": "Kings County", "Queens": "Queens County",
          "Bronx": "Bronx County", "Staten Island": "Richmond County"}

# Real ZIPs (created 2007) that the ciclt.net list scraped by scrape_zips.py lacks
MISSING_ZIPS = {"10065": "Manhattan", "10075": "Manhattan"}

# StreetEasy names that don't appear in an NTA name, or whose name match is wrong
OVERRIDES = {
    "Midtown": ["Midtown-Times Square"],
    "Midtown East": ["East Midtown-Turtle Bay", "Murray Hill-Kips Bay"],
    "Midtown West": ["Hell's Kitchen"],
    "Central Park South": ["Midtown-Times Square"],
    "Gramercy Park": ["Gramercy"],
    "Stuyvesant Town/PCV": ["Stuyvesant Town-Peter Cooper Village"],
    "Central Harlem": ["Harlem (North)", "Harlem (South)"],
    "Nolita": ["SoHo-Little Italy-Hudson Square"],
    "Greenwood": ["Sunset Park (West)"],
    "Columbia St Waterfront District": ["Carroll Gardens-Cobble Hill-Gowanus-Red Hook"],
    "Prospect Park South": ["Flatbush"],
    "Old Mill Basin": ["Marine Park-Mill Basin-Bergen Beach"],
    "Seagate": ["Coney Island-Sea Gate"],
    "Hollis": ["Hollis"],
    "Rockaway All": ["Rockaway Beach-Arverne-Edgemere", "Far Rockaway-Bayswater",
                     "Breezy Point-Belle Harbor-Rockaway Park-Broad Channel"],
    "East Tremont": ["West Farms"],
    "Laconia": ["Williamsbridge-Olinville"],
    "Bronxwood": ["Williamsbridge-Olinville"],
    "Woodstock": ["Morrisania"],
    "Westchester Village": ["Westchester Square"],
}


def spearman(a, b):
    return a.rank().corr(b.rank())


def months_of(df):
    return [c for c in df.columns if re.match(r"\d{4}-\d{2}", c)]


def norm(s):
    return re.sub(r"[^a-z0-9 ]", " ", s.lower()).split()


def contains(words, sub):
    n = len(sub)
    return any(words[i:i + n] == sub for i in range(len(words) - n + 1))


def match_ntas(se_names, ntas):
    """SE neighborhood -> NTA names. Per NTA, a longer SE name beats one it contains
    (so 'East Flatbush-Rugby' goes to East Flatbush, not Flatbush)."""
    out = {n: [] for n in se_names}
    auto = [n for n in se_names if n not in OVERRIDES]
    for nta in ntas:
        words = norm(nta)
        hits = [n for n in auto if contains(words, norm(n))]
        hits = [h for h in hits if not any(h != o and contains(norm(o), norm(h)) for o in hits)]
        for h in hits:
            out[h].append(nta)
    for n, lst in OVERRIDES.items():
        if n in out:
            out[n] = lst
    return out


def crosswalk(se_names):
    gj = json.loads((RAW / "geo" / "nta2020.geojson").read_text())
    nta_feats = {f["properties"]["ntaname"]: f for f in gj["features"] if f["properties"]["ntatype"] == "0"}
    zj = json.loads((RAW / "geo" / "modzcta.geojson").read_text())
    zips = [(f["properties"]["modzcta"], float(f["properties"]["pop_est"]), shape(f["geometry"]))
            for f in zj["features"]
            if f["geometry"] and f["properties"].get("pop_est") and f["properties"]["modzcta"] != "99999"]

    se_to_nta = match_ntas(se_names, nta_feats)
    missing = [n for n, v in se_to_nta.items() if not v]
    if missing:
        raise SystemExit(f"no NTA for: {missing}")
    bad = {n: [x for x in v if x not in nta_feats] for n, v in se_to_nta.items()}
    if any(bad.values()):
        raise SystemExit(f"unknown NTA names: { {k: v for k, v in bad.items() if v} }")

    # residents in each NTA x ZIP piece
    pieces = {}
    for name, f in nta_feats.items():
        poly = shape(f["geometry"])
        for z, pop, zpoly in zips:
            if poly.intersects(zpoly):
                share = poly.intersection(zpoly).area / zpoly.area
                if share > 1e-4:
                    pieces[(name, z)] = pop * share

    nta_rows, zip_rows = [], []
    for se, ntas in se_to_nta.items():
        nta_rows += [{"se_neighborhood": se, "ntaname": n, "nta2020": nta_feats[n]["properties"]["nta2020"]} for n in ntas]
        mine = {}
        for (n, z), pop in pieces.items():
            if n in ntas:
                mine[z] = mine.get(z, 0) + pop
        total = sum(mine.values())
        zip_rows += [{"se_neighborhood": se, "zip": z, "share": p / total} for z, p in mine.items()]
    return pd.DataFrame(nta_rows), pd.DataFrame(zip_rows)


def inventory_by_zip(inv, xw, boroughs):
    m = months_of(inv)
    nb = inv[inv.areaType == "neighborhood"].set_index("areaName")[m]
    w = xw.pivot_table(index="zip", columns="se_neighborhood", values="share", fill_value=0)
    w = w.reindex(columns=nb.index, fill_value=0)
    by_zip = w.fillna(0).dot(nb.fillna(0))
    by_zip.insert(0, "borough", boroughs.reindex(by_zip.index))
    by_zip.index.name = "zip"
    return by_zip


def zori_zip():
    z = pd.read_csv(RAW / "zillow" / "zip_zori.csv", dtype={"RegionName": str}).set_index("RegionName")
    m = months_of(z)
    z = z[m]
    z.columns = [c[:7] for c in m]
    return z


def main():
    idx = pd.read_csv(SE / "rentalIndex_All.csv").set_index("month")
    inv = pd.read_csv(SE / "rentalInventory_All.csv")
    county = pd.read_csv(SE / "County_zori_uc_sfrcondomfr_sm_month.csv")
    rent = pd.read_csv(ZIPS / "rent_by_zip.csv", dtype={"zip": str}).set_index("zip")
    zz = zori_zip()
    lines = []

    def say(*a):
        s = " ".join(str(x) for x in a)
        print(s)
        lines.append(s)

    # ---- crosswalk + inventory by ZIP
    se_names = inv.loc[inv.areaType == "neighborhood", "areaName"].tolist()
    nta_xw, zip_xw = crosswalk(se_names)
    nta_xw.to_csv(ZIPS / "streeteasy_nta_crosswalk.csv", index=False)
    zip_xw.round(4).to_csv(ZIPS / "streeteasy_zip_crosswalk.csv", index=False)
    by_zip = inventory_by_zip(inv, zip_xw, rent["borough"].combine_first(pd.Series(MISSING_ZIPS)))
    by_zip.round(1).to_csv(ZIPS / "streeteasy_inventory_by_zip.csv")
    m = months_of(inv)
    latest = m[-1]
    say(f"Inventory: {len(se_names)} StreetEasy neighborhoods -> {len(by_zip)} ZIPs. "
        f"{latest} listings {by_zip[latest].sum():.0f} of {inv.loc[inv.areaType == 'neighborhood', latest].sum():.0f} kept")
    unknown = sorted(set(by_zip.index) - set(rent.index))
    if unknown:
        say(f"  ZIPs in MODZCTA but not in nyc_zips.json: {unknown} ({by_zip.loc[unknown, latest].sum():.0f} listings)")

    # ---- 1. borough rent level: StreetEasy index vs Zillow ZORI
    cz = county[(county.State == "NY") & county.RegionName.isin(COUNTY.values())].set_index("RegionName")
    cm = months_of(cz)
    cz = cz[cm]
    cz.columns = [c[:7] for c in cm]
    zip_med = zz.loc[zz.index.intersection(rent.index)].join(rent["borough"]).groupby("borough").median()

    rows = []
    for b in ["Manhattan", "Brooklyn", "Queens"]:
        for mo in idx.index:
            rows.append({"month": mo, "borough": b, "se_index": idx.at[mo, b],
                         "zori_county": cz.at[COUNTY[b], mo] if mo in cz.columns else np.nan,
                         "zori_zip_median": zip_med.at[b, mo] if mo in zip_med.columns else np.nan})
    bc = pd.DataFrame(rows)
    bc.round(0).to_csv(ZIPS / "index_vs_zori_by_borough.csv", index=False)

    say("\n1) Borough rent level: StreetEasy Rent Index vs Zillow county ZORI (monthly, overlapping months)")
    say(f"{'borough':<10} {'months':>6} {'SE ' + latest:>10} {'ZORI':>7} {'gap':>6} {'corr lvl':>8} {'corr YoY':>8} {'SE YoY':>7} {'ZORI YoY':>8} {'SE 5y':>6} {'ZORI 5y':>7}")
    for b, g in bc.groupby("borough", sort=False):
        g = g.set_index("month")[["se_index", "zori_county"]].dropna()
        yoy = g[["se_index", "zori_county"]].pct_change(12, fill_method=None) * 100
        five = (g.iloc[-1] / g.iloc[-61] - 1) * 100
        last = g.iloc[-1]
        say(f"{b:<10} {len(g):>6} {last.se_index:>10.0f} {last.zori_county:>7.0f} {(last.se_index / last.zori_county - 1) * 100:>5.1f}% "
            f"{g.se_index.corr(g.zori_county):>8.3f} {yoy.se_index.corr(yoy.zori_county):>8.3f} "
            f"{yoy.se_index.iloc[-1]:>6.1f}% {yoy.zori_county.iloc[-1]:>7.1f}% {five.se_index:>5.1f}% {five.zori_county:>6.1f}%")

    # turning points: where each series peaked/bottomed around COVID
    say("\n   COVID trough and date each index regained its Feb 2020 level:")
    for b, g in bc.groupby("borough", sort=False):
        g = g.set_index("month")
        for col in ["se_index", "zori_county"]:
            s = g[col].dropna().loc["2019-06":"2023-12"]
            pre = s.loc["2020-02"]
            low = s.loc["2020-03":"2021-12"]
            back = s.loc[low.idxmin():][s.loc[low.idxmin():] >= pre]
            say(f"   {b:<10} {col:<12} trough {low.idxmin()} ({(low.min() / pre - 1) * 100:+.1f}%), recovered {back.index[0] if len(back) else '-'}")

    # ---- 2. ZIP level: inventory vs ZORI
    prev = m[-13]
    z = pd.DataFrame({
        "borough": by_zip["borough"],
        "listings": by_zip[latest],
        "listings_1y_ago": by_zip[prev],
        "listings_12mo_avg": by_zip[m[-12:]].mean(axis=1),
    })
    z["inventory_yoy_pct"] = (z.listings / z.listings_1y_ago.replace(0, np.nan) - 1) * 100
    z = z.join(rent[["zori", "yoy_pct", "safmr_1br"]].rename(columns={"yoy_pct": "zori_yoy_pct"}))
    z["has_zori"] = z.zori.notna()
    z.round(1).to_csv(ZIPS / "inventory_vs_zori_by_zip.csv")

    say(f"\n2) ZIP level ({len(z)} ZIPs with StreetEasy listings)")
    cov = z.groupby("has_zori").listings_12mo_avg.describe()[["count", "25%", "50%", "75%"]].round(0)
    say("   Avg monthly StreetEasy listings, ZIPs with vs without Zillow ZORI:")
    say("   " + cov.to_string().replace("\n", "\n   "))
    thr = z.listings_12mo_avg
    for lo, hi in [(0, 10), (10, 50), (50, 200), (200, 1e9)]:
        s = z[(thr >= lo) & (thr < hi)]
        say(f"   {lo:>4}-{'' if hi > 1e8 else int(hi):<4} listings/mo: {len(s):>3} ZIPs, {s.has_zori.mean() * 100:5.1f}% have ZORI")
    both = z.dropna(subset=["zori"])
    say(f"   Spearman(listings, ZORI level) = {spearman(both.listings_12mo_avg, both.zori):.2f}")
    t = z.dropna(subset=["inventory_yoy_pct", "zori_yoy_pct"])
    t = t[t.listings_1y_ago >= 20]
    say(f"   Spearman(inventory YoY, ZORI YoY), ZIPs with >=20 listings a year ago (n={len(t)}): "
        f"{spearman(t.inventory_yoy_pct, t.zori_yoy_pct):.2f}")

    # ---- 3. borough inventory vs ZORI momentum over time
    say("\n3) Borough-wide monthly: StreetEasy inventory YoY vs ZORI YoY (2016+)")
    binv = inv[inv.areaType == "borough"].set_index("areaName")[m].T
    for b in ["Manhattan", "Brooklyn", "Queens", "Bronx"]:
        iy = binv[b].pct_change(12, fill_method=None) * 100
        zy = cz.loc[COUNTY[b]].pct_change(12, fill_method=None) * 100
        d = pd.concat([iy, zy], axis=1, keys=["inv", "zori"]).loc["2016-01":].dropna()
        lagged = pd.concat([iy.shift(3), zy], axis=1, keys=["inv", "zori"]).loc["2016-01":].dropna()
        say(f"   {b:<10} corr {d.inv.corr(d.zori):+.2f}  (inventory leading 3 mo: {lagged.inv.corr(lagged.zori):+.2f}), "
            f"inventory {latest} {binv.at[latest, b]:.0f} vs {binv.at[prev, b]:.0f} a year ago ({iy.iloc[-1]:+.1f}%)")

    (ZIPS / "streeteasy_vs_zori.txt").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
