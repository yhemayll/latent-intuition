// How far you can walk from a point, and what that walk reaches: buildings and residents.
// Everything here works in local metres from the kit centre: x to the east, y to the north.
import polygonClipping from 'polygon-clipping'

export const METRES_PER_MINUTE = 80 // 4.8 km/h
export const BAND_M = 25 // band on each side of a reached street
export const MINUTES = [5, 10, 15]
export const MAX_START_M = 100 // farthest a click may be from a walkable node

const ARC_STEPS = 8 // points on each round end of a band

// Longitude and latitude in degrees to metres, flat around the kit centre.
// The kit is 2 km across, so the error of a flat projection is far below a metre.
export function makeProjection([lon0, lat0]) {
  const phi = (lat0 * Math.PI) / 180
  const mPerLat = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)
  const mPerLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)
  return ([lon, lat]) => [(lon - lon0) * mPerLon, (lat - lat0) * mPerLat]
}

// Turns the raw kit files into what the app uses: projected, with lookups ready.
export function prepare({ kit, buildings, graph, zensus }) {
  const project = makeProjection(kit.center)
  const projectRings = (rings) => rings.map((r) => r.map(project))

  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const nodes = graph.nodes.map((n) => {
    const [x, y] = project([n.lon, n.lat])
    return { id: n.id, x, y, links: [] }
  })

  const edges = graph.edges
    .filter((e) => e.walkable)
    .map((e) => {
      const pts = e.coords.map(project)
      const cum = [0]
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
      return { id: e.id, a: nodeIndex.get(e.from), b: nodeIndex.get(e.to), length: e.length, pts, cum }
    })
  edges.forEach((e, i) => {
    nodes[e.a].links.push(i)
    nodes[e.b].links.push(i)
  })

  const houses = buildings.features.map((f) => {
    const rings = projectRings(f.geometry.coordinates)
    return {
      id: f.properties.id,
      use: f.properties.use ?? 'undefined',
      height: f.properties.height,
      rings,
      bbox: bboxOf(rings[0]),
    }
  })

  const cells = zensus.features.map((f) => {
    const rings = projectRings(f.geometry.coordinates)
    return {
      id: f.properties.id,
      population: f.properties.population,
      rings,
      area: polygonArea(rings),
      bbox: bboxOf(rings[0]),
    }
  })

  const [w, s, e, n] = kit.bbox
  const [x0, y0] = project([w, s])
  const [x1, y1] = project([e, n])

  return { kit, project, nodes, edges, buildings: houses, cells, bounds: { x0, y0, x1, y1 } }
}

// The full calculation for one click at (x, y).
export function computeReach(city, x, y) {
  const start = nearestNode(city, x, y)
  if (!start || start.distance > MAX_START_M) {
    return { ok: false, click: [x, y], distance: start ? start.distance : Infinity }
  }

  const dist = shortestPaths(city, start.index)
  // The areas are nested, so each one is the smaller area plus the streets that are new to it.
  let prev = { area: [], whole: new Set() }
  const bands = MINUTES.map((minutes) => {
    const { pieces, whole } = reachedPieces(city, dist, minutes * METRES_PER_MINUTE)
    const fresh = pieces.filter((p) => !prev.whole.has(p.edge))
    const area = bandArea(fresh.map((p) => p.pts), prev.area)
    prev = { area, whole }
    return { minutes, pieces: pieces.map((p) => p.pts), area }
  })

  const buildingBand = touchedBuildings(city, bands)
  bands.forEach((band, k) => {
    let count = 0
    for (const b of buildingBand) if (b >= 0 && b <= k) count++
    band.buildings = count
    Object.assign(band, countResidents(city, band.area))
  })

  const node = city.nodes[start.index]
  return { ok: true, click: [x, y], start: [node.x, node.y], distance: start.distance, bands, buildingBand }
}

