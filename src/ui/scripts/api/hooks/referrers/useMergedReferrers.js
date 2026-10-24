import { gql } from '@apollo/client'

import enhanceReferrers from '../../../enhancers/enhanceReferrers.js'
import referrersField from '../../fragments/referrersField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedReferrers(
    $sorting: Sorting!
    $type: ReferrerType!
    $range: Range
    $domainId: ID
    $source: StatisticsSource
  ) {
    statistics(domainId: $domainId, source: $source) {
      id
      ...referrersField
    }
  }

  ${referrersField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.referrers
  const enhancer = enhanceReferrers

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
