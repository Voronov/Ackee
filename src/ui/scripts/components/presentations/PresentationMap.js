import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import paths, { HEIGHT, WIDTH } from '../../constants/worldMap.js'
import formatNumber from '../../utils/formatNumber.js'
import mapShade, { MIN_SHADE } from '../../utils/mapShade.js'
import pluralize from '../../utils/pluralize.js'

const Country = (props) => {
  if (props.item == null) return h('path', { 'className': 'map__country', 'd': props.d, 'data-code': props.code })

  return h(
    'path',
    {
      'className': 'map__country map__country--visited',
      'd': props.d,
      'data-code': props.code,
      'style': { '--shade': props.shade },
    },
    h('title', {}, `${props.item.text}: ${formatNumber(props.item.count)}`),
  )
}

Country.propTypes = {
  code: PropTypes.string.isRequired,
  d: PropTypes.string.isRequired,
  item: PropTypes.object,
  shade: PropTypes.number,
}

const Legend = (props) => {
  return h(
    'div',
    { 'className': 'map__legend color-light', 'aria-hidden': true },
    h('span', {}, props.min === props.max ? '' : formatNumber(props.min)),
    h('span', { className: 'map__scale', style: { '--min-shade': MIN_SHADE } }),
    h('span', {}, formatNumber(props.max)),
  )
}

Legend.propTypes = {
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
}

// Codes without a shape, like Gibraltar or Réunion, and sources without codes stay in the list only
export const isOnMap = (item) => item.code != null && Object.hasOwn(paths, item.code)

// The list below the map stays the accessible way to read the numbers, so the map is one image
const PresentationMap = (props) => {
  const shown = new Map(props.items.filter(isOnMap).map((item) => [item.code, item]))
  const counts = [...shown.values()].map((item) => item.count)
  const max = Math.max(...counts)

  return h(
    'div',
    { className: 'map' },
    h(
      'svg',
      {
        'className': 'map__svg',
        'viewBox': `0 0 ${WIDTH} ${HEIGHT}`,
        'role': 'img',
        'aria-label': `Map of ${shown.size} ${pluralize(['countries', 'country', 'countries'], shown.size)}`,
      },
      Object.entries(paths).map(([code, d]) =>
        h(Country, {
          key: code,
          code,
          d,
          item: shown.get(code),
          shade: shown.has(code) ? mapShade(shown.get(code).count, max) : undefined,
        }),
      ),
    ),
    shown.size > 0 && h(Legend, { min: Math.min(...counts), max }),
  )
}

PresentationMap.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      code: PropTypes.string,
      text: PropTypes.string.isRequired,
      count: PropTypes.number.isRequired,
    }),
  ).isRequired,
}

export default PresentationMap
