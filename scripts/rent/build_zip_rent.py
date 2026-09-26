"""Zillow ZORI (ZIP level) -> NYC rent by ZIP and expected rent by move-in month.

Usage: python scripts/rent/build_zip_rent.py [path/to/Zip_zori_uc_sfrcondomfr_sm_month.csv]
See scripts/rent/README.md for inputs, outputs and method.
"""

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data" / "raw" / "Zip_zori_uc_sfrcondomfr_sm_month.csv"
PROCESSED = ROOT / "data" / "processed"
WEB_JSON = ROOT / "web" / "public" / "data" / "zip_rent.json"

NYC_COUNTIES = {"New York County", "Kings County", "Queens County", "Bronx County", "Richmond County"}
META = ["RegionID", "SizeRank", "RegionName", "RegionType", "StateName", "State", "City", "Metro", "CountyName"]
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
EXCLUDE_YEARS = {2020, 2021}  # COVID: rents fell and rebounded off-season, distorting the seasonal shape
MIN_YEARS = 3  # fewer observations than this for a ZIP-month -> use the citywide median
EXPECTED_ZIPS = 149


def load(path):
    if not path.exists():
        sys.exit(f"missing input: {path}\nDownload it from "
                 "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv")
    df = pd.read_csv(path, dtype={"RegionName": str})
    df["RegionName"] = df["RegionName"].str.zfill(5)
    nyc = df[(df["State"] == "NY") & df["CountyName"].isin(NYC_COUNTIES)]
    long = nyc.melt(id_vars=META, var_name="date", value_name="rent").dropna(subset=["rent"])
    long = long.rename(columns={"RegionName": "zip", "CountyName": "county"})
    long["date"] = pd.to_datetime(long["date"]).dt.to_period("M")
    return long[["zip", "county", "date", "rent"]].sort_values(["zip", "date"]), nyc


def level(long):
    """rent_12mo = mean of the last 12 calendar months in the file; rent_yoy vs the 12 before.
    ZIPs with gaps are averaged over the months they have (months_in_12mo says how many)."""
    last = long["date"].max()
    recent = long[long["date"] > last - 12]
    prior = long[(long["date"] <= last - 12) & (long["date"] > last - 24)]
    out = recent.groupby("zip").agg(county=("county", "first"), rent_12mo=("rent", "mean"),
                                    months_in_12mo=("rent", "size"))
    out["rent_yoy"] = out["rent_12mo"] / prior.groupby("zip")["rent"].mean() - 1
    out["first_month_with_data"] = long.groupby("zip")["date"].min().astype(str)
    return out, last


def seasonality(long):
    """season_idx per (zip, calendar month) = mean of rent / centered 12-month trend, skipping 2020-21.
    The trend is computed on a gap-free calendar index so missing months don't shift the window."""
    parts = []
    for z, g in long.groupby("zip"):
        s = g.set_index("date")["rent"]
        s = s.reindex(pd.period_range(s.index.min(), s.index.max(), freq="M"))
        trend = s.rolling(12, center=True, min_periods=9).mean()
        idx = (s / trend).dropna()
        idx = idx[~idx.index.year.isin(EXCLUDE_YEARS)]
        parts.append(pd.DataFrame({"zip": z, "month": idx.index.month, "idx": idx.values}))
    ratios = pd.concat(parts)
    seas = ratios.groupby(["zip", "month"])["idx"].agg(season_idx="mean", n_years="size").reset_index()

    # every ZIP gets all 12 months, even ones with no usable history
    full = pd.MultiIndex.from_product([sorted(long["zip"].unique()), range(1, 13)], names=["zip", "month"])
    seas = seas.set_index(["zip", "month"]).reindex(full).reset_index()
    seas["n_years"] = seas["n_years"].fillna(0).astype(int)

    reliable = seas[seas["n_years"] >= MIN_YEARS]
    citywide = reliable.groupby("month")["season_idx"].median()
    fallback = seas["n_years"] < MIN_YEARS
    seas["used_citywide"] = fallback
    seas.loc[fallback, "season_idx"] = seas.loc[fallback, "month"].map(citywide)
    return seas, citywide


