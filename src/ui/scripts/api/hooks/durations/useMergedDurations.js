import { gql } from '@apollo/client'

import enhanceDurations from '../../../enhancers/enhanceDurations.js'
import durationsField from '../../fragments/durationsField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedDurations($interval: Interval!, $limit: Int, $domainId: ID, $source: StatisticsSource) {
    statistics(domainId: $domainId, source: $source) {
      id
      ...durationsField
    }
  }

  ${durationsField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.durations
  const enhancer = (value) => enhanceDurations(value, filters.limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
