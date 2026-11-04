import PropTypes from 'prop-types'
import { createElement as h, useCallback, useEffect, useState } from 'react'

import { SORTINGS_RECENT, SORTINGS_TOP } from '../../../../constants/sortings.js'

import formatCount from '../../utils/formatCount.js'
import useScope from '../../hooks/useScope.js'
import rangeLabel from '../../utils/rangeLabel.js'
import relativeDate from '../../utils/relativeDate.js'

import PresentationCounterList from '../presentations/PresentationCounterList.js'
import PresentationList from '../presentations/PresentationList.js'

const textLabel = (item, range, period, isRecent) => {
  if (item && item.date) return relativeDate(item.date)
  if (isRecent) return 'Recent'

  return rangeLabel(range, period)
}

const RendererList = (props) => {
  const scope = useScope()
  // Index of the active element
  const [active, setActive] = useState()

  const onItemEnter = useCallback((index) => setActive(index), [setActive])
  const onItemLeave = useCallback(() => setActive(), [setActive])

  const label = textLabel(props.items[active], props.range, scope.period, props.sorting === SORTINGS_RECENT)
  useEffect(() => props.setStatusLabel(label), [label])

  if (props.sorting === SORTINGS_TOP)
    return h(PresentationCounterList, {
      items: props.items,
      formatter: formatCount,
    })

  return h(PresentationList, {
    items: props.items,
    onItemEnter,
    onItemLeave,
  })
}

RendererList.propTypes = {
  items: PropTypes.array.isRequired,
  sorting: PropTypes.string.isRequired,
  range: PropTypes.string.isRequired,
  setStatusLabel: PropTypes.func.isRequired,
}

export default RendererList
