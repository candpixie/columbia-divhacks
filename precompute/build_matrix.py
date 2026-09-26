"""Build hex-to-hex subway+walk travel time matrices from MTA GTFS.

Plan B routing: nodes are (parent_station, route). Ride edges use median
scheduled segment times in the window; boarding costs half the route's
headway at that station; transfers use transfers.txt min_transfer_time.

Outputs (web/public/data):
  hexes.json            [{h3, nta, lat, lng}]
  stations.json         [{id, name, lat, lng, routes}]
  matrix_<day>.bin      uint8 N*N minutes, 255 = unreachable, [origin*N + dest]
"""

import heapq
import json
import sys
from collections import defaultdict
from pathlib import Path

import h3
import numpy as np
import pandas as pd
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
GTFS = ROOT / "raw" / "gtfs_subway"
OUT = ROOT / "web" / "public" / "data"
RES = 8
WALK_KMH = 4.8
DETOUR = 1.3  # straight line -> street distance
MAX_ACCESS_MIN = 20
MAX_WAIT = 15.0
CAP = 254

DAYS = {
    "weekday": {"services": ["Weekday"], "window": (8 * 3600, 9 * 3600)},
    "saturday": {"services": ["Saturday", "Saturday-H-20260908-20261031"], "window": (12 * 3600, 13 * 3600)},
}


def to_sec(t: str) -> int:
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def haversine_km(lat1, lng1, lat2, lng2):
    lat1, lng1, lat2, lng2 = map(np.radians, (lat1, lng1, lat2, lng2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lng2 - lng1) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(a))


def walk_min(km):
    return km * DETOUR / WALK_KMH * 60


def build_hexes():
    gj = json.loads((ROOT / "raw" / "nta2020.geojson").read_text())
    hexes = {}
    for f in gj["features"]:
        p = f["properties"]
        if p["ntatype"] != "0":  # residential NTAs only
            continue
        geom = shape(f["geometry"])
        polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        for poly in polys:
            outer = [(lat, lng) for lng, lat in poly.exterior.coords]
            holes = [[(lat, lng) for lng, lat in r.coords] for r in poly.interiors]
            for c in h3.polygon_to_cells(h3.LatLngPoly(outer, *holes), RES):
                hexes.setdefault(c, p["nta2020"])
    out = []
    for c in sorted(hexes):
        lat, lng = h3.cell_to_latlng(c)
        out.append({"h3": c, "nta": hexes[c], "lat": round(lat, 5), "lng": round(lng, 5)})
    return out


def load_gtfs():
    stops = pd.read_csv(GTFS / "stops.txt", dtype=str)
    parent = {r.stop_id: (r.parent_station if isinstance(r.parent_station, str) else r.stop_id) for r in stops.itertuples()}
    stations = stops[stops.location_type == "1"].copy()
    stations["stop_lat"] = stations.stop_lat.astype(float)
    stations["stop_lon"] = stations.stop_lon.astype(float)
    trips = pd.read_csv(GTFS / "trips.txt", dtype=str)
    st = pd.read_csv(GTFS / "stop_times.txt", dtype=str)
    st["t"] = st.departure_time.map(to_sec)
    st["stop_sequence"] = st.stop_sequence.astype(int)
    st["station"] = st.stop_id.map(parent)
    transfers = pd.read_csv(GTFS / "transfers.txt", dtype=str)
    return stations, trips, st, transfers


