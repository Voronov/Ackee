import PropTypes from 'prop-types'
import { Fragment, createElement as h } from 'react'

import { SORTINGS_TOP } from '../../../../constants/sortings.js'

import PresentationMap, { isOnMap } from '../presentations/PresentationMap.js'
import RendererList from './RendererList.js'

// Only TOP has counts to colour by, and an empty map would only push the list down
export const hasMap = (props) => props.sorting === SORTINGS_TOP && props.items.some(isOnMap)

const RendererCountries = (props) => {
  if (hasMap(props) === false) return h(RendererList, props)

  return h(Fragment, {}, h(PresentationMap, { items: props.items }), h(RendererList, props))
}

RendererCountries.propTypes = {
  items: PropTypes.array.isRequired,
  sorting: PropTypes.string.isRequired,
  range: PropTypes.string.isRequired,
  setStatusLabel: PropTypes.func.isRequired,
}

export default RendererCountries
