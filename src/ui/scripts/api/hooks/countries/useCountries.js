import { gql } from '@apollo/client'

import countriesField from '../../fragments/countriesField.js'
import enhanceCountries from '../../../enhancers/enhanceCountries.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchCountries($id: ID!, $sorting: Sorting!, $range: Range) {
    domain(id: $id) {
      id
      statistics {
        id
        ...countriesField
      }
    }
  }

  ${countriesField}
`

export default (id, filters) => {
  const selector = (data) => data?.domain.statistics.countries
  const enhancer = enhanceCountries

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
    },
  })
}
