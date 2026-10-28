import { gql } from '@apollo/client'

import enhanceCountries from '../../../enhancers/enhanceCountries.js'
import countriesField from '../../fragments/countriesField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchCountries($id: ID!, $sorting: Sorting!, $range: Range, $source: StatisticsSource) {
    domain(id: $id) {
      id
      statistics(source: $source) {
        id
        ...countriesField
      }
    }
  }

  ${countriesField}
`

export default (id, filters) => {
  const source = useSource()
  const selector = (data) => data?.domain.statistics.countries
  const enhancer = enhanceCountries

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
      source,
    },
  })
}
