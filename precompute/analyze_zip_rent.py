"""Rent by NYC ZIP code from two public sources.

Needs data/zips/nyc_zips.json (run scrape_zips.py first) and:
  raw/zillow/zip_zori.csv   Zillow Observed Rent Index, all homes, smoothed, monthly
      https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv
  raw/hud/safmr_2026.xlsx   HUD FY2026 Small Area Fair Market Rents (40th pct gross rent by bedrooms)
      https://www.huduser.gov/portal/datasets/fmr/fmr2026/fy2026_safmrs.xlsx

ZORI tracks asking rents on new listings, so it runs ahead of what sitting tenants pay.
SAFMR is HUD's estimate of a modest (40th percentile) rent including utilities.

Outputs:
  data/zips/rent_by_zip.csv        one row per NYC ZIP
  data/zips/rent_by_borough.csv    borough medians
  data/zips/rent_trend_by_borough.csv   monthly median ZORI per borough
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
ZIPS = ROOT / "data" / "zips"
RAW = ROOT / "raw"


def zips():
    rows = pd.read_csv(ZIPS / "nyc_zips.csv", dtype=str)
    return rows.groupby("zip").agg(borough=("borough", "first")).reset_index()


def zillow():
    z = pd.read_csv(RAW / "zillow" / "zip_zori.csv", dtype={"RegionName": str})
    months = [c for c in z.columns if c[:2] == "20"]
    z = z.rename(columns={"RegionName": "zip"}).set_index("zip")
    series = z[months]
    latest = months[-1]

    def ago(n):
        return months[-1 - n]

    out = pd.DataFrame({
        "zori": series[latest],
        "zori_1y_ago": series[ago(12)],
        "zori_5y_ago": series[ago(60)],
        "zori_feb2020": series[[m for m in months if m.startswith("2020-02")][0]],
    })
    out["yoy_pct"] = (out.zori / out.zori_1y_ago - 1) * 100
    out["5y_pct"] = (out.zori / out.zori_5y_ago - 1) * 100
    out["vs_feb2020_pct"] = (out.zori / out.zori_feb2020 - 1) * 100
    return out, series, latest


def hud():
    h = pd.read_excel(RAW / "hud" / "safmr_2026.xlsx", dtype={0: str})
    h.columns = [str(c).replace("\n", " ") for c in h.columns]
    keep = {"ZIP Code": "zip", **{f"SAFMR {b}BR": f"safmr_{b}br" for b in range(5)}}
    h = h[list(keep)].rename(columns=keep)
    h["zip"] = h["zip"].str.zfill(5)
    # a ZIP spanning two HUD areas appears twice; take the higher-rent row
    return h.sort_values("safmr_1br").drop_duplicates("zip", keep="last").set_index("zip")


def main():
    base = zips().set_index("zip")
    z, series, latest = zillow()
    df = base.join(z).join(hud())
    df = df.round({c: 1 for c in df.columns if c.endswith("_pct")}).round({"zori": 0, "zori_1y_ago": 0, "zori_5y_ago": 0, "zori_feb2020": 0})
    df.index.name = "zip"
    df.to_csv(ZIPS / "rent_by_zip.csv")

    by_b = df.groupby("borough").agg(
        zips=("borough", "size"),
        zips_with_zori=("zori", "count"),
        median_zori=("zori", "median"),
        median_yoy_pct=("yoy_pct", "median"),
        median_5y_pct=("5y_pct", "median"),
        median_vs_feb2020_pct=("vs_feb2020_pct", "median"),
        median_safmr_1br=("safmr_1br", "median"),
        median_safmr_2br=("safmr_2br", "median"),
    ).round(1)
    by_b.to_csv(ZIPS / "rent_by_borough.csv")

    trend = series.loc[series.index.intersection(df.index)].join(df["borough"]).groupby("borough").median().T
    trend.index.name = "month"
    trend.round(0).to_csv(ZIPS / "rent_trend_by_borough.csv")

    has = df.dropna(subset=["zori"])
    cols = ["borough", "zori", "yoy_pct", "vs_feb2020_pct", "safmr_1br"]
    pd.set_option("display.width", 160)
    print(f"Zillow month: {latest}.  ZIPs: {len(df)} total, {len(has)} with ZORI, {df.safmr_1br.notna().sum()} with SAFMR\n")
    print(by_b.to_string(), "\n")
    print("Most expensive (ZORI):\n", has.nlargest(10, "zori")[cols].to_string(), "\n")
    print("Least expensive (ZORI):\n", has.nsmallest(10, "zori")[cols].to_string(), "\n")
    print("Fastest YoY growth:\n", has.nlargest(10, "yoy_pct")[cols].to_string(), "\n")
    print("Falling YoY:\n", has[has.yoy_pct < 0].sort_values("yoy_pct")[cols].to_string(), "\n")
    print(f"Citywide median ZORI {has.zori.median():.0f}, YoY {has.yoy_pct.median():.1f}%, vs Feb 2020 {has.vs_feb2020_pct.median():.1f}%")
    print(f"Corr(ZORI, SAFMR 1BR) = {has.zori.corr(has.safmr_1br):.2f}")


if __name__ == "__main__":
    main()
