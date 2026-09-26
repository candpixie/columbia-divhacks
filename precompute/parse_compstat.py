"""Convert NYPD CompStat weekly Excel reports into JSON + CSV.

Input:  data/nyc-Borough and Precinct Crime Statistics/cs-en-us-*.xlsx
Output: data/crime/compstat.json   one record per report (precinct, patrol borough, city)
        data/crime/compstat_long.csv  tidy rows: area, crime, period, year/metric, value

"***.*" in the source means the % change is undefined (divide by zero); it becomes null.
"""

import csv
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "nyc-Borough and Precinct Crime Statistics"
OUT = ROOT / "data" / "crime"

PATROL_BOROUGHS = {
    "pbbn": "Patrol Borough Brooklyn North", "pbbs": "Patrol Borough Brooklyn South",
    "pbmn": "Patrol Borough Manhattan North", "pbms": "Patrol Borough Manhattan South",
    "pbqn": "Patrol Borough Queens North", "pbqs": "Patrol Borough Queens South",
    "pbsi": "Patrol Borough Staten Island", "pbxn": "Patrol Borough Bronx North",
    "pbxs": "Patrol Borough Bronx South",
}


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2) if isinstance(v, float) else v
    s = str(v).strip()
    if not s or "*" in s:
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else round(f, 2)
    except ValueError:
        return None


def slug(label):
    return re.sub(r"[^a-z0-9]+", "_", label.lower().replace("*", "")).strip("_")


def parse(path):
    code = path.stem.replace("cs-en-us-", "")
    ws = openpyxl.load_workbook(path, data_only=True).active
    # Keep full rows: blank cells matter for column positions (blank history cells = no data).
    rows = [list(r) for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)]

    if code.endswith("pct"):
        kind, precinct, name = "precinct", int(code[:-3]), None
    elif code == "city":
        kind, precinct, name = "city", None, "New York City"
    else:
        kind, precinct, name = "patrol_borough", None, PATROL_BOROUGHS.get(code, code)

    rec = {"id": code, "type": kind, "precinct": precinct, "name": name}
    section = None
    complaints, history, hist_cols = {}, {}, []
    for r in rows:
        cells = [c for c in r if c is not None]
        first = str(r[0] if r[0] is not None else cells[0]).strip()
        if first.startswith("Volume") and name is None:
            rec["name"] = str(cells[-1]).strip()
        m = re.search(r"Week\s+(\d+/\d+/\d+)\s+Through\s+(\d+/\d+/\d+)", first)
        if m:
            rec["week_start"], rec["week_end"] = m.groups()
        if first in ("Crime Complaints", "Traffic Statistics"):
            section = "complaints"
            continue
        if first == "Historical Perspective":
            section = "history"
            continue
        if section == "history" and any(str(c).strip() == "1990" for c in r if c is not None):
            hist_cols = [(i, str(c).strip()) for i, c in enumerate(r)
                         if c is not None and re.fullmatch(r"\d{4}", str(c).strip())]
            continue
        if not first or first in ("Figures are preliminary and subject to further analysis and revision.",):
            continue
        if section == "complaints" and r[0] and len(r) >= 14:
            v = [num(x) for x in r[2:14]]
            complaints[slug(first)] = {
                "label": first,
                "week": {"2026": v[0], "2025": v[1], "pct_change": v[2]},
                "28_day": {"2026": v[3], "2025": v[4], "pct_change": v[5]},
                "ytd": {"2026": v[6], "2025": v[7], "pct_change": v[8]},
                "pct_change_2yr": v[9], "pct_change_16yr": v[10], "pct_change_33yr": v[11],
            }
        elif section == "history" and hist_cols and r[0] and len(cells) >= 5:
            history[slug(first)] = {"label": first, **{y: num(r[i]) for i, y in hist_cols}}
    rec["complaints"] = complaints
    rec["history"] = history
    return rec


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    reports = [parse(p) for p in sorted(SRC.glob("cs-en-us-*.xlsx"))]
    (OUT / "compstat.json").write_text(json.dumps({
        "source": "NYPD CompStat weekly reports",
        "week_start": reports[0].get("week_start"), "week_end": reports[0].get("week_end"),
        "note": "Figures are preliminary. Crime complaints, not convictions. null = % change undefined.",
        "reports": reports,
    }, indent=1))

    with open(OUT / "compstat_long.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "type", "precinct", "name", "crime", "period", "metric", "value"])
        for r in reports:
            base = [r["id"], r["type"], r["precinct"], r["name"]]
            for k, c in r["complaints"].items():
                for period in ("week", "28_day", "ytd"):
                    for metric, val in c[period].items():
                        w.writerow(base + [k, period, metric, val])
                for metric in ("pct_change_2yr", "pct_change_16yr", "pct_change_33yr"):
                    w.writerow(base + [k, "long_term", metric, c[metric]])
            for k, h in r["history"].items():
                for year, val in h.items():
                    if year != "label":
                        w.writerow(base + [k, "calendar_year", year, val])

    bad = [r["id"] for r in reports if len(r["complaints"]) < 15 or len(r["history"]) < 8]
    print(f"{len(reports)} reports -> {OUT}/compstat.json, compstat_long.csv")
    print("incomplete parses:", bad or "none")


if __name__ == "__main__":
    main()
