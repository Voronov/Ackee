import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useDevices from '../../api/hooks/devices/useDevices.js'
import useDomains from '../../api/hooks/domains/useDomains.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererList from '../renderers/RendererList.js'

const RouteDevices = (props) => {
  const domains = useDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
      exportAs: {
        domainId: domain.id,
        report: 'devices',
        range: props.filters.range,
      },
      headline: domain.title,
      onMore: () => props.setRoute(`/domains/${domain.id}`),
      hook: useDevices,
      hookArgs: [
        domain.id,
        {
          sorting: props.filters.sorting,
          type: props.filters.devicesType,
          range: props.filters.range,
        },
      ],
      renderer: RendererList,
      rendererProps: {
        sorting: props.filters.sorting,
        range: props.filters.range,
      },
    })
  })
}

RouteDevices.propTypes = {
  setRoute: PropTypes.func.isRequired,
  filters: PropTypes.object.isRequired,
}

export default RouteDevices
