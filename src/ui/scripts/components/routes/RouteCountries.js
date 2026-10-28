import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useCountries from '../../api/hooks/countries/useCountries.js'
import useShownDomains from '../../api/hooks/domains/useShownDomains.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererList from '../renderers/RendererList.js'

const RouteCountries = (props) => {
  const domains = useShownDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
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
      renderer: RendererList,
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
