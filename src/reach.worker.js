// Runs the walk calculation off the main thread, so the 3D view stays smooth while it works.
import { prepare, computeReach } from './reach.js'

let city = null

self.onmessage = ({ data }) => {
  if (data.type === 'data') city = prepare(data.raw)
  if (data.type === 'reach') self.postMessage({ id: data.id, result: computeReach(city, data.x, data.y) })
}
