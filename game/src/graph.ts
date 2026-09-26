// Street graph: nodes are intersections, edges are street segments with their real shapes.
// Everything is in local meters (x east, y north) so movement math is simple and exact.

const LAT0 = 40.78
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
const KY = 111_320
const LNG0 = -73.97

export const toXY = (lng: number, lat: number): [number, number] => [(lng - LNG0) * KX, (lat - LAT0) * KY]
export const toLngLat = (x: number, y: number): [number, number] => [x / KX + LNG0, y / KY + LAT0]

export type Edge = {
  a: number
  b: number
  len: number
  xs: Float64Array // polyline points, from a to b
  ys: Float64Array
  cum: Float64Array // distance from a at each point
}

export type Graph = {
  nx: Float64Array
  ny: Float64Array
  edges: Edge[]
  adj: { e: number; to: number }[][] // per node: outgoing edges
}

export async function loadGraph(url: string): Promise<Graph> {
  const raw: { nodes: [number, number][]; edges: [number, number, number, number[]][] } = await (await fetch(url)).json()
  const n = raw.nodes.length
  const nx = new Float64Array(n)
  const ny = new Float64Array(n)
  raw.nodes.forEach(([lng, lat], i) => ([nx[i], ny[i]] = toXY(lng, lat)))
  const adj: { e: number; to: number }[][] = Array.from({ length: n }, () => [])
  const edges: Edge[] = raw.edges.map(([a, b, , flat], ei) => {
    const m = flat.length / 2
    const xs = new Float64Array(m)
    const ys = new Float64Array(m)
    const cum = new Float64Array(m)
    for (let k = 0; k < m; k++) {
      ;[xs[k], ys[k]] = toXY(flat[2 * k], flat[2 * k + 1])
      if (k) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1])
    }
    adj[a].push({ e: ei, to: b })
    adj[b].push({ e: ei, to: a })
    return { a, b, len: cum[m - 1], xs, ys, cum }
  })
  return { nx, ny, edges, adj }
}

// Point at distance s from node a along an edge
export function pointOn(e: Edge, s: number): [number, number] {
  const t = Math.max(0, Math.min(e.len, s))
  let k = 1
  while (k < e.cum.length - 1 && e.cum[k] < t) k++
  const seg = e.cum[k] - e.cum[k - 1] || 1
  const f = (t - e.cum[k - 1]) / seg
  return [e.xs[k - 1] + (e.xs[k] - e.xs[k - 1]) * f, e.ys[k - 1] + (e.ys[k] - e.ys[k - 1]) * f]
}

// Unit direction leaving `node` along edge (looks ~10 m ahead so tiny kinks don't matter)
export function leaveDir(g: Graph, ei: number, node: number): [number, number] {
  const e = g.edges[ei]
  const fromA = e.a === node
  const p0 = fromA ? pointOn(e, 0) : pointOn(e, e.len)
  const p1 = fromA ? pointOn(e, Math.min(10, e.len)) : pointOn(e, Math.max(0, e.len - 10))
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const L = Math.hypot(dx, dy) || 1
  return [dx / L, dy / L]
}

export function nearestNode(g: Graph, x: number, y: number): number {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < g.nx.length; i++) {
    const d = (g.nx[i] - x) ** 2 + (g.ny[i] - y) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

// A* shortest path; returns node sequence from start to goal (inclusive), or null
export function astar(g: Graph, starts: { node: number; cost: number }[], goal: number): number[] | null {
  const n = g.nx.length
  const dist = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const heap: [number, number][] = [] // [f, node]
  const push = (f: number, v: number) => {
    heap.push([f, v])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  const h = (v: number) => Math.hypot(g.nx[v] - g.nx[goal], g.ny[v] - g.ny[goal])
  for (const s of starts) {
    if (s.cost < dist[s.node]) {
      dist[s.node] = s.cost
      push(s.cost + h(s.node), s.node)
    }
  }
  while (heap.length) {
    const [, u] = pop()
    if (u === goal) break
    for (const { e, to } of g.adj[u]) {
      const nd = dist[u] + g.edges[e].len
      if (nd < dist[to]) {
        dist[to] = nd
        prev[to] = u
        push(nd + h(to), to)
      }
    }
  }
  if (dist[goal] === Infinity) return null
  const path = [goal]
  while (prev[path[path.length - 1]] !== -1) path.push(prev[path[path.length - 1]])
  return path.reverse()
}

export function edgeBetween(g: Graph, u: number, v: number): number {
  let best = -1
  let bl = Infinity
  for (const { e, to } of g.adj[u]) if (to === v && g.edges[e].len < bl) { bl = g.edges[e].len; best = e }
  return best
}
