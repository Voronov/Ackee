import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useBrowsers from '../../api/hooks/browsers/useBrowsers.js'
import useShownDomains from '../../api/hooks/domains/useShownDomains.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererList from '../renderers/RendererList.js'

const RouteBrowsers = (props) => {
  const domains = useShownDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
      headline: domain.title,
      onMore: () => props.setRoute(`/domains/${domain.id}`),
      hook: useBrowsers,
      hookArgs: [
        domain.id,
        {
          sorting: props.filters.sorting,
          type: props.filters.browsersType,
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

RouteBrowsers.propTypes = {
  setRoute: PropTypes.func.isRequired,
  filters: PropTypes.object.isRequired,
}

export default RouteBrowsers
