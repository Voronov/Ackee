import { createContext, useContext, useSyncExternalStore } from 'react'

import createStorage from '../utils/createStorage.js'

// Where the reports read from (ACKEE-21): Ackee, Google Analytics 4, or both side by side.
export const SOURCE_ACKEE = 'ACKEE'
export const SOURCE_GA4 = 'GA4'
export const SOURCE_BOTH = 'BOTH'

const storage = createStorage('ackee_source', SOURCE_ACKEE)
let mode = storage.get()
const listeners = new Set()

export const setSourceMode = (next) => {
  mode = next === SOURCE_ACKEE ? storage.reset() : storage.set(next)
  for (const listener of listeners) listener()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useSourceMode = () => useSyncExternalStore(subscribe, () => mode)

// The source of the reports below. With both shown, each half of the page provides its own.
export const SourceContext = createContext(null)

// True inside the two halves of the side-by-side view
export const SplitContext = createContext(false)

export default () => {
  const provided = useContext(SourceContext)
  const selected = useSourceMode()

  if (provided != null) return provided
  return selected === SOURCE_GA4 ? SOURCE_GA4 : SOURCE_ACKEE
}
