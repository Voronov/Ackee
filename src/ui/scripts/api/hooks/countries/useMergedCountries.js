import { gql } from '@apollo/client'

import countriesField from '../../fragments/countriesField.js'
import enhanceCountries from '../../../enhancers/enhanceCountries.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedCountries($sorting: Sorting!, $range: Range) {
    statistics {
      id
      ...countriesField
    }
  }

  ${countriesField}
`

export default (filters) => {
  const selector = (data) => data?.statistics.countries
  const enhancer = enhanceCountries

  return useQuery(QUERY, selector, enhancer, {
    variables: filters,
  })
}
