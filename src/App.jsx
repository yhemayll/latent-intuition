import { useEffect, useMemo, useRef, useState } from 'react'
import CityScene from './CityScene.jsx'
import { prepare, BAND_M, MAX_START_M, METRES_PER_MINUTE, MINUTES } from './reach.js'
import { BAND_COLORS, HEIGHT_STOPS, heightRange } from './palette.js'

const FILES = { kit: 'kit.json', buildings: 'buildings.geojson', graph: 'streets.graph.json', zensus: 'zensus.geojson' }

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const fmt = (n) => n.toLocaleString('en-GB')

function loadKit() {
  const load = ([key, file]) =>
    fetch(`${import.meta.env.BASE_URL}data/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`data/${file}: ${r.status}`)
        return r.json()
      })
      .then((json) => [key, json])
  return Promise.all(Object.entries(FILES).map(load)).then(Object.fromEntries)
}

export default function App() {
  const [city, setCity] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const worker = useRef(null)
  const lastId = useRef(0)

  useEffect(() => {
    let cancelled = false
    loadKit()
      .then((raw) => {
        if (cancelled) return
        const w = new Worker(new URL('./reach.worker.js', import.meta.url), { type: 'module' })
        w.onmessage = ({ data }) => {
          if (data.id !== lastId.current) return // an older click
          setResult(data.result)
          setBusy(false)
        }
        w.onerror = (e) => {
          setError(`The calculation failed (${e.message}).`)
          setBusy(false)
        }
        w.postMessage({ type: 'data', raw })
        worker.current = w
        setCity(prepare(raw))
      })
      .catch((e) => setError(`The city kit didn't load (${e.message}).`))
    return () => {
      cancelled = true
      worker.current?.terminate()
      worker.current = null
    }
  }, [])

  const pick = (x, y) => {
    if (!worker.current) return
    lastId.current += 1
    setBusy(true)
    worker.current.postMessage({ type: 'reach', id: lastId.current, x, y })
  }

  return (
    <div className="app">
      <div className="scene">
        {city ? <CityScene city={city} result={result} onPick={pick} /> : <p className="loading">Loading the city…</p>}
      </div>

      <aside className="panel">
        <h1>Walking reach</h1>
        <p className="hint">Click the ground to start a walk. Drag to orbit, right-drag to pan, scroll to zoom.</p>
        {error && <p className="error">{error}</p>}
        <Results result={result} busy={busy} />
        <Method />
      </aside>

      {city && <Legend buildings={city.buildings} />}

      <p className="attribution">{ATTRIBUTION}</p>
    </div>
  )
}

function Results({ result, busy }) {
  if (busy) return <p className="status">Walking…</p>
  if (!result) return null
  if (!result.ok) {
    return (
      <p className="status warn">
        No walkable street within {MAX_START_M} m of this point
        {Number.isFinite(result.distance) && <> (the nearest is {fmt(Math.round(result.distance))} m away)</>}. Click
        closer to a street.
      </p>
    )
  }
  return (
    <>
      <p className="status">The walk starts at the nearest street node, {Math.round(result.distance)} m from your click.</p>
      <table>
        <thead>
          <tr>
            <th>Walk</th>
            <th>Buildings</th>
            <th>Residents</th>
          </tr>
        </thead>
        <tbody>
          {result.bands.map((b, k) => (
            <tr key={b.minutes}>
              <td>
                <span className="swatch" style={{ background: BAND_COLORS[k] }} />
                {b.minutes} min
              </td>
              <td>{fmt(b.buildings)}</td>
              <td>
                about {fmt(b.residents)}
                {b.missingCells > 0 && (
                  <span className="missing">
                    + {b.missingCells} {b.missingCells === 1 ? 'cell' : 'cells'} without a figure
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function Method() {
  const [m1, m2, m3] = MINUTES.map((m) => fmt(m * METRES_PER_MINUTE))
  return (
    <div className="method">
      <h2>How this is worked out</h2>
      <p>
        The walk starts at the street node nearest to your click and follows the pedestrian network at 4.8 km/h,
        which is {METRES_PER_MINUTE} m a minute: {m1}, {m2} and {m3} m for {MINUTES.join(', ')} minutes. If no
        walkable street is within {MAX_START_M} m, there is no walk.
      </p>
      <p>
        Each area is the street segments reached in that time, including the reachable part of the last segment, with
        a band of {BAND_M} m on each side, joined into one shape. A building counts when it touches the area.
      </p>
      <p>
        Residents come from the 100 m cells of the Zensus 2022. Each cell that overlaps the area adds its population
        times the share of the cell's area that lies inside. The sum is rounded to the nearest 10.
      </p>
      <p>
        Some cells have no published population. They are not zero: they are left out of the sum, and the number of
        such cells overlapping the area is shown next to it.
      </p>
    </div>
  )
}

// The height scale, from the lowest building to RED_AT_M, where it turns full red.
function Legend({ buildings }) {
  const [min, max] = useMemo(() => heightRange(buildings), [buildings])

  return (
    <details className="legend" open>
      <summary>Building height</summary>
      <div className="ramp" style={{ background: `linear-gradient(to right, ${HEIGHT_STOPS.join(', ')})` }} />
      <div className="ramp-labels">
        <span>{fmt(Math.round(min))} m</span>
        <span>{fmt(Math.round((min + max) / 2))} m</span>
        <span>{fmt(Math.round(max))}+ m</span>
      </div>
      <p className="note">Reached buildings take the shade of their walk.</p>
    </details>
  )
}
