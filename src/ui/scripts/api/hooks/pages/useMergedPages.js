import { gql } from '@apollo/client'

import enhancePages from '../../../enhancers/enhancePages.js'
import pagesField from '../../fragments/pagesField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedPages($sorting: Sorting!, $range: Range, $domainId: ID, $source: StatisticsSource) {
    statistics(domainId: $domainId, source: $source) {
      id
      ...pagesField
    }
  }

  ${pagesField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.pages
  const enhancer = enhancePages

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
