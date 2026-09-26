"""Turn NYC public datasets into neighborhood layers.

Every dataset becomes one number per NTA (and, for "walk to nearest X"
layers, one number per hex). The web app treats all layers the same way.

Writes web/public/data/layers.json:
  { "layers": [{id, label, group, unit, better, optional, source, year, nta: {code: value}, hex?: [..]}] }
Raw downloads are cached in raw/cache so reruns are fast.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely import STRtree, points
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
CACHE = RAW / "cache"
OUT = ROOT / "web" / "public" / "data"
CACHE.mkdir(parents=True, exist_ok=True)

NYC_BBOX = (40.49, -74.27, 40.92, -73.68)  # s, w, n, e
M_PER_DEG_LAT = 111_320
M_PER_DEG_LNG = 111_320 * np.cos(np.radians(40.7))
WALK_M_PER_MIN = 80 / 1.3  # 4.8 km/h with a street-grid detour factor
LAST_YEAR = "2025-09-26"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get_json(url, cache_name, timeout=300):
    path = CACHE / cache_name
    if path.exists():
        return json.loads(path.read_text())
    log(f"  fetching {cache_name}")
    req = urllib.request.Request(url, headers={"User-Agent": "rent-radius-divhacks"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
            path.write_text(json.dumps(data))
            return data
        except Exception as e:  # flaky open-data endpoints
            log(f"  retry {attempt + 1}: {e}")
            time.sleep(3)
    raise RuntimeError(f"failed: {url}")


def soql(domain, dataset, params, cache_name):
    """Page through a Socrata query."""
    rows, offset = [], 0
    while True:
        q = dict(params, **{"$limit": 50000, "$offset": offset})
        url = f"https://{domain}/resource/{dataset}.json?{urllib.parse.urlencode(q)}"
        page = get_json(url, f"{cache_name}_{offset}.json")
        rows += page
        if len(page) < 50000:
            return rows
        offset += 50000


def grid_counts(dataset, point_col, where, name, value="count(*)", grid=0.002):
    """Server-side aggregation onto a ~200m grid: returns (lng, lat, n) rows."""
    rows = soql("data.cityofnewyork.us", dataset, {
        "$select": f"snap_to_grid({point_col},{grid}) as g, {value} as n",
        "$where": f"{where} AND {point_col} IS NOT NULL",
        "$group": "g",
    }, name)
    out = []
    for r in rows:
        g = r.get("g")
        if g and r.get("n") is not None:
            lng, lat = g["coordinates"]
            out.append((lng, lat, float(r["n"])))
    return np.array(out) if out else np.zeros((0, 3))


def latlng_rows(domain, dataset, where, name, weight=None):
    """For datasets without a point column: pull lat/lng (and an optional weight) and return (lng, lat, n)."""
    cols = "latitude,longitude" + (f",{weight}" if weight else "")
    rows = soql(domain, dataset, {"$select": cols, "$where": f"{where} AND latitude IS NOT NULL"}, name)
    out = []
    for r in rows:
        try:
            lat, lng = float(r["latitude"]), float(r["longitude"])
        except (KeyError, ValueError):
            continue
        if NYC_BBOX[0] < lat < NYC_BBOX[2] and NYC_BBOX[1] < lng < NYC_BBOX[3]:
            out.append((lng, lat, float(r.get(weight, 1) or 0) if weight else 1.0))
    return np.array(out) if out else np.zeros((0, 3))


class Geo:
    def __init__(self):
        gj = json.loads((RAW / "nta2020.geojson").read_text())
        feats = [f for f in gj["features"] if f["properties"]["ntatype"] == "0"]
        self.codes = [f["properties"]["nta2020"] for f in feats]
        self.cdta = {f["properties"]["nta2020"]: f["properties"]["cdta2020"] for f in feats}
        self.polys = [shape(f["geometry"]) for f in feats]
        self.tree = STRtree(self.polys)
        # km^2 via local equirectangular scaling
        self.area_km2 = {c: p.area * M_PER_DEG_LAT * M_PER_DEG_LNG / 1e6 for c, p in zip(self.codes, self.polys)}
        self.hexes = json.loads((OUT / "hexes.json").read_text())
        self.hex_xy = np.array([[h["lng"] * M_PER_DEG_LNG, h["lat"] * M_PER_DEG_LAT] for h in self.hexes])

    def assign(self, lng, lat):
        """Point -> NTA code (or None) for arrays of coordinates."""
        idx = self.tree.query(points(lng, lat), predicate="within")
        out = np.full(len(lng), None, dtype=object)
        for pt, poly in zip(*idx):
            out[pt] = self.codes[poly]
        return out

    def sum_by_nta(self, arr):
        if not len(arr):
            return {}
        codes = self.assign(arr[:, 0], arr[:, 1])
        totals = {c: 0.0 for c in self.codes}
        for c, n in zip(codes, arr[:, 2]):
            if c:
                totals[c] += n
        return totals

    def walk_to_nearest(self, lng, lat):
        """Minutes from each hex center to the nearest point."""
        xy = np.column_stack([np.asarray(lng) * M_PER_DEG_LNG, np.asarray(lat) * M_PER_DEG_LAT])
        d, _ = cKDTree(xy).query(self.hex_xy)
        return np.round(d / WALK_M_PER_MIN).astype(int)

    def hex_to_nta_median(self, per_hex):
        vals = {}
        for h, v in zip(self.hexes, per_hex):
            vals.setdefault(h["nta"], []).append(v)
        return {c: float(np.median(v)) for c, v in vals.items()}


def population(geo):
    """ZIP-area (MODZCTA) population estimates, area-weighted onto 2020 NTAs.
    2020 NTA population isn't on Open Data; this assumes even density within a ZIP."""
    rows = soql("data.cityofnewyork.us", "pri4-ifjk", {"$select": "modzcta,pop_est,the_geom"}, "modzcta")
    zips = [(float(r["pop_est"]), shape(r["the_geom"])) for r in rows if r.get("pop_est") and r.get("the_geom")]
    out = {}
    for code, poly in zip(geo.codes, geo.polys):
        total = 0.0
        for pop, z in zips:
            if poly.intersects(z):
                total += pop * poly.intersection(z).area / z.area
        out[code] = total
    return out


