import { gql } from '@apollo/client'

import enhanceSystems from '../../../enhancers/enhanceSystems.js'
import systemsField from '../../fragments/systemsField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedSystems(
    $sorting: Sorting!
    $type: SystemType!
    $range: Range
    $domainId: ID
    $source: StatisticsSource
  ) {
    statistics(domainId: $domainId, source: $source) {
      id
      ...systemsField
    }
  }

  ${systemsField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.systems
  const enhancer = enhanceSystems

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