def build():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else INPUT
    long, nyc = load(path)
    zips, last = level(long)
    seas, citywide = seasonality(long)

    seas = seas.join(zips["rent_12mo"], on="zip")
    seas["avg_rent"] = (seas["rent_12mo"] * seas["season_idx"]).round().astype(int)
    monthly = seas[["zip", "month", "avg_rent", "season_idx", "n_years"]]

    wide = monthly.pivot(index="zip", columns="month", values="avg_rent")
    wide.columns = MONTHS
    zips = zips.join(wide)
    zips["cheapest_month"] = wide.idxmin(axis=1)
    zips["priciest_month"] = wide.idxmax(axis=1)
    zips["season_swing"] = wide.max(axis=1) - wide.min(axis=1)
    # TODO: ACS fallback — NYC ZIPs with no ZORI row (PO boxes aside) would get ACS B25064
    # median gross rent here, flagged as estimated, with citywide season_idx applied.

    zips["rent_12mo"] = zips["rent_12mo"].round().astype(int)
    zips["rent_yoy"] = zips["rent_yoy"].round(4)
    cols = ["county", "rent_12mo", "rent_yoy", *MONTHS, "cheapest_month", "priciest_month",
            "season_swing", "first_month_with_data", "months_in_12mo"]

    PROCESSED.mkdir(parents=True, exist_ok=True)
    monthly.round({"season_idx": 4}).to_csv(PROCESSED / "zip_rent_monthly.csv", index=False)
    zips[cols].to_csv(PROCESSED / "zip_rent.csv")
    WEB_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "Zillow Observed Rent Index (ZORI), smoothed, all homes",
        "through": str(last),
        "zips": {z: {k: (None if pd.isna(v) else v) for k, v in r.items()} for z, r in zips[cols].to_dict("index").items()},
    }
    WEB_JSON.write_text(json.dumps(payload, separators=(",", ":"), default=int))

    return zips, seas, citywide, long, nyc, last


def checks(zips, seas, citywide, long, nyc, last):
    failures = []

    def check(ok, msg):
        print(f"  [{'ok' if ok else 'FAIL'}] {msg}")
        if not ok:
            failures.append(msg)

    print(f"\nSanity checks (data through {last})")
    check(len(zips) == EXPECTED_ZIPS, f"{len(zips)} ZIPs (expected {EXPECTED_ZIPS})")
    check(zips.index.str.fullmatch(r"\d{5}").all(), "all ZIPs are 5 digits")
    counties = set(zips["county"])
    check(counties == NYC_COUNTIES, f"all five boroughs present: {sorted(counties)}")
    for z, expect in [("10025", 4700), ("10027", 3900)]:
        if z in zips.index:
            v = zips.at[z, "rent_12mo"]
            check(abs(v / expect - 1) < 0.10, f"{z} rent_12mo ${v:,} (expected ~${expect:,})")
        else:
            check(False, f"{z} exists")
    lo, hi = seas["season_idx"].min(), seas["season_idx"].max()
    check(0.9 <= lo and hi <= 1.1, f"season_idx range {lo:.4f}..{hi:.4f} within 0.9..1.1")

    print("\nCitywide median season_idx by month (ZIP-months with n_years >= 3):")
    print("  " + "  ".join(f"{MONTHS[m - 1]} {v:.4f}" for m, v in citywide.items()))
    summer, winter = citywide.loc[[6, 7, 8]].mean(), citywide.loc[[12, 1, 2]].mean()
    if summer > winter:
        print(f"  summer (Jun-Aug) {summer:.4f} > winter (Dec-Feb) {winter:.4f}, as expected")
    else:
        print(f"  WARNING: summer (Jun-Aug) {summer:.4f} is NOT above winter (Dec-Feb) {winter:.4f}")

    print("\nData notes:")
    gaps = zips[zips["months_in_12mo"] < 12]
    print(f"  {len(gaps)} ZIPs have fewer than 12 months in the last year (rent_12mo averages what exists): "
          + ", ".join(f"{z}({n})" for z, n in gaps["months_in_12mo"].items()))
    fb = seas[seas["used_citywide"]]
    print(f"  {fb['zip'].nunique()} ZIPs use the citywide index for at least one month ({len(fb)} of {len(seas)} ZIP-months)")
    print(f"  {zips['rent_yoy'].isna().sum()} ZIPs have no rent_yoy (no data in the prior 12 months)")
    mean_idx = seas.groupby("zip")["season_idx"].mean()
    print(f"  per-ZIP mean of the 12 season_idx values: {mean_idx.min():.4f}..{mean_idx.max():.4f} "
          "(not renormalized, so the 12 avg_rent values don't average exactly to rent_12mo)")

    if failures:
        sys.exit(f"\n{len(failures)} sanity check(s) failed: {failures}")
    print("\nAll sanity checks passed.")


if __name__ == "__main__":
    checks(*build())