def per_1k(totals, pop):
    return {c: round(1000 * v / pop[c], 2) for c, v in totals.items() if pop.get(c, 0) > 500}


def overpass(tag_filters, name):
    s, w, n, e = NYC_BBOX
    body = "".join(f'nwr[{t}]({s},{w},{n},{e});' for t in tag_filters)
    q = f"[out:json][timeout:180];({body});out center;"
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(q)
    els = get_json(url, f"osm_{name}.json")["elements"]
    pts = [(el.get("lon") or el["center"]["lon"], el.get("lat") or el["center"]["lat"]) for el in els]
    return np.array(pts)


def main():
    geo = Geo()
    layers = []

    def add(id, label, group, unit, better, source, year, nta, hexv=None, optional=False, note=None):
        layer = {"id": id, "label": label, "group": group, "unit": unit, "better": better,
                 "source": source, "year": year, "optional": optional,
                 "nta": {k: v for k, v in nta.items() if v is not None and np.isfinite(v)}}
        if note:
            layer["note"] = note
        if hexv is not None:
            layer["hex"] = [int(x) for x in hexv]
        layers.append(layer)
        log(f"ok {id}: {len(layer['nta'])} NTAs")

    def attempt(fn):
        try:
            fn()
        except Exception as e:
            log(f"SKIP {fn.__name__}: {e}")

    pop = {}

    def pop_layer():
        pop.update(population(geo))
        add("density", "People per km²", "Neighborhood", "per km²", "none", "NYC DOHMH (MODZCTA estimates)", "2020",
            {c: round(pop[c] / geo.area_km2[c]) for c in geo.codes})

    attempt(pop_layer)

    # --- Essentials: walk to nearest ---
    def walk_layer(id, label, pts, source):
        hexv = geo.walk_to_nearest(pts[:, 0], pts[:, 1])
        add(id, label, "Essentials", "min walk", "low", source, "2026", geo.hex_to_nta_median(hexv), hexv)

    def grocery():
        walk_layer("grocery", "Supermarket", overpass(['"shop"="supermarket"', '"shop"="greengrocer"'], "grocery"), "OpenStreetMap")

    def pharmacy():
        walk_layer("pharmacy", "Pharmacy", overpass(['"amenity"="pharmacy"'], "pharmacy"), "OpenStreetMap")

    def clinic():
        rows = soql("health.data.ny.gov", "vn5v-hh5r", {
            "$select": "latitude,longitude,fac_desc_short",
            "$where": "fac_desc_short in ('DTC','HOSP','DTC-EC') AND county in ('Bronx','Kings','New York','Queens','Richmond')",
        }, "health_fac")
        pts = np.array([(float(r["longitude"]), float(r["latitude"])) for r in rows if r.get("latitude") and r.get("longitude")])
        walk_layer("clinic", "Clinic or hospital", pts, "NYS Dept of Health")

    def library():
        walk_layer("library", "Public library", overpass(['"amenity"="library"'], "library"), "OpenStreetMap")

    def citibike():
        st = get_json("https://gbfs.citibikenyc.com/gbfs/en/station_information.json", "citibike.json")["data"]["stations"]
        walk_layer("citibike", "Citi Bike dock", np.array([(s["lon"], s["lat"]) for s in st]), "Citi Bike GBFS")

    def accessible_station():
        rows = soql("data.ny.gov", "39hk-dx4f", {"$select": "gtfs_latitude,gtfs_longitude,ada"}, "mta_stations")
        pts = np.array([(float(r["gtfs_longitude"]), float(r["gtfs_latitude"])) for r in rows if r.get("ada") in ("1", "2")])
        walk_layer("ada_station", "Accessible subway station", pts, "MTA")

    def park():
        gj = get_json("https://data.cityofnewyork.us/api/geospatial/enfh-gkve?method=export&format=GeoJSON", "parks.geojson", timeout=600)
        keep = {"Flagship Park", "Community Park", "Neighborhood Park", "Nature Area", "Playground", "Garden", "Waterfront Facility"}
        polys = [shape(f["geometry"]) for f in gj["features"]
                 if f["properties"].get("typecategory") in keep and f["geometry"]]
        # sample boundary points so a big park counts from its edge, not its center
        pts = []
        for p in polys:
            for g in getattr(p, "geoms", [p]):
                b = g.exterior
                for d in np.linspace(0, b.length, max(4, int(b.length / 0.002))):
                    q = b.interpolate(d)
                    pts.append((q.x, q.y))
        walk_layer("park", "Park or playground", np.array(pts), "NYC Parks")

    for fn in (grocery, pharmacy, clinic, library, citibike, accessible_station, park):
        attempt(fn)

    # --- Quality of life (311, last 12 months, per 1,000 residents) ---
    def complaints(id, label, where, note=None):
        arr = grid_counts("erm2-nwe9", "location", f"created_date > '{LAST_YEAR}' AND ({where})", f"311_{id}")
        add(id, label, "Quality of life", "per 1k residents / yr", "low", "NYC 311", "2025-26",
            per_1k(geo.sum_by_nta(arr), pop), note=note)

    attempt(lambda: complaints("noise", "Noise complaints", "complaint_type like 'Noise%'"))
    attempt(lambda: complaints("heat", "No heat / hot water complaints", "complaint_type = 'HEAT/HOT WATER'",
                               note="A signal of landlord upkeep in the area's buildings"))
    attempt(lambda: complaints("rodents", "Rodent sightings", "complaint_type = 'Rodent'"))

    # --- Environment ---
    def air(name, id, label):
        rows = soql("data.cityofnewyork.us", "c3uy-2p5r", {
            "name": name, "geo_type_name": "CD", "measure": "Mean" if "PM" in name else "Mean",
        }, f"air_{id}")
        if not rows:
            rows = soql("data.cityofnewyork.us", "c3uy-2p5r", {"name": name, "geo_type_name": "CD"}, f"air_{id}_any")
        rows = [r for r in rows if "Annual" in r.get("measure", "") or r.get("measure") == "Mean"] or rows
        latest = max(r["time_period"] for r in rows)
        by_cd = {r["geo_join_id"]: float(r["data_value"]) for r in rows if r["time_period"] == latest}
        boro = {"MN": "1", "BX": "2", "BK": "3", "QN": "4", "SI": "5"}
        nta = {}
        for c in geo.codes:
            cd = geo.cdta[c]
            key = boro[cd[:2]] + cd[2:]
            if key in by_cd:
                nta[c] = round(by_cd[key], 2)
        add(id, label, "Environment", rows[0].get("measure_info", ""), "low", "NYC Community Air Survey", latest, nta)

    attempt(lambda: air("Fine particles (PM 2.5)", "pm25", "Fine particle pollution (PM2.5)"))
    attempt(lambda: air("Nitrogen dioxide (NO2)", "no2", "Nitrogen dioxide (NO2)"))

    def trees():
        arr = latlng_rows("data.cityofnewyork.us", "uvpi-gqnh", "status = 'Alive'", "trees_ll")
        totals = geo.sum_by_nta(arr)
        add("trees", "Street trees", "Environment", "per km²", "high", "NYC Street Tree Census", "2015",
            {c: round(v / geo.area_km2[c]) for c, v in totals.items()})

    attempt(trees)

    # --- Safety (optional, off by default) ---
    def crashes():
        arr = latlng_rows("data.cityofnewyork.us", "h9gi-nx95",
                          f"crash_date > '{LAST_YEAR}' AND number_of_persons_injured > 0", "crashes_ll",
                          weight="number_of_persons_injured")
        add("crash_injuries", "Traffic injuries", "Safety", "per 1k residents / yr", "low", "NYPD Motor Vehicle Collisions",
            "2025-26", per_1k(geo.sum_by_nta(arr), pop), optional=True)

    def violent():
        arr = grid_counts("5uac-w243", "geocoded_column",
                          "law_cat_cd = 'FELONY' AND ofns_desc in ('FELONY ASSAULT','ROBBERY','RAPE','MURDER & NON-NEGL. MANSLAUGHTER')",
                          "violent")
        add("violent_felony", "Violent felony complaints", "Safety", "per 1k residents, 2026 YTD", "low",
            "NYPD Complaint Data (violent felonies only)", "2026 YTD", per_1k(geo.sum_by_nta(arr), pop), optional=True,
            note="Reported complaints, not risk. Counts reflect policing levels as well as crime.")

    attempt(crashes)
    attempt(violent)

    (OUT / "layers.json").write_text(json.dumps({"layers": layers}, separators=(",", ":")))
    log(f"wrote {len(layers)} layers")


if __name__ == "__main__":
    main()
