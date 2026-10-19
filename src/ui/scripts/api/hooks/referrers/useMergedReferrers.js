import { gql } from '@apollo/client'

import enhanceReferrers from '../../../enhancers/enhanceReferrers.js'
import referrersField from '../../fragments/referrersField.js'
import useSelectedDomain from '../../../hooks/useSelectedDomain.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedReferrers($sorting: Sorting!, $type: ReferrerType!, $range: Range, $domainId: ID) {
    statistics(domainId: $domainId) {
      id
      ...referrersField
    }
  }

  ${referrersField}
`

export default (filters) => {
  const domainId = useSelectedDomain()
  const selector = (data) => data?.statistics.referrers
  const enhancer = enhanceReferrers

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId },
  })
}
