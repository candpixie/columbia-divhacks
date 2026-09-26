"""Build the walkable street graph for Manhattan from OpenStreetMap.

Input  (raw/cache, fetched from an Overpass mirror): mh_streets_{1,2,3}.json (streets), mh_cpark.json (park paths)
Output game/public/data/graph.json:
  { nodes: [[lng, lat], ...], edges: [[a, b, meters, [lng,lat,lng,lat,...]], ...] }
Nodes are intersections and dead ends; each edge is one street segment between them with its full shape.
Only the largest connected component is kept, so nothing can get stuck on an island of streets.
"""

import json
import math
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "raw" / "cache"
OUT = ROOT / "game" / "public" / "data"


def meters(a, b):
    kx = 111_320 * math.cos(math.radians(40.78))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 111_320)


def simplify(coords, tol=2.0):
    """Douglas-Peucker in meters, keeps both ends."""
    if len(coords) < 3:
        return coords
    kx = 111_320 * math.cos(math.radians(40.78))
    pts = [(x * kx, y * 111_320) for x, y in coords]

    def dp(i, j, keep):
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, bi = 0.0, -1
        for k in range(i + 1, j):
            d = abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / L
            if d > best:
                best, bi = d, k
        if best > tol:
            keep.add(bi)
            dp(i, bi, keep)
            dp(bi, j, keep)

    keep = {0, len(coords) - 1}
    dp(0, len(coords) - 1, keep)
    return [coords[k] for k in sorted(keep)]


def main():
    gj = json.loads((ROOT / "raw" / "nta2020.geojson").read_text())
    manhattan = unary_union([shape(f["geometry"]) for f in gj["features"] if f["properties"]["boroname"] == "Manhattan"]).buffer(0.0004)

    ways = []
    for f in ["mh_streets_1.json", "mh_streets_2.json", "mh_streets_3.json", "mh_cpark.json"]:
        ways += json.loads((CACHE / f).read_text())["elements"]
    seen, uniq = set(), []
    for w in ways:
        if w["id"] not in seen and w.get("geometry"):
            seen.add(w["id"])
            # Overpass "out geom" has no node ids: identify a node by its exact coordinates
            w["nodes"] = [(round(g["lon"], 7), round(g["lat"], 7)) for g in w["geometry"]]
            uniq.append(w)

    # keep only the parts of ways inside Manhattan
    coord = {}
    for w in uniq:
        for nid, g in zip(w["nodes"], w["geometry"]):
            coord[nid] = (g["lon"], g["lat"])
    ids = list(coord)
    tree_poly = manhattan
    from shapely import contains_xy
    xs = [coord[i][0] for i in ids]
    ys = [coord[i][1] for i in ids]
    inside = dict(zip(ids, contains_xy(tree_poly, xs, ys)))

    runs = []  # consecutive inside nodes of each way
    for w in uniq:
        cur = []
        for nid in w["nodes"]:
            if inside.get(nid):
                cur.append(nid)
            else:
                if len(cur) > 1:
                    runs.append(cur)
                cur = []
        if len(cur) > 1:
            runs.append(cur)

    uses = defaultdict(int)
    for r in runs:
        for k, nid in enumerate(r):
            uses[nid] += 2 if k in (0, len(r) - 1) else 1
    is_node = lambda nid: uses[nid] != 2  # intersection or dead end

    raw_edges = []
    for r in runs:
        start = 0
        for k in range(1, len(r)):
            if is_node(r[k]) or k == len(r) - 1:
                seg = r[start:k + 1]
                if seg[0] != seg[-1]:
                    raw_edges.append(seg)
                start = k

    # largest connected component
    adj = defaultdict(set)
    for seg in raw_edges:
        adj[seg[0]].add(seg[-1])
        adj[seg[-1]].add(seg[0])
    comp, best = {}, []
    for s in adj:
        if s in comp:
            continue
        stack, members = [s], []
        comp[s] = s
        while stack:
            u = stack.pop()
            members.append(u)
            for v in adj[u]:
                if v not in comp:
                    comp[v] = s
                    stack.append(v)
        if len(members) > len(best):
            best = members
    keep = set(best)

    index, nodes, edges = {}, [], []
    dedupe = set()
    for seg in raw_edges:
        a, b = seg[0], seg[-1]
        if a not in keep:
            continue
        for n in (a, b):
            if n not in index:
                index[n] = len(nodes)
                nodes.append([round(coord[n][0], 6), round(coord[n][1], 6)])
        line = simplify([coord[n] for n in seg])
        L = sum(meters(line[i], line[i + 1]) for i in range(len(line) - 1))
        key = (min(index[a], index[b]), max(index[a], index[b]), round(L))
        if L < 0.5 or key in dedupe:
            continue
        dedupe.add(key)
        flat = [round(v, 6) for p in line for v in p]
        edges.append([index[a], index[b], round(L, 1), flat])

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "graph.json").write_text(json.dumps({"nodes": nodes, "edges": edges}, separators=(",", ":")))
    total_km = sum(e[2] for e in edges) / 1000
    print(f"{len(uniq)} ways -> {len(nodes)} nodes, {len(edges)} edges, {total_km:.0f} km of walkable graph "
          f"(largest component {len(keep)} of {len(adj)} nodes)")


if __name__ == "__main__":
    main()
