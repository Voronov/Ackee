import { gql } from '@apollo/client'

import enhanceCountries from '../../../enhancers/enhanceCountries.js'
import countriesField from '../../fragments/countriesField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedCountries($sorting: Sorting!, $range: Range, $domainId: ID, $source: StatisticsSource) {
    statistics(domainId: $domainId, source: $source) {
      id
      ...countriesField
    }
  }

  ${countriesField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.countries
  const enhancer = enhanceCountries

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
