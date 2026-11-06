import { Fragment, createElement as h } from 'react'

import useAuthenticated from '../hooks/useAuthenticated.js'

import Dashboard from './Dashboard.js'
import Filter from './Filter.js'
import OverlayFailure from './overlays/OverlayFailure.js'
import OverlayLogin from './overlays/OverlayLogin.js'

const Main = (props) => {
  const errors = props.useErrors()
  const authenticated = useAuthenticated(props.token, errors, props.reset)

  const requiresLogin = authenticated === false
  if (requiresLogin === true)
    return h(OverlayLogin, {
      setToken: props.setToken,
    })

  const hasErrors = errors.length > 0
  if (hasErrors === true)
    return h(OverlayFailure, {
      errors,
    })

  return h(
    Fragment,
    {},
    h(Filter, {
      filters: props.filters,
      setSortingFilter: props.setSortingFilter,
      setRangeFilter: props.setRangeFilter,
      setIntervalFilter: props.setIntervalFilter,
      setViewsTypeFilter: props.setViewsTypeFilter,
      setReferrersTypeFilter: props.setReferrersTypeFilter,
      setDevicesTypeFilter: props.setDevicesTypeFilter,
      setBrowsersTypeFilter: props.setBrowsersTypeFilter,
      setSizesTypeFilter: props.setSizesTypeFilter,
      setSystemsTypeFilter: props.setSystemsTypeFilter,
      route: props.route,
    }),
    h(Dashboard, props),
  )
}

export default Main
