import { gql } from '@apollo/client'

import enhanceDevices from '../../../enhancers/enhanceDevices.js'
import devicesField from '../../fragments/devicesField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedDevices($sorting: Sorting!, $type: DeviceType!, $range: Range, $source: StatisticsSource) {
    statistics(source: $source) {
      id
      ...devicesField
    }
  }

  ${devicesField}
`

export default (filters) => {
  const source = useSource()
  const selector = (data) => data?.statistics.devices
  const enhancer = enhanceDevices

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
