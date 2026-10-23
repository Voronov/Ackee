import { gql } from '@apollo/client'

import enhanceFacts from '../../../enhancers/enhanceFacts.js'
import useReportDomain from '../domains/useReportDomain.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedActiveVisitors($domainId: ID) {
    facts(domainId: $domainId) {
      id
      activeVisitors
    }
  }
`

export default () => {
  const domainId = useReportDomain()
  const selector = (data) => data?.facts
  const enhancer = enhanceFacts

  return useQuery(QUERY, selector, enhancer, {
    variables: { domainId },
    pollInterval: 5000,
  })
}
