import { gql } from '@apollo/client'

import enhanceCombinedDurations from '../../../enhancers/enhanceCombinedDurations.js'
import durationsField from '../../fragments/durationsField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchCombinedDurations($interval: Interval!, $limit: Int, $source: StatisticsSource) {
    domains {
      id
      title
      statistics(source: $source) {
        id
        ...durationsField
      }
    }
  }

  ${durationsField}
`

export default (filters) => {
  const source = useSource()
  const selector = (data) => data?.domains
  const enhancer = (value) => enhanceCombinedDurations(value, filters.limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
