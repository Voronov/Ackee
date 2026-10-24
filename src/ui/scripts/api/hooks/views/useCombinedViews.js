import { gql } from '@apollo/client'

import enhanceCombinedViews from '../../../enhancers/enhanceCombinedViews.js'
import viewsField from '../../fragments/viewsField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchCombinedViews($interval: Interval!, $type: ViewType!, $limit: Int, $source: StatisticsSource) {
    domains {
      id
      title
      statistics(source: $source) {
        id
        ...viewsField
      }
    }
  }

  ${viewsField}
`

export default (filters) => {
  const source = useSource()
  const selector = (data) => data?.domains
  const enhancer = (value) => enhanceCombinedViews(value, filters.limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
