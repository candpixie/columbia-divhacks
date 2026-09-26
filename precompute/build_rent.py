"""Join StreetEasy median asking rent to NTA 2020 neighborhoods.

Writes web/public/data/ntas.json:
  { nta: { name, borough, rent: {studio, 1br, 2br, 3br}, estimated, trend } }
rent = median of the last 6 months with data. estimated = no StreetEasy
neighborhood matched, so the borough median was used. trend = 1br YoY %.
"""

import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SE = ROOT / "raw" / "se"
OUT = ROOT / "web" / "public" / "data"
BEDS = {"studio": "Studio", "1br": "OneBd", "2br": "TwoBd", "3br": "ThreePlusBd"}

# NTA name fragments that StreetEasy calls something else
ALIASES = {
    "harlem": "central harlem",
    "hell's kitchen": "midtown west",
    "gramercy": "gramercy park",
    "murray hill-kips bay": "midtown east",
    "east midtown": "midtown east",
    "midtown-times square": "midtown",
    "manhattanville": "west harlem",
    "fordham heights": "fordham",
    "stuyvesant town-peter cooper village": "stuyvesant town/pcv",
    "upper east side-lenox hill-roosevelt island": "upper east side",
    "mapleton-midwood": "midwood",
    "claremont village": "morrisania",
    "mount eden": "concourse",
    "mount hope": "tremont",
    "west farms": "east tremont",
    "allerton": "pelham gardens",
    "ocean hill": "bedford-stuyvesant",
    "cypress hills": "east new york",
    "madison": "sheepshead bay",
    "queensbridge-ravenswood-dutch kills": "long island city",
    "flushing-willets point": "flushing",
    "murray hill-broadway flushing": "flushing",
    "east flushing": "flushing",
    "queensboro hill": "flushing",
    "baisley park": "south jamaica",
    "far rockaway": "rockaway all",
    "rockaway beach": "rockaway all",
    "breezy point": "rockaway all",
}


def norm(s):
    return re.sub(r"\s*\([^)]*\)", "", s.lower()).strip()


def recent(df, months=6):
    cols = [c for c in df.columns if re.match(r"\d{4}-\d{2}", c)]
    last = df[cols[-months:]].median(axis=1, skipna=True)
    prior = df[cols[-months - 12:-12]].median(axis=1, skipna=True)
    return last, prior


def main():
    tables = {}
    for key, name in BEDS.items():
        df = pd.read_csv(SE / f"medianAskingRent_{name}.csv")
        last, prior = recent(df)
        df = df.copy().assign(last=last, prior=prior)
        tables[key] = df.set_index("areaName")

    one = tables["1br"]
    se_names = {norm(n): n for n in one[one.areaType == "neighborhood"].index}
    boroughs = one[one.areaType == "borough"].index

    gj = json.loads((ROOT / "raw" / "nta2020.geojson").read_text())
    out = {}
    unmatched = []
    for f in gj["features"]:
        p = f["properties"]
        if p["ntatype"] != "0":
            continue
        n = norm(p["ntaname"])
        matches = [se_names[a] for key, a in ALIASES.items() if n.startswith(key) and a in se_names]
        if not matches:
            matches = [orig for sn, orig in se_names.items() if sn in n]
        estimated = not matches
        if estimated:
            unmatched.append(p["ntaname"])
            matches = [b for b in boroughs if b.lower() == p["boroname"].lower()]

        rent = {}
        for key, df in tables.items():
            vals = df.loc[matches, "last"].dropna()
            rent[key] = int(round(vals.median(), -1)) if len(vals) else None
        # fill gaps from the 1br using borough bedroom ratios
        b = p["boroname"]
        for key in BEDS:
            if rent[key] is None and rent["1br"]:
                ratio = tables[key].loc[b, "last"] / tables["1br"].loc[b, "last"]
                rent[key] = int(round(rent["1br"] * ratio, -1))
        cur, old = one.loc[matches, "last"].median(), one.loc[matches, "prior"].median()
        trend = round((cur / old - 1) * 100) if pd.notna(cur) and pd.notna(old) and old else None
        out[p["nta2020"]] = {
            "name": p["ntaname"], "borough": b, "rent": rent,
            "estimated": estimated, "trend": trend, "se": matches if not estimated else [],
        }
    (OUT / "ntas.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(out)} NTAs, {len(unmatched)} fell back to borough median")
    print("unmatched:", unmatched)


if __name__ == "__main__":
    main()
