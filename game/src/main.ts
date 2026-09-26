import './style.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { CONFIG } from './config'
import { astar, loadGraph, nearestNode, toLngLat, toXY, type Graph } from './graph'
import { aheadNode, behindNode, heading, posOf, startAt, stepChaser, stepGhost, type Mover } from './mover'

setWorkerUrl(workerUrl)

type Landmark = { id: string; name: string; lat: number; lng: number; points: number; area: string; fact: string; x: number; y: number }
type Target = { landmark: string; difficulty: number; clue: string; hint: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const fx = $<HTMLCanvasElement>('fx')
const ctx = fx.getContext('2d')!
const mini = $<HTMLCanvasElement>('minimap')
const mctx = mini.getContext('2d')!

// ---------- analytics hook (PRD: log run events) ----------
function track(event: string, props: Record<string, unknown> = {}) {
  const e = { event, t: Date.now(), ...props }
  ;(window as unknown as { __events?: unknown[] }).__events ??= []
  ;(window as unknown as { __events: unknown[] }).__events.push(e)
  console.debug('[track]', e)
}

// ---------- map ----------
const map = new MapLibreMap({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [-73.985, 40.758],
  zoom: CONFIG.zoom,
  minZoom: CONFIG.minZoom,
  maxZoom: CONFIG.maxZoom,
  interactive: true,
  dragPan: false,
  dragRotate: false,
  keyboard: false,
  doubleClickZoom: false,
  touchZoomRotate: false,
  touchPitch: false,
  attributionControl: { compact: true },
})

// ---------- state ----------
let g: Graph
let landmarks: Landmark[] = []
let targets: Target[] = []
let state: 'title' | 'playing' | 'over' = 'title'
let ghost: Mover
let chaser: Mover
let chaserPath: number[] = []
let chaserSpeed: number = CONFIG.chaserStartSpeed
let want: [number, number] | null = null
let target: Target
let targetLm: Landmark
let visitedEdges = new Set<number>()
let visitedLm = new Set<string>()
let hints: string[] = []
let lmPoints = 0
let t0 = 0
let lastReplan = 0
let history: { t: number; node: number }[] = []
let trail: [number, number][] = []
let toastTimer = 0
let nextBeep = 0
let audio: AudioContext | null = null

// ---------- controls ----------
const DIRS: Record<string, [number, number]> = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }
const KEYS: Record<string, string> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
addEventListener('keydown', (e) => {
  const d = KEYS[e.code]
  if (d) {
    e.preventDefault()
    want = DIRS[d]
    ensureAudio()
  } else if ((e.code === 'Space' || e.code === 'Enter') && state !== 'playing' && !($<HTMLButtonElement>('start').disabled)) {
    e.preventDefault()
    startRun()
  }
})
let swipe: { x: number; y: number } | null = null
fx.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; ensureAudio() })
fx.addEventListener('pointerup', (e) => {
  if (!swipe) return
  const dx = e.clientX - swipe.x
  const dy = e.clientY - swipe.y
  swipe = null
  if (Math.hypot(dx, dy) < 18) return
  want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left) : dy > 0 ? DIRS.down : DIRS.up
})
document.querySelectorAll<HTMLButtonElement>('#dpad button').forEach((b) =>
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); want = DIRS[b.dataset.d!]; ensureAudio() }),
)

function ensureAudio() {
  if (!audio) try { audio = new AudioContext() } catch { /* no audio */ }
}
function beep(freq: number, dur = 0.08, vol = 0.05) {
  if (!audio) return
  const o = audio.createOscillator()
  const v = audio.createGain()
  o.type = 'square'
  o.frequency.value = freq
  v.gain.value = vol
  v.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur)
  o.connect(v).connect(audio.destination)
  o.start()
  o.stop(audio.currentTime + dur)
}

// ---------- helpers ----------
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const rand = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
function compass(dx: number, dy: number) {
  const a = (Math.atan2(dx, dy) * 180) / Math.PI
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((a + 360) % 360) / 45) % 8]
}
function band(lat: number) {
  if (lat < 40.73) return 'Downtown, below 14th Street'
  if (lat < 40.765) return 'Midtown, between 14th and 59th Streets'
  if (lat < 40.8) return 'between 59th and 110th Streets'
  return 'Upper Manhattan, above 110th Street'
}