def station_matrix(day, stations, trips, st, transfers):
    cfg = DAYS[day]
    lo, hi = cfg["window"]
    tr = trips[trips.service_id.isin(cfg["services"])][["trip_id", "route_id"]]
    s = st.merge(tr, on="trip_id").sort_values(["trip_id", "stop_sequence"])
    # trips that are running during the window (any stop time inside, with slack)
    active = s[(s.t >= lo - 1800) & (s.t <= hi + 1800)].trip_id.unique()
    s = s[s.trip_id.isin(active)]

    nxt = s.groupby("trip_id").shift(-1)
    seg = pd.DataFrame({
        "route": s.route_id, "a": s.station, "b": nxt.station, "dt": (nxt.t - s.t) / 60.0, "t": s.t,
    }).dropna()
    seg = seg[(seg.dt >= 0) & (seg.dt < 30)]
    ride = seg.groupby(["route", "a", "b"]).dt.median()

    # headway per (route, station) from departures in window, both directions combined / 2
    dep = s[(s.t >= lo) & (s.t < hi)]
    counts = dep.groupby(["route_id", "station", "stop_id"]).size().groupby(["route_id", "station"]).max()
    window_min = (hi - lo) / 60
    wait = (window_min / counts / 2).clip(upper=MAX_WAIT)

    sid = list(stations.stop_id)
    sidx = {x: i for i, x in enumerate(sid)}
    nodes = {}

    def node(key):
        if key not in nodes:
            nodes[key] = len(nodes)
        return nodes[key]

    for x in sid:
        node(("S", x))  # street-level node for each station
    adj = defaultdict(list)
    for (route, a, b), dt in ride.items():
        adj[node(("R", a, route))].append((node(("R", b, route)), float(dt)))
    for (route, station), w in wait.items():
        rn = node(("R", station, route))
        sn = node(("S", station))
        adj[sn].append((rn, float(w)))  # board
        adj[rn].append((sn, 0.0))  # alight
    for r in transfers.itertuples():
        if r.from_stop_id != r.to_stop_id and r.from_stop_id in sidx and r.to_stop_id in sidx:
            adj[node(("S", r.from_stop_id))].append((node(("S", r.to_stop_id)), float(r.min_transfer_time or 180) / 60))

    n_st = len(sid)
    M = np.full((n_st, n_st), np.inf, dtype=np.float32)
    for i, x in enumerate(sid):
        dist = {node(("S", x)): 0.0}
        pq = [(0.0, node(("S", x)))]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, np.inf) or d > 150:
                continue
            for v, w in adj[u]:
                nd = d + w
                if nd < dist.get(v, np.inf):
                    dist[v] = nd
                    heapq.heappush(pq, (nd, v))
        for j, y in enumerate(sid):
            M[i, j] = dist.get(nodes[("S", y)], np.inf)
    routes_at = wait.reset_index().groupby("station").route_id.apply(lambda r: sorted(set(r))).to_dict()
    return M, routes_at


def hex_matrix(hexes, stations, S):
    hl = np.array([h["lat"] for h in hexes])
    hg = np.array([h["lng"] for h in hexes])
    sl = stations.stop_lat.values
    sg = stations.stop_lon.values
    W = walk_min(haversine_km(sl[:, None], sg[:, None], hl[None, :], hg[None, :])).astype(np.float32)  # stations x hexes
    W[W > MAX_ACCESS_MIN] = np.inf
    direct = walk_min(haversine_km(hl[:, None], hg[:, None], hl[None, :], hg[None, :])).astype(np.float32)
    N = len(hexes)
    out = np.empty((N, N), dtype=np.uint8)
    for o in range(N):
        access = W[:, o]
        near = np.where(np.isfinite(access))[0]
        if len(near):
            to_station = (access[near, None] + S[near, :]).min(axis=0)  # arrival at each station street node
            reach = np.where(np.isfinite(to_station))[0]
            t = (to_station[reach, None] + W[reach, :]).min(axis=0)
            t = np.minimum(t, direct[o])
        else:
            t = direct[o]
        out[o] = np.where(t > CAP, 255, np.round(t)).astype(np.uint8)
        if o % 200 == 0:
            print(f"  hex {o}/{N}", file=sys.stderr)
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    hexes = build_hexes()
    print(f"{len(hexes)} hexes", file=sys.stderr)
    stations, trips, st, transfers = load_gtfs()
    print(f"{len(stations)} stations", file=sys.stderr)
    routes_all = {}
    for day in DAYS:
        S, routes_at = station_matrix(day, stations, trips, st, transfers)
        print(f"{day}: station matrix finite share {np.isfinite(S).mean():.2f}", file=sys.stderr)
        if day == "weekday":
            routes_all = routes_at
        m = hex_matrix(hexes, stations, S)
        m.tofile(OUT / f"matrix_{day}.bin")
    (OUT / "hexes.json").write_text(json.dumps(hexes, separators=(",", ":")))
    (OUT / "stations.json").write_text(json.dumps([
        {"id": r.stop_id, "name": r.stop_name, "lat": r.stop_lat, "lng": r.stop_lon, "routes": routes_all.get(r.stop_id, [])}
        for r in stations.itertuples()
    ], separators=(",", ":")))


if __name__ == "__main__":
    main()
