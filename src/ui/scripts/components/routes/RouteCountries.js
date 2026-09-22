import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useCountries from '../../api/hooks/countries/useCountries.js'
import useDomains from '../../api/hooks/domains/useDomains.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererMap from '../renderers/RendererMap.js'

const RouteCountries = (props) => {
  const domains = useDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
      exportAs: {
        domainId: domain.id,
        report: 'countries',
        range: props.filters.range,
      },
      headline: domain.title,
      onMore: () => props.setRoute(`/domains/${domain.id}`),
      hook: useCountries,
      hookArgs: [
        domain.id,
        {
          sorting: props.filters.sorting,
          range: props.filters.range,
        },
      ],
      renderer: RendererMap,
      rendererProps: {
        sorting: props.filters.sorting,
        range: props.filters.range,
      },
    })
  })
}

RouteCountries.propTypes = {
  setRoute: PropTypes.func.isRequired,
  filters: PropTypes.object.isRequired,
}

export default RouteCountries
