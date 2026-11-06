import { gql } from '@apollo/client'

import enhanceCombinedViews from '../../../enhancers/enhanceCombinedViews.js'
import viewsField from '../../fragments/viewsField.js'
import useScope, { periodUnits } from '../../../hooks/useScope.js'
import useSource, { SOURCE_GA4 } from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'
import useReportDomain from '../domains/useReportDomain.js'

const QUERY = gql`
  query fetchCombinedViews(
    $interval: Interval!
    $type: ViewType!
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
        ...viewsField
      }
    }
  }

  ${viewsField}
`

export default (filters) => {
  const source = useSource()
  const scope = useScope()
  // A period shows its days, months or years, as many as the server returns (ACKEE-24)
  const limit = (source !== SOURCE_GA4 && periodUnits(scope.period, filters.interval)) || filters.limit
  const domainId = useReportDomain()
  // The chart behind the dialog shows the picked domain only
  const selector = (data) => data?.domains.filter((domain) => domainId == null || domain.id === domainId)
  const enhancer = (value) => enhanceCombinedViews(value, limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