// ---------- minimap ----------
const MB = { w: -74.022, e: -73.906, s: 40.698, n: 40.882 }
const [bx0, by0] = toXY(MB.w, MB.s)
const [bx1, by1] = toXY(MB.e, MB.n)
const mm = (x: number, y: number, W: number, H: number): [number, number] => [((x - bx0) / (bx1 - bx0)) * W, H - ((y - by0) / (by1 - by0)) * H]
let mmBase: HTMLCanvasElement

function drawEdges(c: CanvasRenderingContext2D, ids: Iterable<number>, W: number, H: number) {
  c.beginPath()
  for (const id of ids) {
    const e = g.edges[id]
    for (let k = 0; k < e.xs.length; k++) {
      const [px, py] = mm(e.xs[k], e.ys[k], W, H)
      if (k) c.lineTo(px, py)
      else c.moveTo(px, py)
    }
  }
  c.stroke()
}
function buildMinimapBase() {
  mmBase = document.createElement('canvas')
  mmBase.width = mini.width
  mmBase.height = mini.height
  const c = mmBase.getContext('2d')!
  c.fillStyle = 'rgba(0,0,0,0.55)'
  c.fillRect(0, 0, mmBase.width, mmBase.height)
  c.strokeStyle = 'rgba(255,255,255,0.16)'
  c.lineWidth = 0.6
  drawEdges(c, g.edges.keys(), mini.width, mini.height)
}
let mmVisited: HTMLCanvasElement
function markVisited(id: number) {
  if (visitedEdges.has(id)) return
  visitedEdges.add(id)
  const c = mmVisited.getContext('2d')!
  c.strokeStyle = 'rgba(125,249,255,0.9)'
  c.lineWidth = 1.2
  drawEdges(c, [id], mini.width, mini.height)
}
function drawMinimap(warn: boolean) {
  mctx.clearRect(0, 0, mini.width, mini.height)
  mctx.drawImage(mmBase, 0, 0)
  mctx.drawImage(mmVisited, 0, 0)
  for (const l of landmarks) if (visitedLm.has(l.id)) {
    const [px, py] = mm(l.x, l.y, mini.width, mini.height)
    mctx.fillStyle = '#ffd166'
    mctx.fillRect(px - 1.5, py - 1.5, 3, 3)
  }
  const [gx, gy] = mm(...posOf(g, ghost), mini.width, mini.height)
  mctx.fillStyle = '#7df9ff'
  mctx.beginPath(); mctx.arc(gx, gy, 3, 0, 7); mctx.fill()
  if (warn) {
    const [cx, cy] = mm(...posOf(g, chaser), mini.width, mini.height)
    mctx.fillStyle = '#ff3b6b'
    mctx.beginPath(); mctx.arc(cx, cy, 3, 0, 7); mctx.fill()
  }
}

// ---------- run setup ----------
function startRun() {
  ensureAudio()
  target = rand(targets)
  targetLm = landmarks.find((l) => l.id === target.landmark)!
  const far = landmarks.filter((l) => l.id !== targetLm.id && dist([l.x, l.y], [targetLm.x, targetLm.y]) > 2500)
  const startLm = rand(far.length ? far : landmarks)
  ghost = startAt(g, nearestNode(g, startLm.x, startLm.y))
  const gp = posOf(g, ghost)
  let spawn = -1
  for (let tries = 0; tries < 400 && spawn < 0; tries++) {
    const n = Math.floor(Math.random() * g.nx.length)
    const d = Math.hypot(g.nx[n] - gp[0], g.ny[n] - gp[1])
    if (d > CONFIG.chaserSpawnMinM && d < CONFIG.chaserSpawnMaxM) spawn = n
  }
  chaser = startAt(g, spawn < 0 ? 0 : spawn)
  chaserPath = []
  chaserSpeed = CONFIG.chaserStartSpeed
  want = null
  visitedEdges = new Set()
  visitedLm = new Set([startLm.id]) // no free points for where you start
  hints = []
  lmPoints = 0
  history = []
  trail = [gp]
  mmVisited = document.createElement('canvas')
  mmVisited.width = mini.width
  mmVisited.height = mini.height
  t0 = performance.now()
  lastReplan = 0
  state = 'playing'
  $('title').hidden = true
  $('over').hidden = true
  $('hud').hidden = false
  $('dpad').classList.add('on')
  $('clue').textContent = target.clue
  renderHints()
  toast(`You start at <b>${startLm.name}</b>. ${CONFIG.chaserName[0].toUpperCase() + CONFIG.chaserName.slice(1)} is somewhere nearby. Pick a direction.`, 4500)
  map.jumpTo({ center: toLngLat(...gp), zoom: CONFIG.zoom })
  track('run_start', { target: targetLm.id, start: startLm.id })
}

