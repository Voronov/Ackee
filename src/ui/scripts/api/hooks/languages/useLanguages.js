import { gql } from '@apollo/client'

import enhanceLanguages from '../../../enhancers/enhanceLanguages.js'
import languagesField from '../../fragments/languagesField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchLanguages($id: ID!, $sorting: Sorting!, $range: Range, $source: StatisticsSource) {
    domain(id: $id) {
      id
      statistics(source: $source) {
        id
        ...languagesField
      }
    }
  }

  ${languagesField}
`

export default (id, filters) => {
  const source = useSource()
  const selector = (data) => data?.domain.statistics.languages
  const enhancer = enhanceLanguages

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
      source,
    },
  })
}
