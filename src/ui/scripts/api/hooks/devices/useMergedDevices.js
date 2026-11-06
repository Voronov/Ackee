import { gql } from '@apollo/client'

import enhanceDevices from '../../../enhancers/enhanceDevices.js'
import devicesField from '../../fragments/devicesField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedDevices(
    $sorting: Sorting!
    $type: DeviceType!
    $range: Range
    $domainId: ID
    $source: StatisticsSource
    $filters: [FilterInput!]
    $period: PeriodInput
  ) {
    statistics(domainId: $domainId, source: $source, filters: $filters, period: $period) {
      id
      ...devicesField
    }
  }

  ${devicesField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.devices
  const enhancer = enhanceDevices

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
