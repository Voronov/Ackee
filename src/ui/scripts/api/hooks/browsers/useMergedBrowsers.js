import { gql } from '@apollo/client'

import enhanceBrowsers from '../../../enhancers/enhanceBrowsers.js'
import browsersField from '../../fragments/browsersField.js'
import useSource from '../../../hooks/useSource.js'
import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query fetchMergedBrowsers($sorting: Sorting!, $type: BrowserType!, $range: Range, $source: StatisticsSource) {
    statistics(source: $source) {
      id
      ...browsersField
    }
  }

  ${browsersField}
`

export default (filters) => {
  const source = useSource()
  const selector = (data) => data?.statistics.browsers
  const enhancer = enhanceBrowsers

  return useQuery(QUERY, selector, enhancer, {
    variables: { ...filters, source },
  })
}
