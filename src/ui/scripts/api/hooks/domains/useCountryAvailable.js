import { gql } from '@apollo/client'

import useQuery from '../../utils/useQuery.js'

// Whether the instance can tell the country of a visitor (ACKEE_GEO), so the domain dialog
// shows the switch only where it would do something.
const QUERY = gql`
  query countryAvailable {
    countryAvailable
  }
`

export default () => {
  const selector = (data) => data?.countryAvailable
  const enhancer = (value) => value === true

  return useQuery(QUERY, selector, enhancer, {})
}
