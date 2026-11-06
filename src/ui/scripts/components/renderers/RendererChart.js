import PropTypes from 'prop-types'
import { createElement as h, useCallback, useEffect, useState } from 'react'

import useChartLabel from '../../hooks/useChartLabel.js'

import PresentationBarChart from '../presentations/PresentationBarChart.js'

const RendererChart = (props) => {
  // Index of the active element
  const [active, setActive] = useState(0)

  const onItemEnter = useCallback((index) => setActive(index), [setActive])
  const onItemLeave = useCallback(() => setActive(0), [setActive])

  const chartLabel = useChartLabel(props.interval)
  const label = (props.labelFn ?? chartLabel)(active)
  useEffect(() => props.setStatusLabel(label), [label])

  return h(PresentationBarChart, {
    items: props.items,
    formatter: props.formatter,
    active,
    onItemEnter,
    onItemLeave,
    onItemClick: props.onItemClick,
  })
}

RendererChart.propTypes = {
  items: PropTypes.array.isRequired,
  interval: PropTypes.string.isRequired,
  formatter: PropTypes.func.isRequired,
  setStatusLabel: PropTypes.func.isRequired,
  onItemClick: PropTypes.func,
  labelFn: PropTypes.func,
}

export default RendererChart
