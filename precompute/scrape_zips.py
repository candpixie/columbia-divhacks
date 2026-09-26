"""Scrape New York ZIP codes from the Capitol Impact zip list and keep the NYC ones.

Source: https://www.ciclt.net/sn/clt/capitolimpact/gw_ziplist.aspx?zip=100
The page lists every ZIP under a 3-digit prefix with its city names and county.
NYC ZIPs all fall under prefixes 100-104 and 110-116, so we fetch 100-119 and
keep rows whose county is one of the five boroughs. The site labels Manhattan's
county "New York City" and Staten Island's "Richmond".

A ZIP can appear several times (one row per acceptable city name).

Outputs:
  data/zips/ny_zips_100_119.csv   every row scraped: zip, city, county
  data/zips/nyc_zips.csv          NYC rows only: zip, city, county, borough
  data/zips/nyc_zips.json         {borough: [zip, ...]} plus a flat sorted list
"""

import csv
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "zips"
URL = "https://www.ciclt.net/sn/clt/capitolimpact/gw_ziplist.aspx?zip={}"
PREFIXES = range(100, 120)

BOROUGH = {
    "New York City": "Manhattan",
    "Bronx": "Bronx",
    "Kings": "Brooklyn",
    "Queens": "Queens",
    "Richmond": "Staten Island",
}

ROW = re.compile(r"<tr><TD[^>]*>(.*?)</tr>", re.S | re.I)
ZIP = re.compile(r"zip=(\d{5})")
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
TAG = re.compile(r"<[^>]+>")


def fetch(prefix):
    req = urllib.request.Request(URL.format(prefix), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def parse(html):
    for row in ROW.findall(html):
        z = ZIP.search(row)
        cells = [TAG.sub("", c).strip() for c in CELL.findall(row)]
        if z and len(cells) >= 2:
            yield {"zip": z.group(1), "city": cells[-2], "county": cells[-1]}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for p in PREFIXES:
        found = list(parse(fetch(p)))
        print(f"{p}: {len(found)} rows")
        rows += found

    with open(OUT / "ny_zips_100_119.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["zip", "city", "county"])
        w.writeheader()
        w.writerows(rows)

    nyc = [dict(r, borough=BOROUGH[r["county"]]) for r in rows if r["county"] in BOROUGH]
    with open(OUT / "nyc_zips.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["zip", "city", "county", "borough"])
        w.writeheader()
        w.writerows(nyc)

    by_borough = {b: sorted({r["zip"] for r in nyc if r["borough"] == b}) for b in BOROUGH.values()}
    all_zips = sorted({r["zip"] for r in nyc})
    (OUT / "nyc_zips.json").write_text(
        json.dumps({"source": URL.format(100), "count": len(all_zips), "boroughs": by_borough, "zips": all_zips}, indent=2)
    )
    print(f"{len(all_zips)} unique NYC ZIPs: " + ", ".join(f"{b} {len(z)}" for b, z in by_borough.items()))


if __name__ == "__main__":
    main()
