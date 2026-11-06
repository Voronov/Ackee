import { useQuery } from '@apollo/client/react'
import { useMemo } from 'react'

import useScope from '../../hooks/useScope.js'
import { SOURCE_GA4 } from '../../hooks/useSource.js'
import status from '../../utils/status.js'

const declares = (query, name) =>
  query.definitions.some((definition) =>
    definition.variableDefinitions?.some((variable) => variable.variable.name.value === name),
  )

export default (query, selector, enhancer, options) => {
  const scope = useScope()

  // The filters and the period of the address go to every report that takes them (ACKEE-24).
  // GA4 keeps whole properties by day, it has nothing to filter.
  const scoped = options?.variables?.source !== SOURCE_GA4
  const variables = {
    ...options?.variables,
    ...(declares(query, 'filters') && { filters: scoped && scope.filters.length > 0 ? scope.filters : null }),
    ...(declares(query, 'period') && { period: scoped ? scope.period : null }),
  }

  const { loading, data } = useQuery(query, {
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
    ...options,
    variables,
  })

  const selection = useMemo(() => {
    return selector(data)
  }, [data])

  const _value = useMemo(() => {
    return enhancer(selection)
  }, [selection])

  const _status = useMemo(() => {
    return status(selection, loading)
  }, [selection, loading])

  return {
    value: _value,
    status: _status,
  }
}
