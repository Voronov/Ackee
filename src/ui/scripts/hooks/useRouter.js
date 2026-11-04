import { useCallback, useEffect, useState } from 'react'

import routes, { defaultRoute } from '../constants/routes.js'
import getHistory from '../utils/history.js'

const parseLocation = ({ pathname }) => {
  const hasRoute = routes.some((route) => route.pattern.match(pathname) != null)

  if (hasRoute === true) return pathname
  return defaultRoute.pattern.stringify()
}

export default () => {
  const history = getHistory()

  // Use the initial location
  const [route, setLocalPathname] = useState(parseLocation(history.location))

  useEffect(() => {
    // Store the location when the user navigates
    return history.listen(({ location }) => {
      setLocalPathname(parseLocation(location))
    })
  }, [history])

  // Provide a simple wrapper for the push function
  const setRoute = useCallback(
    (pathname) => {
      // The filters and the period stay when another page is opened (ACKEE-24)
      history.push({ pathname, search: history.location.search })
    },
    [history],
  )

  return {
    setRoute,
    route,
  }
}
