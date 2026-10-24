import { useSyncExternalStore } from 'react'

import createStorage from '../utils/createStorage.js'

// The domain picked on the dashboard (ACKEE-81), null for all of them. Kept outside React
// state, so every report hook reads the same value without passing it through each route.
const storage = createStorage('ackee_selected_domain', null)

let selected = storage.get()
const listeners = new Set()

export const setSelectedDomain = (domainId) => {
  selected = domainId == null ? storage.reset() : storage.set(domainId)
  for (const listener of listeners) listener()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export default () => useSyncExternalStore(subscribe, () => selected)
