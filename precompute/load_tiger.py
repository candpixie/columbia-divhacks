"""Load StreetEasy monthly rent history (2010-now) into Tiger Data (TimescaleDB).

  rent_monthly           hypertable: (month, nta, beds, median_rent, se_areas)
  rent_quarterly         continuous aggregate: quarterly average per NTA + beds
  rent_yoy               view: latest 12-month change per NTA + beds

Also exports web/public/data/rent_trend.json so the site still works if the DB is unreachable.

Usage: TIGER_DATABASE_URL=postgres://... .venv/bin/python precompute/load_tiger.py
"""

import json
import os
import re
from pathlib import Path

import pandas as pd
import psycopg

ROOT = Path(__file__).resolve().parent.parent
SE = ROOT / "raw" / "se"
OUT = ROOT / "web" / "public" / "data"
BEDS = {"studio": "Studio", "1br": "OneBd", "2br": "TwoBd", "3br": "ThreePlusBd"}


def monthly_by_nta():
    """Long table of (month, nta, beds, median_rent) using the same SE->NTA matching as build_rent.py."""
    ntas = json.loads((OUT / "ntas.json").read_text())
    rows = []
    for beds, name in BEDS.items():
        df = pd.read_csv(SE / f"medianAskingRent_{name}.csv").set_index("areaName")
        months = [c for c in df.columns if re.fullmatch(r"\d{4}-\d{2}", c)]
        for code, n in ntas.items():
            areas = n.get("se") or []
            if not areas:
                continue
            sub = df.loc[[a for a in areas if a in df.index], months]
            med = sub.median(axis=0, skipna=True).dropna()
            for m, v in med.items():
                rows.append((f"{m}-01", code, beds, float(v), ",".join(areas)))
    return rows


SCHEMA = """
CREATE TABLE IF NOT EXISTS rent_monthly (
  month       date        NOT NULL,
  nta         text        NOT NULL,
  beds        text        NOT NULL,
  median_rent numeric     NOT NULL,
  se_areas    text,
  PRIMARY KEY (nta, beds, month)
);
SELECT create_hypertable('rent_monthly', by_range('month', INTERVAL '1 year'), if_not_exists => TRUE);
"""

CAGG = """
CREATE MATERIALIZED VIEW IF NOT EXISTS rent_quarterly
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '3 months', month) AS quarter, nta, beds,
       round(avg(median_rent)) AS avg_rent, count(*) AS months
FROM rent_monthly
GROUP BY quarter, nta, beds
WITH NO DATA;
"""

YOY = """
CREATE OR REPLACE VIEW rent_yoy AS
WITH latest AS (SELECT max(month) AS m FROM rent_monthly)
SELECT cur.nta, cur.beds, cur.median_rent AS rent_now, prev.median_rent AS rent_year_ago,
       round(100 * (cur.median_rent / prev.median_rent - 1), 1) AS pct_change
FROM rent_monthly cur
JOIN latest ON cur.month = latest.m
JOIN rent_monthly prev ON prev.nta = cur.nta AND prev.beds = cur.beds
                      AND prev.month = latest.m - INTERVAL '1 year';
"""


def static_only(rows):
    """Same quarterly numbers as the continuous aggregate, computed locally (fallback file only)."""
    df = pd.DataFrame(rows, columns=["month", "nta", "beds", "rent", "se"])
    df["quarter"] = pd.to_datetime(df.month).dt.to_period("Q").dt.start_time.dt.strftime("%Y-%m")
    q = df.groupby(["nta", "beds", "quarter"]).rent.mean().round().reset_index()
    return [(r.nta, r.beds, r.quarter, r.rent) for r in q.itertuples()]


def write_fallback(q):
    trend = {}
    for nta, beds, quarter, rent in q:
        trend.setdefault(nta, {}).setdefault(beds, []).append([quarter[:7], int(rent)])
    (OUT / "rent_trend.json").write_text(json.dumps(trend, separators=(",", ":")))
    print("wrote rent_trend.json fallback")


def main():
    rows = monthly_by_nta()
    print(f"{len(rows)} monthly rows")
    url = os.environ.get("TIGER_DATABASE_URL")
    if not url:
        print("TIGER_DATABASE_URL not set: writing the static fallback only")
        write_fallback(static_only(rows))
        return
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(SCHEMA)
        conn.execute("TRUNCATE rent_monthly")
        with conn.cursor().copy("COPY rent_monthly (month, nta, beds, median_rent, se_areas) FROM STDIN") as cp:
            for r in rows:
                cp.write_row(r)
        conn.execute(CAGG)
        conn.execute("CALL refresh_continuous_aggregate('rent_quarterly', NULL, NULL)")
        conn.execute(YOY)
        n = conn.execute("SELECT count(*) FROM rent_quarterly").fetchone()[0]
        print(f"rent_quarterly: {n} rows")
        q = conn.execute(
            "SELECT nta, beds, quarter::text, avg_rent FROM rent_quarterly ORDER BY nta, beds, quarter"
        ).fetchall()

    write_fallback(q)


if __name__ == "__main__":
    main()