function renderHints() {
  const ol = $<HTMLOListElement>('hints')
  ol.replaceChildren(...hints.map((h) => Object.assign(document.createElement('li'), { textContent: h })))
}

function revealHint() {
  if (hints.length >= CONFIG.maxHints) return null
  const gp = posOf(g, ghost)
  const dx = targetLm.x - gp[0]
  const dy = targetLm.y - gp[1]
  const km = Math.max(0.5, Math.round((Math.hypot(dx, dy) / 1000) * 2) / 2)
  const all = [
    `It's ${band(targetLm.lat)}.`,
    `From here, it's about ${km} km to the ${compass(dx, dy)}.`,
    `It's in ${targetLm.area}.`,
    target.hint,
  ]
  const h = all[hints.length]
  hints.push(h)
  renderHints()
  track('hint_shown', { n: hints.length })
  return h
}

function toast(html: string, ms = 4000) {
  const el = $('toast')
  el.innerHTML = html
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (el.hidden = true), ms)
}

// ---------- end ----------
function endRun(found: boolean) {
  state = 'over'
  const secs = (performance.now() - t0) / 1000
  const timePts = Math.round(secs * CONFIG.pointsPerSecond)
  const bonus = found ? CONFIG.targetBonusBase + CONFIG.targetBonusPerUnusedHint * (CONFIG.maxHints - hints.length) : 0
  const total = lmPoints + timePts + bonus
  track(found ? 'target_found' : 'caught', { secs, total, hints: hints.length, landmarks: visitedLm.size - 1 })
  if (found) { beep(784, 0.12, 0.06); setTimeout(() => beep(1046, 0.25, 0.06), 130) } else beep(110, 0.5, 0.08)

  const titleEl = $('over-title')
  titleEl.textContent = found ? 'You found it!' : `Caught by ${CONFIG.chaserName}!`
  titleEl.className = found ? '' : 'lose'
  $('over-sub').innerHTML = `The secret place was <b>${targetLm.name}</b> (${targetLm.area}). ${targetLm.fact}`
  const rows: [string, string][] = [
    ['Landmarks', `${lmPoints}`],
    ['Time survived', `${fmtTime(secs)} · ${timePts}`],
    ['Target bonus', found ? `${bonus} (${hints.length} hints used)` : '0'],
    ['Score', `${total}`],
  ]
  $('breakdown').replaceChildren(...rows.map(([a, b]) => {
    const tr = document.createElement('tr')
    tr.append(Object.assign(document.createElement('td'), { textContent: a }), Object.assign(document.createElement('td'), { textContent: b }))
    return tr
  }))
  const names = landmarks.filter((l) => visitedLm.has(l.id) && l !== targetLm).map((l) => l.name)
  $('visited').textContent = names.slice(1).join(' · ') || 'None this time'

  // high scores (per city, local only)
  const key = 'manhattan-haunt:scores'
  let scores: { score: number; found: boolean; target: string; at: number }[] = []
  try { scores = JSON.parse(localStorage.getItem(key) ?? '[]') } catch { /* ignore */ }
  scores.push({ score: total, found, target: targetLm.name, at: Date.now() })
  scores.sort((a, b) => b.score - a.score)
  scores = scores.slice(0, 5)
  try { localStorage.setItem(key, JSON.stringify(scores)) } catch { /* private mode */ }
  $('scores').replaceChildren(...scores.map((s) => Object.assign(document.createElement('li'), { textContent: `${s.score} · ${s.found ? 'found' : 'caught'} · ${s.target}` })))

  // route map
  const rc = $<HTMLCanvasElement>('route')
  const r = rc.getContext('2d')!
  r.fillStyle = '#000'
  r.fillRect(0, 0, rc.width, rc.height)
  r.strokeStyle = 'rgba(255,255,255,0.08)'
  r.lineWidth = 0.6
  drawEdges(r, g.edges.keys(), rc.width, rc.height)
  r.strokeStyle = '#7df9ff'
  r.lineWidth = 2
  r.beginPath()
  trail.forEach(([x, y], i) => { const [px, py] = mm(x, y, rc.width, rc.height); if (i) r.lineTo(px, py); else r.moveTo(px, py) })
  r.stroke()
  const [tx, ty] = mm(targetLm.x, targetLm.y, rc.width, rc.height)
  star(r, tx, ty, 8, '#ffd166')
  r.fillStyle = '#ffd166'
  r.font = '11px Inter'
  r.fillText(targetLm.name, Math.min(tx + 10, rc.width - 110), ty + 4)

  $('hud').hidden = true
  $('over').hidden = false
  $('vignette').style.boxShadow = 'none'
  $('warn').hidden = true
}

