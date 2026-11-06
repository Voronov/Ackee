import { ApolloProvider } from '@apollo/client/react'
import { createElement as h, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'

import createAuthLink from './api/links/createAuthLink.js'
import createHttpLink from './api/links/createHttpLink.js'
import createStatusLink from './api/links/createStatusLink.js'
import createClient from './api/utils/createClient.js'

import useCustomScrollbar from './hooks/useCustomScrollbar.js'
import useFilters from './hooks/useFilters.js'
import useModals from './hooks/useModals.js'
import useRouter from './hooks/useRouter.js'
import useScrollReset from './hooks/useScrollReset.js'
import useToken from './hooks/useToken.js'

import ErrorBoundary from './components/ErrorBoundary.js'
import Main from './components/Main.js'

if (globalThis.env.isDemoMode === true) {
  console.warn('Ackee runs in demo mode')
}

const { statusLink, useLoading, useErrors } = createStatusLink()

const client = createClient([statusLink, createAuthLink(), createHttpLink()])

const App = () => {
  // Change the key to re-render the whole application. This will
  // reset the states of hooks inside the Main component and therefore
  // all existing GraphQL errors that occurred before the reset.
  // https://github.com/molindo/react-apollo-network-status/issues/45
  const [key, setKey] = useState(Date.now())

  const loading = useLoading()
  const router = useRouter()
  const token = useToken()
  const modals = useModals()
  const filters = useFilters()

  const reset = useCallback(() => {
    // Reset everything that has a local or saved state
    token.resetToken()
    modals.resetModals()
    filters.resetFilters()

    // Reset the cache of the client
    client.clearStore()

    // Reset the main component and the states it contains
    setKey(Date.now())
  }, [token.resetToken, modals.resetModals, filters.resetFilters, client.resetStore, setKey])

  useCustomScrollbar()
  useScrollReset(router.route)

  return h(
    ApolloProvider,
    { client },
    h(
      ErrorBoundary,
      {},
      h(Main, {
        key,
        reset,
        useErrors,
        loading,
        ...router,
        ...token,
        ...modals,
        ...filters,
      }),
    ),
  )
}

const container = document.querySelector('#main')
const root = createRoot(container)

root.render(h(App))
