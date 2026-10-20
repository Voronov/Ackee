import { gql } from '@apollo/client'

import enhanceFacts from '../../../enhancers/enhanceFacts.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchActiveVisitors($id: ID!, $source: StatisticsSource) {
    domain(id: $id) {
      id
      facts(source: $source) {
        id
        activeVisitors
      }
    }
  }
`

export default (id) => {
  const source = useSource()
  const selector = (data) => data?.domain.facts
  const enhancer = enhanceFacts

  return useQuery(QUERY, selector, enhancer, {
    variables: {
      id,
      source,
    },
    pollInterval: 5000,
  })
}
