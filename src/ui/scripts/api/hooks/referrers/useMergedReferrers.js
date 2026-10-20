import { gql } from '@apollo/client'

import enhanceReferrers from '../../../enhancers/enhanceReferrers.js'
import referrersField from '../../fragments/referrersField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedReferrers($sorting: Sorting!, $type: ReferrerType!, $range: Range, $source: StatisticsSource) {
    statistics(source: $source) {
      id
      ...referrersField
    }
  }

  ${referrersField}
`

export default (filters) => {
  const source = useSource()
  const selector = (data) => data?.statistics.referrers
  const enhancer = enhanceReferrers

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
