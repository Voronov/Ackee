export const MIN_SHADE = 0.2

// Opacity of a visited country on the map. The square root keeps a country with a few visits
// visible next to one with thousands, and the floor keeps it apart from the unvisited ones.
export default (count, max) => {
  if (max <= 0 || count <= 0) return MIN_SHADE

  return MIN_SHADE + (1 - MIN_SHADE) * Math.sqrt(Math.min(count, max) / max)
}
