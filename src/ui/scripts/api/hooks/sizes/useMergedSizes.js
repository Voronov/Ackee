import { gql } from '@apollo/client'

import enhanceSizes from '../../../enhancers/enhanceSizes.js'
import sizesField from '../../fragments/sizesField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedSizes($sorting: Sorting!, $type: SizeType!, $range: Range, $domainId: ID) {
    statistics(domainId: $domainId) {
      id
      ...sizesField
    }
  }

  ${sizesField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const selector = (data) => data?.statistics.sizes
  const enhancer = enhanceSizes

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId },
  })
}