// ---------- drawing ----------
function resize() {
  const dpr = devicePixelRatio || 1
  fx.width = innerWidth * dpr
  fx.height = innerHeight * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
addEventListener('resize', resize)
resize()

const screen = (x: number, y: number) => {
  const p = map.project(toLngLat(x, y))
  return [p.x, p.y] as [number, number]
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  c.fillStyle = color
  c.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2
    const rr = i % 2 ? r * 0.45 : r
    c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a))
  }
  c.closePath()
  c.fill()
}

function drawGhost(x: number, y: number, h: [number, number], t: number) {
  const r = 13
  ctx.save()
  ctx.shadowColor = '#7df9ff'
  ctx.shadowBlur = 16
  ctx.fillStyle = '#7df9ff'
  ctx.beginPath()
  ctx.arc(x, y - 2, r, Math.PI, 0)
  const feet = 4
  const bottom = y + r - 2
  ctx.lineTo(x + r, bottom)
  for (let i = feet; i > 0; i--) {
    const fx0 = x - r + ((2 * r) / feet) * (i - 0.5)
    ctx.lineTo(fx0, bottom - 4 - Math.sin(t / 90 + i) * 2)
    ctx.lineTo(x - r + ((2 * r) / feet) * (i - 1), bottom)
  }
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  // eyes look where you're going (north is up on screen)
  for (const ex of [-5, 5]) {
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.ellipse(x + ex, y - 4, 4, 5, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#10204a'
    ctx.beginPath(); ctx.arc(x + ex + h[0] * 2, y - 4 - h[1] * 2.5, 2.2, 0, 7); ctx.fill()
  }
  ctx.restore()
}

// Original chaser design: a spiky, pulsing blob with a zigzag mouth (not a Pac-Man likeness)
function drawChaser(x: number, y: number, t: number) {
  const r = 15 + Math.sin(t / 120) * 1.5
  ctx.save()
  ctx.shadowColor = '#ff3b6b'
  ctx.shadowBlur = 18
  ctx.fillStyle = '#ff3b6b'
  ctx.beginPath()
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + t / 900
    const rr = i % 2 ? r * 0.78 : r
    ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a))
  }
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.arc(x - 5, y - 4, 3.2, 0, 7); ctx.arc(x + 5, y - 4, 3.2, 0, 7); ctx.fill()
  ctx.fillStyle = '#1a0610'
  ctx.beginPath(); ctx.arc(x - 5, y - 3.5, 1.6, 0, 7); ctx.arc(x + 5, y - 3.5, 1.6, 0, 7); ctx.fill()
  ctx.strokeStyle = '#1a0610'
  ctx.lineWidth = 2
  ctx.beginPath()
  const open = 2 + Math.abs(Math.sin(t / 100)) * 3
  for (let i = 0; i <= 6; i++) ctx.lineTo(x - 7 + i * 2.33, y + 4 + (i % 2 ? open : 0))
  ctx.stroke()
  ctx.restore()
}

