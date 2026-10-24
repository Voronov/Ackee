import { gql } from '@apollo/client'

import enhanceBrowsers from '../../../enhancers/enhanceBrowsers.js'
import browsersField from '../../fragments/browsersField.js'
import useReportDomain from '../domains/useReportDomain.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedBrowsers(
    $sorting: Sorting!
    $type: BrowserType!
    $range: Range
    $domainId: ID
    $source: StatisticsSource
  ) {
    statistics(domainId: $domainId, source: $source) {
      id
      ...browsersField
    }
  }

  ${browsersField}
`

export default (filters) => {
  const domainId = useReportDomain()
  const source = useSource()
  const selector = (data) => data?.statistics.browsers
  const enhancer = enhanceBrowsers

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, domainId, source },
  })
}
