"""Map NYPD CompStat precinct numbers onto NTA neighborhoods.

Precinct counts are split across the NTAs a precinct overlaps, in proportion to
residents (NTA population x share of NTA area inside the precinct).

Needs data/crime/compstat.json (run parse_compstat.py first).

Outputs:
  data/crime/precinct_nta_crosswalk.csv   precinct, nta, share of precinct residents, share of NTA area
  data/crime/precincts.json               per-precinct summary incl. residents and rates
  web/public/data/crime_by_nta.json       per-NTA summary for the app
  web/public/data/layers.json             adds/replaces the crime-trend layers (Safety group, optional)
"""

import csv
import json
import sys
from pathlib import Path

from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_layers import OUT, Geo, population, soql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CRIME = ROOT / "data" / "crime"
VIOLENT = ["murder", "rape", "robbery", "fel_assault"]
PROPERTY = ["burglary", "gr_larceny", "g_l_a"]


def ytd(report, keys, year):
    return sum((report["complaints"][k]["ytd"][year] or 0) for k in keys)


def main():
    compstat = json.loads((CRIME / "compstat.json").read_text())
    reports = {r["precinct"]: r for r in compstat["reports"] if r["type"] == "precinct"}

    geo = Geo()
    pop = population(geo)
    rows = soql("data.cityofnewyork.us", "y76i-bdw7", {"$select": "precinct,the_geom"}, "precincts")
    precincts = {int(r["precinct"]): shape(r["the_geom"]) for r in rows}

    # residents of each precinct x NTA piece
    pieces = []  # (precinct, nta, residents, share of nta area)
    for pct, pg in precincts.items():
        for i in geo.tree.query(pg, predicate="intersects"):
            nta_poly, code = geo.polys[i], geo.codes[i]
            inter = pg.intersection(nta_poly).area
            if inter <= 0:
                continue
            share = inter / nta_poly.area
            pieces.append((pct, code, pop.get(code, 0) * share, share))

    residents = {}
    for pct, _, r, _ in pieces:
        residents[pct] = residents.get(pct, 0) + r

    CRIME.mkdir(parents=True, exist_ok=True)
    with open(CRIME / "precinct_nta_crosswalk.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["precinct", "nta", "share_of_precinct_residents", "share_of_nta_area"])
        for pct, code, r, share in sorted(pieces):
            if residents.get(pct):
                w.writerow([pct, code, round(r / residents[pct], 4), round(share, 4)])

    # per-precinct summary
    summary = {}
    for pct, rep in reports.items():
        res = residents.get(pct, 0)
        v26, v25 = ytd(rep, VIOLENT, "2026"), ytd(rep, VIOLENT, "2025")
        summary[pct] = {
            "name": rep["name"], "residents": round(res),
            "violent_ytd": v26, "violent_ytd_2025": v25,
            "violent_change_pct": round(100 * (v26 / v25 - 1), 1) if v25 else None,
            "violent_per_1k_ytd": round(1000 * v26 / res, 2) if res > 1000 else None,
            "property_ytd": ytd(rep, PROPERTY, "2026"), "property_ytd_2025": ytd(rep, PROPERTY, "2025"),
            "shooting_victims_ytd": rep["complaints"]["shooting_vic"]["ytd"]["2026"] or 0,
            "major7_change_pct": rep["complaints"]["total"]["ytd"]["pct_change"],
            "major7_change_since_1993_pct": rep["complaints"]["total"]["pct_change_33yr"],
        }
    (CRIME / "precincts.json").write_text(json.dumps(summary, indent=1))

    # per-NTA: allocate precinct counts by resident share
    acc = {}
    for pct, code, r, _ in pieces:
        s = summary.get(pct)
        if not s or not residents.get(pct):
            continue
        w = r / residents[pct]
        a = acc.setdefault(code, {"precincts": [], "v26": 0.0, "v25": 0.0, "p26": 0.0, "p25": 0.0, "shoot": 0.0})
        if w >= 0.02:
            a["precincts"].append(pct)
        a["v26"] += w * s["violent_ytd"]
        a["v25"] += w * s["violent_ytd_2025"]
        a["p26"] += w * s["property_ytd"]
        a["p25"] += w * s["property_ytd_2025"]
        a["shoot"] += w * s["shooting_victims_ytd"]

    by_nta = {}
    for code, a in acc.items():
        p = pop.get(code, 0)
        by_nta[code] = {
            "precincts": sorted(set(a["precincts"])),
            "violent_ytd": round(a["v26"], 1),
            "violent_change_pct": round(100 * (a["v26"] / a["v25"] - 1), 1) if a["v25"] >= 5 else None,
            "property_change_pct": round(100 * (a["p26"] / a["p25"] - 1), 1) if a["p25"] >= 5 else None,
            "violent_per_1k_ytd": round(1000 * a["v26"] / p, 2) if p > 500 else None,
            "shooting_victims_ytd": round(a["shoot"], 1),
        }
    (OUT / "crime_by_nta.json").write_text(json.dumps({
        "week_start": compstat["week_start"], "week_end": compstat["week_end"],
        "source": "NYPD CompStat, year to date vs same period 2025",
        "note": "Reported complaints, not risk. Violent = murder, rape, robbery, felony assault. "
                "Precinct counts split across neighborhoods by estimated residents.",
        "ntas": by_nta,
    }, separators=(",", ":")))

    # layers the app picks up automatically (Safety group stays hidden unless the user opts in)
    layers_path = OUT / "layers.json"
    doc = json.loads(layers_path.read_text())
    new = [
        {"id": "violent_trend", "label": "Violent crime vs last year", "group": "Safety", "unit": "% change",
         "better": "low", "source": "NYPD CompStat", "year": f"YTD to {compstat['week_end']}", "optional": True,
         "note": "Change in reported violent felonies vs the same period last year.",
         "nta": {k: v["violent_change_pct"] for k, v in by_nta.items() if v["violent_change_pct"] is not None}},
        {"id": "property_trend", "label": "Property crime vs last year", "group": "Safety", "unit": "% change",
         "better": "low", "source": "NYPD CompStat", "year": f"YTD to {compstat['week_end']}", "optional": True,
         "note": "Burglary, grand larceny and car theft vs the same period last year.",
         "nta": {k: v["property_change_pct"] for k, v in by_nta.items() if v["property_change_pct"] is not None}},
    ]
    ids = {l["id"] for l in new}
    doc["layers"] = [l for l in doc["layers"] if l["id"] not in ids] + new
    layers_path.write_text(json.dumps(doc, separators=(",", ":")))

    print(f"{len(precincts)} precincts, {len(pieces)} precinct-NTA pieces, {len(by_nta)} NTAs")
    missing = sorted(set(reports) - set(precincts))
    print("CompStat precincts without a boundary:", missing or "none")


if __name__ == "__main__":
    main()
