import { gql } from '@apollo/client'

export default gql`
  fragment countriesField on DomainStatistics {
    countries(sorting: $sorting, range: $range) {
      id
      value
      code
      count
      created
    }
  }
`
