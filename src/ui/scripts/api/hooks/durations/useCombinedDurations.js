import { gql } from '@apollo/client'

import enhanceCombinedDurations from '../../../enhancers/enhanceCombinedDurations.js'
import durationsField from '../../fragments/durationsField.js'
import useScope, { periodUnits } from '../../../hooks/useScope.js'
import useSource, { SOURCE_GA4 } from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'
import useReportDomain from '../domains/useReportDomain.js'

const QUERY = gql`
  query fetchCombinedDurations(
    $interval: Interval!
    $limit: Int
    $source: StatisticsSource
    $filters: [FilterInput!]
    $period: PeriodInput
  ) {
    domains {
      id
      title
      statistics(source: $source, filters: $filters, period: $period) {
        id
        ...durationsField
      }
    }
  }

  ${durationsField}
`

export default (filters) => {
  const source = useSource()
  const scope = useScope()
  // A period shows its days, months or years, as many as the server returns (ACKEE-24)
  const limit = (source !== SOURCE_GA4 && periodUnits(scope.period, filters.interval)) || filters.limit
  const domainId = useReportDomain()
  // The chart behind the dialog shows the picked domain only
  const selector = (data) => data?.domains.filter((domain) => domainId == null || domain.id === domainId)
  const enhancer = (value) => enhanceCombinedDurations(value, limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
