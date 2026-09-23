import PropTypes from 'prop-types'
import { createElement as h, useState } from 'react'

import formatCount from '../../utils/formatCount.js'
import rangeLabel from '../../utils/rangeLabel.js'
import worldPaths, { HEIGHT, WIDTH } from '../../constants/worldPaths.js'

/*
 * A world map shaded by how many visits came from each country.
 *
 * The shapes are generated ahead of time by tools/buildWorldPaths.js, so nothing about
 * geography is computed here and no mapping library ships in the bundle.
 */

// Colour is opacity over the accent, not a set of fixed colours, so the map follows the
// theme instead of fighting it.
const shadeFor = (count, highest) => {
  if (count === 0 || highest === 0) return 0

  // Square root rather than linear: one dominant country would otherwise flatten every
  // other shade into the background.
  return 0.15 + 0.85 * Math.sqrt(count / highest)
}

const RendererMap = (props) => {
  const [hovered, setHovered] = useState(null)

  const byCode = new Map(props.items.filter((item) => item.code != null).map((item) => [item.code, item]))
  const highest = Math.max(0, ...props.items.map((item) => item.count ?? 0))

  const label =
    hovered == null
      ? `${byCode.size} ${byCode.size === 1 ? 'country' : 'countries'}, ${rangeLabel(props.range)}`
      : `${hovered.name}: ${formatCount(hovered.count)}`

  return h(
    'div',
    { className: 'map' },
    h(
      'svg',
      {
        'className': 'map__canvas',
        'viewBox': `0 0 ${WIDTH} ${HEIGHT}`,
        'role': 'img',
        'aria-label': `Visits by country, ${rangeLabel(props.range)}`,
      },
      Object.entries(worldPaths).map(([code, path]) => {
        const item = byCode.get(code)
        const shade = shadeFor(item?.count ?? 0, highest)

        return h('path', {
          key: code,
          d: path,
          className: 'map__country',
          // Countries with no visits keep a faint outline so the world is still a world
          // rather than a scatter of shapes.
          style: { opacity: shade === 0 ? 0.08 : shade },
          onMouseEnter: item == null ? undefined : () => setHovered(item),
          onMouseLeave: item == null ? undefined : () => setHovered(null),
        })
      }),
    ),
    h('p', { className: 'map__label' }, label),
  )
}

RendererMap.propTypes = {
  items: PropTypes.array.isRequired,
  range: PropTypes.string,
}

export default RendererMap
