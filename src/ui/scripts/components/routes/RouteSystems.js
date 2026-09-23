import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useDomains from '../../api/hooks/domains/useDomains.js'
import useSystems from '../../api/hooks/systems/useSystems.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererList from '../renderers/RendererList.js'

const RouteSystems = (props) => {
  const domains = useDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
      exportAs: {
        domainId: domain.id,
        report: 'systems',
        range: props.filters.range,
      },
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
