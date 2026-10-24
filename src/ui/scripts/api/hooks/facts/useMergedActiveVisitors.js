import { gql } from '@apollo/client'

import enhanceFacts from '../../../enhancers/enhanceFacts.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedActiveVisitors($domainId: ID, $source: StatisticsSource) {
    facts(domainId: $domainId, source: $source) {
      id
      activeVisitors
    }
  }
`

export default () => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.facts
  const enhancer = enhanceFacts

  return useQuery(QUERY, selector, enhancer, {
    variables: { domainId, source },
    pollInterval: 5000,
  })
}