function draw(t: number, cd: number) {
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  const b = map.getBounds()
  const inView = (x: number, y: number) => { const [lng, lat] = toLngLat(x, y); return lng > b.getWest() - 0.002 && lng < b.getEast() + 0.002 && lat > b.getSouth() - 0.002 && lat < b.getNorth() + 0.002 }

  // explored streets
  ctx.strokeStyle = 'rgba(125,249,255,0.28)'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const id of visitedEdges) {
    const e = g.edges[id]
    if (!inView(e.xs[0], e.ys[0]) && !inView(e.xs[e.xs.length - 1], e.ys[e.ys.length - 1])) continue
    for (let k = 0; k < e.xs.length; k++) {
      const [px, py] = screen(e.xs[k], e.ys[k])
      if (k) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
  }
  ctx.stroke()

  // landmarks
  ctx.font = '600 12px Inter'
  ctx.textAlign = 'center'
  for (const l of landmarks) {
    if (!inView(l.x, l.y)) continue
    const [px, py] = screen(l.x, l.y)
    const seen = visitedLm.has(l.id)
    star(ctx, px, py, seen ? 7 : 10 + Math.sin(t / 250) * 1.5, seen ? 'rgba(255,209,102,0.35)' : '#ffd166')
    ctx.fillStyle = seen ? 'rgba(255,255,255,0.4)' : '#fff'
    ctx.fillText(l.name, px, py - 16)
  }

  const gp = posOf(g, ghost)
  const cp = posOf(g, chaser)
  const [gx, gy] = screen(...gp)
  const [cx, cy] = screen(...cp)
  const onScreen = cx > 0 && cx < innerWidth && cy > 0 && cy < innerHeight
  if (onScreen) drawChaser(cx, cy, t)
  drawGhost(gx, gy, heading(g, ghost), t)

  // edge-of-screen warning
  const warn = cd < CONFIG.warnRadiusM
  if (warn && !onScreen) {
    const ang = Math.atan2(cy - gy, cx - gx)
    const m = 34
    const ex = Math.max(m, Math.min(innerWidth - m, gx + Math.cos(ang) * 2000))
    const ey = Math.max(m + 60, Math.min(innerHeight - m, gy + Math.sin(ang) * 2000))
    ctx.save()
    ctx.translate(ex, ey)
    ctx.rotate(ang)
    ctx.fillStyle = '#ff3b6b'
    ctx.shadowColor = '#ff3b6b'
    ctx.shadowBlur = 14
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill()
    ctx.restore()
  }
  const k = warn ? 1 - cd / CONFIG.warnRadiusM : 0
  $('vignette').style.boxShadow = k ? `inset 0 0 ${60 + k * 90}px ${k * 40}px rgba(255,59,107,${0.25 + k * 0.4})` : 'none'
  const w = $('warn')
  w.hidden = !warn
  if (warn) w.textContent = `${CONFIG.chaserName.toUpperCase()} · ${Math.round(cd)} M`
  drawMinimap(warn)
}

