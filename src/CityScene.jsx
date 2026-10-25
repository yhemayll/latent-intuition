import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BACKGROUND, BAND_COLORS, GROUND, STREET, colorOfHeight, heightRange } from './palette.js'

// The scene uses the city's local metres: x to the east, y up, and north towards -z.
// A point (x, y) of the plan sits at (x, height, -y) in the scene.

const STREET_Y = 1.2 // street lines float just above the walk areas
const areaY = (band) => 0.3 * (3 - band) // 5 minutes on top

export default function CityScene({ city, result, onPick }) {
  const { x0, y0, x1, y1 } = city.bounds
  const span = Math.max(x1 - x0, y1 - y0)

  const pick = (e) => {
    e.stopPropagation()
    if (e.delta > 4) return // the mouse moved: that was an orbit, not a click
    onPick(e.point.x, -e.point.z)
  }

  return (
    <Canvas camera={{ position: [-0.35 * span, 0.55 * span, 0.7 * span], fov: 40, near: 10, far: 20 * span }} dpr={[1, 2]}>
      <color attach="background" args={[BACKGROUND]} />
      <hemisphereLight args={['#ffffff', '#cfc8b8', 1.4]} />
      <directionalLight position={[-500, 1200, 700]} intensity={1.8} />

      <group onClick={pick}>
        <Ground bounds={city.bounds} />
        <Buildings buildings={city.buildings} buildingBand={result?.ok ? result.buildingBand : null} />
      </group>

      {result?.ok && result.bands.map((band, k) => <Area key={k} area={band.area} band={k} />)}
      <Streets edges={city.edges} />
      {result && <Marker at={result.ok ? result.start : result.click} found={result.ok} />}

      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI * 0.47} minDistance={60} maxDistance={3 * span} />
    </Canvas>
  )
}

function Ground({ bounds: { x0, y0, x1, y1 } }) {
  const margin = 400
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, 0, -(y0 + y1) / 2]}>
      <planeGeometry args={[x1 - x0 + 2 * margin, y1 - y0 + 2 * margin]} />
      <meshLambertMaterial color={GROUND} />
    </mesh>
  )
}

// All buildings in one mesh. Each building owns a run of vertices, so it can be recoloured alone.
function Buildings({ buildings, buildingBand }) {
  const { geometry, ranges } = useMemo(() => mergeBuildings(buildings), [buildings])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const colors = geometry.attributes.color
    const c = new THREE.Color()
    const range = heightRange(buildings)
    buildings.forEach((b, i) => {
      const band = buildingBand ? buildingBand[i] : -1
      c.set(band >= 0 ? BAND_COLORS[band] : colorOfHeight(b.height, range))
      const [start, count] = ranges[i]
      for (let v = start; v < start + count; v++) colors.setXYZ(v, c.r, c.g, c.b)
    })
    colors.needsUpdate = true
  }, [geometry, ranges, buildings, buildingBand])

  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial vertexColors />
    </mesh>
  )
}

function mergeBuildings(buildings) {
  const parts = []
  const ranges = []
  let offset = 0
  for (const b of buildings) {
    const g = new THREE.ExtrudeGeometry(toShape(b.rings), { depth: b.height, bevelEnabled: false })
    g.rotateX(-Math.PI / 2) // extrude upwards, with the plan's north towards -z
    g.deleteAttribute('uv')
    const count = g.attributes.position.count
    ranges.push([offset, count])
    offset += count
    parts.push(g)
  }
  const geometry = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(offset * 3), 3))
  return { geometry, ranges }
}

function Area({ area, band }) {
  const geometry = useMemo(() => {
    const g = new THREE.ShapeGeometry(area.map(toShape))
    g.rotateX(-Math.PI / 2)
    return g
  }, [area])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} position={[0, areaY(band), 0]}>
      <meshBasicMaterial color={BAND_COLORS[band]} />
    </mesh>
  )
}

function Streets({ edges }) {
  const geometry = useMemo(() => {
    const pos = []
    for (const e of edges)
      for (let i = 1; i < e.pts.length; i++) {
        const [a, b] = [e.pts[i - 1], e.pts[i]]
        pos.push(a[0], STREET_Y, -a[1], b[0], STREET_Y, -b[1])
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [edges])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={STREET} />
    </lineSegments>
  )
}

// A post at the start node, or a grey one at the click when no street was close enough.
function Marker({ at: [x, y], found }) {
  return (
    <mesh position={[x, 15, -y]}>
      <cylinderGeometry args={[3, 3, 30, 16]} />
      <meshLambertMaterial color={found ? '#2b2622' : '#9a958c'} />
    </mesh>
  )
}

// A polygon's rings (outer first, then holes) as a three.js Shape.
function toShape(rings) {
  const path = (ring) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))
  const shape = new THREE.Shape(path(rings[0]))
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(path(hole)))
  return shape
}
