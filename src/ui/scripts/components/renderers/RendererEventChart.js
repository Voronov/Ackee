import { createElement as h } from 'react'

import formatFloat from '../../utils/formatFloat.js'
import relativeFn from '../../utils/relativeFn.js'

import RendererChart from './RendererChart.js'

export default (props) =>
  h(RendererChart, {
    ...props,
    formatter: formatFloat,
    // Events have no period, their bars always end today
    labelFn: relativeFn(props.interval),
  })
