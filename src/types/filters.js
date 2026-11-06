import gql from 'graphql-tag'

export default gql`
  """
  A field of a view that the reports can be filtered by.
  """
  enum FilterField {
    SITE_LOCATION
    SITE_REFERRER
    SOURCE
    COUNTRY
    BROWSER_NAME
    BROWSER_VERSION
    OS_NAME
    OS_VERSION
    DEVICE_MANUFACTURER
    DEVICE_NAME
  }

  """
  Only views whose field has this value. A null value means views without the field.
  """
  input FilterInput {
    field: FilterField!
    value: String
  }

  """
  The condition an entry of a list stands for. Passed back as a filter, it narrows the reports to this entry.
  """
  type FilterCondition {
    field: FilterField!
    value: String
  }

  """
  Days in the time zone of the viewer, both included, as YYYY-MM-DD. Replaces the range of the lists, and the charts show its days, months or years.
  """
  input PeriodInput {
    from: String!
    to: String!
  }
`