function nearestNode(city, x, y) {
  let best = null
  city.nodes.forEach((n, index) => {
    if (n.links.length === 0) return // not on a walkable edge
    const d = Math.hypot(n.x - x, n.y - y)
    if (!best || d < best.distance) best = { index, distance: d }
  })
  return best
}

// Walking distance in metres from the start to every node (Dijkstra).
function shortestPaths(city, start) {
  const { nodes, edges } = city
  const dist = new Float64Array(nodes.length).fill(Infinity)
  const done = new Uint8Array(nodes.length)
  dist[start] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0) break
    done[u] = 1
    for (const ei of nodes[u].links) {
      const e = edges[ei]
      const v = e.a === u ? e.b : e.a
      const d = dist[u] + e.length
      if (d < dist[v]) dist[v] = d
    }
  }
  return dist
}

// The street lines reached within `budget` metres, including the reachable part of the last edge.
// An edge can be walked into from both ends, so it may come back as two pieces.
function reachedPieces(city, dist, budget) {
  const pieces = []
  const whole = new Set() // edges walked end to end
  city.edges.forEach((e, i) => {
    const fromA = clamp(budget - dist[e.a], 0, e.length)
    const fromB = clamp(budget - dist[e.b], 0, e.length)
    if (fromA + fromB >= e.length) {
      pieces.push({ edge: i, pts: e.pts })
      whole.add(i)
    } else {
      if (fromA > 0) pieces.push({ edge: i, pts: cutLine(e, 0, fromA) })
      if (fromB > 0) pieces.push({ edge: i, pts: cutLine(e, e.length - fromB, e.length) })
    }
  })
  return { pieces, whole }
}

// The part of an edge between two distances along it, measured in the edge's own `length`.
function cutLine(e, from, to) {
  const total = e.cum[e.cum.length - 1]
  const s = (from / e.length) * total
  const t = (to / e.length) * total
  const out = [pointAt(e, s)]
  for (let i = 1; i < e.pts.length - 1; i++) if (e.cum[i] > s && e.cum[i] < t) out.push(e.pts[i])
  out.push(pointAt(e, t))
  return out
}

function pointAt(e, s) {
  for (let i = 1; i < e.pts.length; i++) {
    if (s <= e.cum[i] || i === e.pts.length - 1) {
      const seg = e.cum[i] - e.cum[i - 1]
      const f = seg > 0 ? clamp((s - e.cum[i - 1]) / seg, 0, 1) : 0
      const [p, q] = [e.pts[i - 1], e.pts[i]]
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]
    }
  }
  return e.pts[0]
}

// The reached streets with a band of BAND_M on each side, joined into one shape (a MultiPolygon),
// together with an area already worked out.
function bandArea(lines, base) {
  const shapes = []
  for (const line of lines) for (let i = 1; i < line.length; i++) shapes.push([capsule(line[i - 1], line[i], BAND_M)])
  if (shapes.length === 0) return base
  return polygonClipping.union(base, ...shapes)
}

// A segment widened by r on each side, with round ends.
function capsule(p, q, r) {
  const angle = Math.atan2(q[1] - p[1], q[0] - p[0])
  const ring = []
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = angle - Math.PI / 2 + (Math.PI * i) / ARC_STEPS
    ring.push([q[0] + r * Math.cos(a), q[1] + r * Math.sin(a)])
  }
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = angle + Math.PI / 2 + (Math.PI * i) / ARC_STEPS
    ring.push([p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)])
  }
  ring.push(ring[0])
  return ring
}

// For each building, the first band whose area it touches (0 = 5 min), or -1.
// A building touches the area when it comes within BAND_M of a reached street line.
function touchedBuildings(city, bands) {
  const result = new Int8Array(city.buildings.length).fill(-1)
  bands.forEach((band, k) => {
    const grid = segmentGrid(band.pieces)
    city.buildings.forEach((b, i) => {
      if (result[i] >= 0) return
      const segs = grid.near(b.bbox, BAND_M)
      if (segs.some((s) => touches(b.rings, s))) result[i] = k
    })
  })
  return result
}

