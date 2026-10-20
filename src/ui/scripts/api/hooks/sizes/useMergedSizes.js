import { gql } from '@apollo/client'

import enhanceSizes from '../../../enhancers/enhanceSizes.js'
import sizesField from '../../fragments/sizesField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedSizes($sorting: Sorting!, $type: SizeType!, $range: Range, $source: StatisticsSource) {
    statistics(source: $source) {
      id
      ...sizesField
    }
  }

  ${sizesField}
`

export default (filters) => {
  const source = useSource()
  const selector = (data) => data?.statistics.sizes
  const enhancer = enhanceSizes

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
