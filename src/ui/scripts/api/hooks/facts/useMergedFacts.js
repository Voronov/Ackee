import { gql } from '@apollo/client'

import enhanceFacts from '../../../enhancers/enhanceFacts.js'
import factsFields from '../../fragments/factsFields.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedFacts($source: StatisticsSource) {
    facts(source: $source) {
      ...factsFields
    }
  }

  ${factsFields}
`

export default () => {
  const source = useSource()
  const selector = (data) => data?.facts
  const enhancer = enhanceFacts

  return useQuery(QUERY, selector, enhancer, { variables: { source } })
}
