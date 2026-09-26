"""NYC Passport: places worth exploring, tagged with their hex and neighborhood.

Sources: NYC Parks properties (parks.geojson), OpenStreetMap (libraries; museums, galleries,
markets, viewpoints via the maps.mail.ru Overpass mirror). All cached in raw/cache.
Writes web/public/data/explore.json  [{name, kind, lat, lon, hex, nta}]
"""

import json
from pathlib import Path

import h3
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "raw" / "cache"
OUT = ROOT / "web" / "public" / "data"

KINDS = {"museum": "Museum", "gallery": "Gallery", "marketplace": "Market", "viewpoint": "Viewpoint", "library": "Library"}


def main():
    hexes = json.loads((OUT / "hexes.json").read_text())
    idx = {h["h3"]: i for i, h in enumerate(hexes)}
    places = []

    def add(name, kind, lat, lon):
        cell = h3.latlng_to_cell(lat, lon, 8)
        if cell in idx and name:
            i = idx[cell]
            places.append({"name": name.strip(), "kind": kind, "lat": round(lat, 5), "lon": round(lon, 5), "hex": i, "nta": hexes[i]["nta"]})

    parks = json.loads((CACHE / "parks.geojson").read_text())["features"]
    for f in parks:
        p = f["properties"]
        if p.get("typecategory") in {"Flagship Park", "Community Park", "Neighborhood Park", "Nature Area", "Waterfront Facility"} and f["geometry"]:
            c = shape(f["geometry"]).representative_point()
            add(p.get("signname") or p.get("name311"), "Park", c.y, c.x)

    def osm(file, kind_of):
        for e in json.loads((CACHE / file).read_text())["elements"]:
            t = e.get("tags", {})
            lat = e.get("lat") or e.get("center", {}).get("lat")
            lon = e.get("lon") or e.get("center", {}).get("lon")
            if lat and t.get("name"):
                k = kind_of(t)
                if k:
                    add(t["name"], k, lat, lon)

    osm("osm_library.json", lambda t: "Library")
    osm("osm_explore.json", lambda t: KINDS.get(t.get("tourism") or t.get("amenity")))

    seen, out = set(), []
    for p in places:
        key = (p["name"].lower(), p["hex"])
        if key not in seen:
            seen.add(key)
            out.append(p)
    (OUT / "explore.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    counts = {}
    for p in out:
        counts[p["kind"]] = counts.get(p["kind"], 0) + 1
    print(len(out), "places", counts, "in", len({p["nta"] for p in out}), "neighborhoods")


if __name__ == "__main__":
    main()
