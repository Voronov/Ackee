import { gql } from '@apollo/client'

import enhanceSizes from '../../../enhancers/enhanceSizes.js'
import sizesField from '../../fragments/sizesField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedSizes(
    $sorting: Sorting!
    $type: SizeType!
    $range: Range
    $domainId: ID
    $source: StatisticsSource
    $filters: [FilterInput!]
    $period: PeriodInput
  ) {
    statistics(domainId: $domainId, source: $source, filters: $filters, period: $period) {
      id
      ...sizesField
    }
  }

  ${sizesField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.sizes
  const enhancer = enhanceSizes

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
