import { gql } from '@apollo/client'

import enhanceSizes from '../../../enhancers/enhanceSizes.js'
import sizesField from '../../fragments/sizesField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchSizes($id: ID!, $sorting: Sorting!, $type: SizeType!, $range: Range, $source: StatisticsSource) {
    domain(id: $id) {
      id
      statistics(source: $source) {
        id
        ...sizesField
      }
    }
  }

  ${sizesField}
`

export default (id, filters) => {
  const source = useSource()
  const selector = (data) => data?.domain.statistics.sizes
  const enhancer = enhanceSizes

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
      source,
    },
  })
}
