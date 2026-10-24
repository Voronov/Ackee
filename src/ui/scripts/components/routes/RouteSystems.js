import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useShownDomains from '../../api/hooks/domains/useShownDomains.js'
import useSystems from '../../api/hooks/systems/useSystems.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererList from '../renderers/RendererList.js'

const RouteSystems = (props) => {
  const domains = useShownDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
      headline: domain.title,
      onMore: () => props.setRoute(`/domains/${domain.id}`),
      hook: useSystems,
      hookArgs: [
        domain.id,
        {
          sorting: props.filters.sorting,
          type: props.filters.systemsType,
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

RouteSystems.propTypes = {
  setRoute: PropTypes.func.isRequired,
  filters: PropTypes.object.isRequired,
}

export default RouteSystems
