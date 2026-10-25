import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BACKGROUND, BUILDING, GROUND, STREET } from './palette.js'

// The scene uses the city's local metres: x to the east, y up, and north towards -z.
// A point (x, y) of the plan sits at (x, height, -y) in the scene.

const STREET_Y = 1.2 // street lines float just above the ground

// The city itself. Anything drawn on top of it, like the outbreak, comes in as `children`.
// `focus` is a plan point [x, y] the camera dives towards; while it is set, the mouse can't move the view.
export default function CityScene({ city, spin, focus, children }) {
  const { x0, y0, x1, y1 } = city.bounds
  const span = Math.max(x1 - x0, y1 - y0)
  // Where the camera starts: a little south of the centre, where the outbreak starts.
  const home = useMemo(() => ({ eye: [-0.3 * span, 0.75 * span, 0.62 * span], target: [0, 0, 0.1 * span] }), [span])

  return (
    <Canvas camera={{ position: home.eye, fov: 40, near: 10, far: 20 * span }} dpr={[1, 2]}>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 1.1 * span, 3.2 * span]} />
      <hemisphereLight args={['#9aa6ba', '#141619', 1.1]} />
      <directionalLight position={[-700, 1100, -500]} intensity={1.4} color="#c9d3e8" />

      <Ground bounds={city.bounds} />
      <Buildings buildings={city.buildings} />
      <Streets edges={city.edges} />
      {children}

      <OrbitControls
        makeDefault
        target={home.target}
        enableDamping
        enabled={!focus}
        autoRotate={spin}
        autoRotateSpeed={0.35}
        maxPolarAngle={Math.PI * 0.47}
        minDistance={60}
        maxDistance={3 * span}
      />
      <Dive focus={focus} home={home} />
    </Canvas>
  )
}

// Moves the camera smoothly down towards `focus`, and back to `home` once it is cleared.
function Dive({ focus, home }) {
  const controls = useThree((s) => s.controls)
  const goal = useRef({ target: new THREE.Vector3(), eye: new THREE.Vector3() })
  const returning = useRef(false)
  const dived = useRef(false)

  useEffect(() => {
    if (focus) dived.current = true
    else if (dived.current) returning.current = true
  }, [focus])

  useFrame(({ camera }, dt) => {
    if (!controls || (!focus && !returning.current)) return
    const { target, eye } = goal.current
    if (focus) {
      target.set(focus[0], 0, -focus[1])
      eye.set(focus[0] - 90, 140, -focus[1] + 160)
    } else {
      target.set(...home.target)
      eye.set(...home.eye)
      if (camera.position.distanceTo(eye) < 5) returning.current = false
    }
    const k = 1 - Math.exp(-dt * 1.4)
    controls.target.lerp(target, k)
    camera.position.lerp(eye, k)
    controls.update()
  })
  return null
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

// All buildings in one mesh, so orbiting stays smooth.
function Buildings({ buildings }) {
  const geometry = useMemo(() => mergeBuildings(buildings), [buildings])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial color={BUILDING} />
    </mesh>
  )
}

function mergeBuildings(buildings) {
  const parts = buildings.map((b) => {
    const g = new THREE.ExtrudeGeometry(toShape(b.rings), { depth: b.height, bevelEnabled: false })
    g.rotateX(-Math.PI / 2) // extrude upwards, with the plan's north towards -z
    g.deleteAttribute('uv')
    return g
  })
  const geometry = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  return geometry
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

// A polygon's rings (outer first, then holes) as a three.js Shape.
function toShape(rings) {
  const path = (ring) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))
  const shape = new THREE.Shape(path(rings[0]))
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(path(hole)))
  return shape
}
