import { gql } from '@apollo/client'

import enhanceSystems from '../../../enhancers/enhanceSystems.js'
import systemsField from '../../fragments/systemsField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchSystems($id: ID!, $sorting: Sorting!, $type: SystemType!, $range: Range, $source: StatisticsSource) {
    domain(id: $id) {
      id
      statistics(source: $source) {
        id
        ...systemsField
      }
    }
  }

  ${systemsField}
`

export default (id, filters) => {
  const source = useSource()
  const selector = (data) => data?.domain.statistics.systems
  const enhancer = enhanceSystems

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      ...filters,
      id,
      source,
    },
  })
}
