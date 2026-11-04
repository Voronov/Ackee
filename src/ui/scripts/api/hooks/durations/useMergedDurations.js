import { gql } from '@apollo/client'

import enhanceDurations from '../../../enhancers/enhanceDurations.js'
import durationsField from '../../fragments/durationsField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useScope, { periodUnits } from '../../../hooks/useScope.js'
import useSource, { SOURCE_GA4 } from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedDurations(
    $interval: Interval!
    $limit: Int
    $domainId: ID
    $source: StatisticsSource
    $filters: [FilterInput!]
    $period: PeriodInput
  ) {
    statistics(domainId: $domainId, source: $source, filters: $filters, period: $period) {
      id
      ...durationsField
    }
  }

  ${durationsField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const scope = useScope()
  // A period shows its days, months or years, as many as the server returns (ACKEE-24)
  const limit = (source !== SOURCE_GA4 && periodUnits(scope.period, filters.interval)) || filters.limit
  const selector = (data) => data?.statistics.durations
  const enhancer = (value) => enhanceDurations(value, limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
