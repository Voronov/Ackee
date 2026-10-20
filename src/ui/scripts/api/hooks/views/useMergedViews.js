import { gql } from '@apollo/client'

import enhanceViews from '../../../enhancers/enhanceViews.js'
import viewsField from '../../fragments/viewsField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedViews($interval: Interval!, $type: ViewType!, $limit: Int, $source: StatisticsSource) {
    statistics(source: $source) {
      id
      ...viewsField
    }
  }

  ${viewsField}
`

export default (filters, options) => {
  const source = useSource()
  const selector = (data) => data?.statistics.views
  const enhancer = (value) => enhanceViews(value, filters.limit)

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
    ...options,
  })
}
