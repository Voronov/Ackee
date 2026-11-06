import { gql } from '@apollo/client'

import enhancePages from '../../../enhancers/enhancePages.js'
import pagesField from '../../fragments/pagesField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchPages(
    $id: ID!
    $sorting: Sorting!
    $range: Range
    $source: StatisticsSource
    $filters: [FilterInput!]
    $period: PeriodInput
  ) {
    domain(id: $id) {
      id
      statistics(source: $source, filters: $filters, period: $period) {
        id
        ...pagesField
      }
    }
  }

  ${pagesField}
`

export default (id, filters) => {
  const source = useSource()
  const selector = (data) => data?.domain.statistics.pages
  const enhancer = enhancePages

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
      source,
    },
  })
}
