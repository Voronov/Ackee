import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useBrowsers from '../../api/hooks/browsers/useBrowsers.js'
import useDomains from '../../api/hooks/domains/useDomains.js'

import CardStatistics from '../cards/CardStatistics.js'
import RendererList from '../renderers/RendererList.js'

const RouteBrowsers = (props) => {
  const domains = useDomains()

  return domains.value.map((domain) => {
    return h(CardStatistics, {
      key: domain.id,
      exportAs: {
        domainId: domain.id,
        report: 'browsers',
        range: props.filters.range,
      },
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
