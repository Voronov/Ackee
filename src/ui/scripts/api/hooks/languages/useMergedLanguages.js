import { gql } from '@apollo/client'

import enhanceLanguages from '../../../enhancers/enhanceLanguages.js'
import languagesField from '../../fragments/languagesField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedLanguages($sorting: Sorting!, $range: Range, $domainId: ID) {
    statistics(domainId: $domainId) {
      id
      ...languagesField
    }
  }

  ${languagesField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const selector = (data) => data?.statistics.languages
  const enhancer = enhanceLanguages

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId },
  })
}
