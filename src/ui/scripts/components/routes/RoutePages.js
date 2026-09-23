import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useDomains from '../../api/hooks/domains/useDomains.js'
import usePages from '../../api/hooks/pages/usePages.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererList from '../renderers/RendererList.js'

const RoutePages = (props) => {
  const domains = useDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
      exportAs: {
        domainId: domain.id,
        report: 'pages',
        range: props.filters.range,
      },
      headline: domain.title,
      onMore: () => props.setRoute(`/domains/${domain.id}`),
      hook: usePages,
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

RoutePages.propTypes = {
  setRoute: PropTypes.func.isRequired,
  filters: PropTypes.object.isRequired,
}

export default RoutePages
