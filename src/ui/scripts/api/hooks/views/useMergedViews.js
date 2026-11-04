import { gql } from '@apollo/client'

import enhanceViews from '../../../enhancers/enhanceViews.js'
import viewsField from '../../fragments/viewsField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useScope, { periodUnits } from '../../../hooks/useScope.js'
import useSource, { SOURCE_GA4 } from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedViews(
    $interval: Interval!
    $type: ViewType!
    $limit: Int
    $domainId: ID
    $source: StatisticsSource
    $filters: [FilterInput!]
    $period: PeriodInput
  ) {
    statistics(domainId: $domainId, source: $source, filters: $filters, period: $period) {
      id
      ...viewsField
    }
  }

  ${viewsField}
`

export default (filters, options) => {
  const domainId = useReportDomain()
  const source = useSource()
  const scope = useScope()
  // A period shows its days, months or years, as many as the server returns (ACKEE-24)
  const limit = (source !== SOURCE_GA4 && periodUnits(scope.period, filters.interval)) || filters.limit
  const selector = (data) => data?.statistics.views
  const enhancer = (value) => enhanceViews(value, limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
    ...options,
  })
}
