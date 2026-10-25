// Colours for the city and the walk. Uses are quiet; the walk has one accent in three shades.

import * as THREE from 'three'

export const BACKGROUND = '#f6f4ef'
export const GROUND = '#ebe7dd'
export const STREET = '#8a867c'

// 5, 10 and 15 minutes: darkest for the nearest.
export const BAND_COLORS = ['#1f4e9c', '#4f86c6', '#a6c8ea']

// Every `use` in buildings.geojson, with the label shown in the legend.
export const USES = {
  residential: { label: 'residential', color: '#e3dccf' },
  service: { label: 'service', color: '#aebccb' },
  office: { label: 'office', color: '#8da2b8' },
  retail: { label: 'retail', color: '#d6c38e' },
  food_and_drink: { label: 'food and drink', color: '#c6a77a' },
  accommodation: { label: 'accommodation', color: '#bfae9c' },
  entertainment: { label: 'entertainment', color: '#a99bb5' },
  culture: { label: 'culture', color: '#8b86a8' },
  education: { label: 'education', color: '#a8bf9a' },
  health: { label: 'health', color: '#9cc2bb' },
  civic: { label: 'civic', color: '#7f9e8e' },
  sport: { label: 'sport', color: '#bccb8c' },
  transport: { label: 'transport', color: '#8f8f86' },
  light_industrial: { label: 'light industrial', color: '#7d746b' },
  undefined: { label: 'use not known', color: '#c4c4c0' },
}

export function colorOfUse(use) {
  return (USES[use] || USES.undefined).color
}

// Building height, from the lowest building (green) to RED_AT_M and above (red).
export const HEIGHT_STOPS = ['#2e9e4f', '#f2c14e', '#d7301f']
export const RED_AT_M = 20

export function heightRange(buildings) {
  let min = Infinity
  for (const b of buildings) min = Math.min(min, b.height)
  return [min, RED_AT_M]
}

// The colour at `height`, blended between the two nearest stops.
export function colorOfHeight(height, [min, max]) {
  const t = max > min ? Math.min(Math.max((height - min) / (max - min), 0), 1) : 0
  const s = t * (HEIGHT_STOPS.length - 1)
  const i = Math.min(Math.floor(s), HEIGHT_STOPS.length - 2)
  return new THREE.Color(HEIGHT_STOPS[i]).lerp(new THREE.Color(HEIGHT_STOPS[i + 1]), s - i)
}