// ---------- loop ----------
let last = performance.now()
let hudAt = 0
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000) // big enough for slow devices; movement stays on the graph
  last = now
  if (state === 'playing') {
    stepGhost(g, ghost, want, CONFIG.ghostSpeed * dt, markVisited)
    const gp = posOf(g, ghost)
    if (dist(gp, trail[trail.length - 1]) > 25) trail.push(gp)
    history.push({ t: now, node: aheadNode(g, ghost) })
    while (history.length > 2 && now - history[1].t > CONFIG.chaserReactionMs) history.shift()

    const secs = (now - t0) / 1000
    chaserSpeed = Math.min(CONFIG.chaserMaxSpeed, CONFIG.chaserStartSpeed + CONFIG.chaserSpeedGainPerSec * secs)
    if (now - lastReplan > CONFIG.chaserReplanMs) {
      lastReplan = now
      const goal = history[0].node
      const E = g.edges[chaser.e]
      const ahead = aheadNode(g, chaser)
      const behind = behindNode(g, chaser)
      const toAhead = chaser.dir > 0 ? E.len - chaser.s : chaser.s
      const path = astar(g, [{ node: ahead, cost: toAhead }, { node: behind, cost: E.len - toAhead }], goal)
      if (path) {
        if (path[0] === behind && behind !== ahead) chaser.dir = chaser.dir > 0 ? -1 : 1
        chaserPath = path
      }
    }
    // same street: go straight for the ghost
    if (chaser.e === ghost.e) {
      const sign = ghost.s > chaser.s ? 1 : -1
      chaser.dir = sign
    }
    stepChaser(g, chaser, chaserPath, chaserSpeed * dt)
    const cp = posOf(g, chaser)
    const cd = dist(gp, cp)

    if (cd < CONFIG.catchRadiusM) { endRun(false) } else {
      for (const l of landmarks) {
        if (visitedLm.has(l.id) || l === targetLm) continue
        if (dist(gp, [l.x, l.y]) < CONFIG.landmarkRadiusM) {
          visitedLm.add(l.id)
          lmPoints += l.points
          const h = revealHint()
          beep(988, 0.08, 0.05); setTimeout(() => beep(1318, 0.12, 0.05), 90)
          toast(`<b>+${l.points} · ${l.name}</b><br>${l.fact}${h ? `<br><br>🔎 New hint: ${h}` : ''}`, 6000)
          track('landmark_visit', { id: l.id })
        }
      }
      if (dist(gp, [targetLm.x, targetLm.y]) < CONFIG.targetRadiusM) endRun(true)
    }

    if (state === 'playing') {
      if (cd < CONFIG.warnRadiusM && now > nextBeep) {
        beep(660 + (1 - cd / CONFIG.warnRadiusM) * 440, 0.05, 0.035)
        nextBeep = now + 150 + (cd / CONFIG.warnRadiusM) * 750
      }
      map.jumpTo({ center: toLngLat(...gp) })
      draw(now, cd)
      if (now - hudAt > 200) {
        hudAt = now
        $('score').textContent = String(lmPoints + Math.round(secs * CONFIG.pointsPerSecond))
        $('time').textContent = fmtTime(secs)
        $('lm').textContent = String(visitedLm.size - 1)
      }
    }
  }
  requestAnimationFrame(frame)
}

// debug hook for automated playtests
;(window as unknown as { __dbg: () => unknown }).__dbg = () => state === 'playing' ? {
  ghost: posOf(g, ghost).map(Math.round), chaser: posOf(g, chaser).map(Math.round),
  chaserEdge: chaser.e, chaserS: Math.round(chaser.s), chaserDir: chaser.dir, pathLen: chaserPath.length,
  pathHead: chaserPath.slice(0, 3), ahead: aheadNode(g, chaser), speed: Math.round(chaserSpeed), ghostStopped: ghost.stopped,
} : state

// ---------- boot ----------
document.title = CONFIG.title
$('title-text').textContent = CONFIG.title
$('tagline').textContent = CONFIG.tagline
const startBtn = $<HTMLButtonElement>('start')
startBtn.disabled = true
startBtn.addEventListener('click', startRun)
$('again').addEventListener('click', startRun)

Promise.all([loadGraph('/data/graph.json'), fetch('/data/places.json').then((r) => r.json())]).then(([graph, places]) => {
  g = graph
  landmarks = places.landmarks.map((l: Omit<Landmark, 'x' | 'y'>) => {
    const [x, y] = toXY(l.lng, l.lat)
    return { ...l, x, y }
  })
  targets = places.targets
  buildMinimapBase()
  startBtn.disabled = false
  $('loading').textContent = `${g.edges.length.toLocaleString()} streets loaded · press Space or tap Start`
  requestAnimationFrame(frame)
}).catch((e) => { $('loading').textContent = `Couldn't load the map data: ${e.message}` })
