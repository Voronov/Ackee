import { gql } from '@apollo/client'

import enhanceFacts from '../../../enhancers/enhanceFacts.js'
import factsFields from '../../fragments/factsFields.js'
import useSelectedDomain from '../../../hooks/useSelectedDomain.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedFacts($domainId: ID) {
    facts(domainId: $domainId) {
      ...factsFields
    }
  }

  ${factsFields}
`

export default () => {
  const domainId = useSelectedDomain()
  const selector = (data) => data?.facts
  const enhancer = enhanceFacts

  return useQuery(QUERY, selector, enhancer, { variables: { domainId } })
}