function touches(rings, [p, q]) {
  if (pointInRings(p, rings)) return true
  for (const r of rings) for (let i = 1; i < r.length; i++) if (segSegDist(r[i - 1], r[i], p, q) <= BAND_M) return true
  return false
}

// Residents in an area: each overlapping census cell adds its population times the share of it inside.
// Cells without a published figure are left out and counted separately.
function countResidents(city, area) {
  let sum = 0
  let missingCells = 0
  if (area.length === 0) return { residents: 0, missingCells }
  const rings = area.flatMap((poly) => poly.map((r, i) => ({ r, hole: i > 0, bbox: bboxOf(r) })))
  const box = bboxOf(area.flatMap((poly) => poly[0]))
  for (const cell of city.cells) {
    if (!boxesOverlap(box, cell.bbox)) continue
    // A cell is a convex four-sided shape, so each ring can be clipped to it on its own:
    // the area inside is the clipped outer rings minus the clipped holes.
    let a = 0
    for (const { r, hole, bbox } of rings) {
      if (!boxesOverlap(bbox, cell.bbox)) continue
      a += (hole ? -1 : 1) * Math.abs(ringArea(clipToConvex(r, cell.rings[0])))
    }
    if (a <= 0.01) continue
    if (cell.population == null) missingCells++
    else sum += (cell.population * a) / cell.area
  }
  return { residents: Math.round(sum / 10) * 10, missingCells }
}

function segmentGrid(pieces, size = 50) {
  const cells = new Map()
  const key = (i, j) => i + ',' + j
  for (const line of pieces) {
    for (let k = 1; k < line.length; k++) {
      const seg = [line[k - 1], line[k]]
      const [x0, y0, x1, y1] = bboxOf(seg)
      for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++)
        for (let j = Math.floor(y0 / size); j <= Math.floor(y1 / size); j++) {
          const kk = key(i, j)
          if (!cells.has(kk)) cells.set(kk, [])
          cells.get(kk).push(seg)
        }
    }
  }
  return {
    near([x0, y0, x1, y1], pad) {
      const found = new Set()
      for (let i = Math.floor((x0 - pad) / size); i <= Math.floor((x1 + pad) / size); i++)
        for (let j = Math.floor((y0 - pad) / size); j <= Math.floor((y1 + pad) / size); j++)
          for (const s of cells.get(key(i, j)) || []) found.add(s)
      return [...found]
    },
  }
}

// --- small geometry helpers ---

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function dist(p, q) {
  return Math.hypot(q[0] - p[0], q[1] - p[1])
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

function boxesOverlap(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

function ringArea(r) {
  let s = 0
  for (let i = 1; i < r.length; i++) s += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]
  return s / 2
}

// Area of a polygon: outer ring minus holes.
function polygonArea(rings) {
  return rings.reduce((s, r, i) => s + (i === 0 ? 1 : -1) * Math.abs(ringArea(r)), 0)
}

// Sutherland–Hodgman: the part of a ring inside a convex polygon. Returns a closed ring.
function clipToConvex(ring, clip) {
  const c = clip.slice(0, -1)
  if (ringArea(clip) < 0) c.reverse() // make the clip polygon run anticlockwise
  let out = ring.slice(0, -1)
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i]
    const b = c[(i + 1) % c.length]
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j]
      const q = input[(j + 1) % input.length]
      const pIn = cross(a, b, p) >= 0
      const qIn = cross(a, b, q) >= 0
      if (pIn) out.push(p)
      if (pIn !== qIn) {
        const t = cross(a, b, p) / (cross(a, b, p) - cross(a, b, q))
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
      }
    }
  }
  if (out.length) out.push(out[0])
  return out
}

function pointInRings(p, rings) {
  let inside = false
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segSegDist(a, b, c, d) {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b))
}
