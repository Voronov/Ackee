import { gql } from '@apollo/client'

import enhanceFacts from '../../../enhancers/enhanceFacts.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedActiveVisitors($source: StatisticsSource) {
    facts(source: $source) {
      id
      activeVisitors
    }
  }
`

export default () => {
  const source = useSource()
  const selector = (data) => data?.facts
  const enhancer = enhanceFacts

  return useQuery(QUERY, selector, enhancer, {
    variables: { source },
    pollInterval: 5000,
  })
}
