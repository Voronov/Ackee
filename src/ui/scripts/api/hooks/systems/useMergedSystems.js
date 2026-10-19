import { gql } from '@apollo/client'

import enhanceSystems from '../../../enhancers/enhanceSystems.js'
import systemsField from '../../fragments/systemsField.js'
import useSelectedDomain from '../../../hooks/useSelectedDomain.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedSystems($sorting: Sorting!, $type: SystemType!, $range: Range, $domainId: ID) {
    statistics(domainId: $domainId) {
      id
      ...systemsField
    }
  }

  ${systemsField}
`

export default (filters) => {
  const domainId = useSelectedDomain()
  const selector = (data) => data?.statistics.systems
  const enhancer = enhanceSystems

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId },
  })
}
