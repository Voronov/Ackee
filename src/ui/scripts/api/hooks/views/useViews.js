import { gql } from '@apollo/client'

import enhanceViews from '../../../enhancers/enhanceViews.js'
import viewsField from '../../fragments/viewsField.js'
import useScope, { periodUnits } from '../../../hooks/useScope.js'
import useSource, { SOURCE_GA4 } from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchViews(
    $id: ID!
    $interval: Interval!
    $type: ViewType!
    $limit: Int
    $source: StatisticsSource
    $filters: [FilterInput!]
    $period: PeriodInput
  ) {
    domain(id: $id) {
      id
      statistics(source: $source, filters: $filters, period: $period) {
        id
        ...viewsField
      }
    }
  }

  ${viewsField}
`

export default (id, filters) => {
  const source = useSource()
  const scope = useScope()
  // A period shows its days, months or years, as many as the server returns (ACKEE-24)
  const limit = (source !== SOURCE_GA4 && periodUnits(scope.period, filters.interval)) || filters.limit
  const selector = (data) => data?.domain.statistics.views
  const enhancer = (value) => enhanceViews(value, limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
      source,
    },
  })
}
