// Arcade movement along streets: always on an edge, turning only at intersections (no wall clipping, by construction).
import { leaveDir, pointOn, type Graph } from './graph'

export type Mover = {
  e: number // current edge
  s: number // distance from the edge's node a
  dir: 1 | -1 // +1 = moving a -> b
  stopped: boolean
}

export const posOf = (g: Graph, m: Mover) => pointOn(g.edges[m.e], m.s)

export const aheadNode = (g: Graph, m: Mover) => (m.dir > 0 ? g.edges[m.e].b : g.edges[m.e].a)
export const behindNode = (g: Graph, m: Mover) => (m.dir > 0 ? g.edges[m.e].a : g.edges[m.e].b)

// Current heading as a unit vector
export function heading(g: Graph, m: Mover): [number, number] {
  const e = g.edges[m.e]
  const p0 = pointOn(e, m.s)
  const p1 = pointOn(e, m.s + m.dir * 6)
  let dx = p1[0] - p0[0]
  let dy = p1[1] - p0[1]
  if (!dx && !dy) {
    const q = pointOn(e, m.s - m.dir * 6)
    dx = p0[0] - q[0]
    dy = p0[1] - q[1]
  }
  const L = Math.hypot(dx, dy) || 1
  return [dx / L, dy / L]
}

export function startAt(g: Graph, node: number): Mover {
  const first = g.adj[node][0]
  const e = g.edges[first.e]
  return { e: first.e, s: e.a === node ? 0 : e.len, dir: e.a === node ? 1 : -1, stopped: true }
}

// Pick the outgoing edge at `node` best matching `want`; returns -1 if nothing is close enough
function pickEdge(g: Graph, node: number, want: [number, number], cameFrom: number, minDot: number): number {
  let best = -1
  let bd = minDot
  for (const { e } of g.adj[node]) {
    if (e === cameFrom && g.adj[node].length > 1) continue
    const [dx, dy] = leaveDir(g, e, node)
    const d = dx * want[0] + dy * want[1]
    if (d > bd) {
      bd = d
      best = e
    }
  }
  return best
}

function enter(g: Graph, m: Mover, node: number, e: number, carry: number) {
  const E = g.edges[e]
  m.e = e
  m.dir = E.a === node ? 1 : -1
  m.s = m.dir > 0 ? Math.min(carry, E.len) : Math.max(E.len - carry, 0)
  m.stopped = false
}

// Player movement: `want` is the held direction (null = keep going straight when possible)
export function stepGhost(g: Graph, m: Mover, want: [number, number] | null, dist: number, onEdge: (e: number) => void) {
  const h = heading(g, m)
  if (want && want[0] * h[0] + want[1] * h[1] < -0.7) {
    m.dir = m.dir > 0 ? -1 : 1 // reverse on the spot, like the arcade
    m.stopped = false
  }
  if (m.stopped) {
    if (!want) return
    const node = m.s <= 0.01 ? g.edges[m.e].a : m.s >= g.edges[m.e].len - 0.01 ? g.edges[m.e].b : -1
    if (node < 0) { m.stopped = false } else {
      const e = pickEdge(g, node, want, -1, 0.35)
      if (e < 0) return
      enter(g, m, node, e, 0)
    }
  }
  let left = dist
  for (let guard = 0; guard < 24 && left > 0; guard++) {
    const E = g.edges[m.e]
    const toEnd = m.dir > 0 ? E.len - m.s : m.s
    if (left < toEnd) {
      m.s += m.dir * left
      onEdge(m.e)
      return
    }
    left -= toEnd
    onEdge(m.e)
    const node = m.dir > 0 ? E.b : E.a
    const incoming = heading(g, { ...m, s: m.dir > 0 ? E.len : 0 })
    let next = want ? pickEdge(g, node, want, m.e, 0.35) : -1
    if (next < 0) next = pickEdge(g, node, incoming, m.e, 0.55) // keep going straight if possible
    if (next < 0) {
      m.s = m.dir > 0 ? E.len : 0
      m.stopped = true // wait at the corner for a direction
      return
    }
    enter(g, m, node, next, 0)
  }
}

// Chaser movement: follow a node path; returns false when the path is used up
export function stepChaser(g: Graph, m: Mover, path: number[], dist: number): void {
  let left = dist
  for (let guard = 0; guard < 24 && left > 0; guard++) {
    const E = g.edges[m.e]
    const toEnd = m.dir > 0 ? E.len - m.s : m.s
    if (left < toEnd) {
      m.s += m.dir * left
      return
    }
    left -= toEnd
    const node = m.dir > 0 ? E.b : E.a
    m.s = m.dir > 0 ? E.len : 0
    const k = path.indexOf(node)
    const nextNode = k >= 0 && k + 1 < path.length ? path[k + 1] : -1
    if (nextNode < 0) return
    let e = -1
    let bl = Infinity
    for (const a of g.adj[node]) if (a.to === nextNode && g.edges[a.e].len < bl) { bl = g.edges[a.e].len; e = a.e }
    if (e < 0) return
    enter(g, m, node, e, 0)
  }
}
