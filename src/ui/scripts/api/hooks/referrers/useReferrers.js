import { gql } from '@apollo/client'

import enhanceReferrers from '../../../enhancers/enhanceReferrers.js'
import referrersField from '../../fragments/referrersField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchReferrers($id: ID!, $sorting: Sorting!, $type: ReferrerType!, $range: Range, $source: StatisticsSource) {
    domain(id: $id) {
      id
      statistics(source: $source) {
        id
        ...referrersField
      }
    }
  }

  ${referrersField}
`

export default (id, filters) => {
  const source = useSource()
  const selector = (data) => data?.domain.statistics.referrers
  const enhancer = enhanceReferrers

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
      source,
    },
  })
}
