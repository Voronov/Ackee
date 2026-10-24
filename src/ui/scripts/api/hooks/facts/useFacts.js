import { gql } from '@apollo/client'

import enhanceFacts from '../../../enhancers/enhanceFacts.js'
import factsFields from '../../fragments/factsFields.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchFacts($id: ID!, $source: StatisticsSource) {
    domain(id: $id) {
      id
      facts(source: $source) {
        ...factsFields
      }
    }
  }

  ${factsFields}
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
  })
}
