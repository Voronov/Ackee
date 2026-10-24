import { createElement as h } from 'react'

import { SOURCE_ACKEE, SOURCE_BOTH, SOURCE_GA4, setSourceMode, useSourceMode } from '../hooks/useSource.js'
import Select from './Select.js'

const ITEMS = [
  { value: SOURCE_ACKEE, label: 'Ackee' },
  { value: SOURCE_GA4, label: 'Google Analytics' },
  { value: SOURCE_BOTH, label: 'Ackee and Google Analytics' },
]

// Which numbers the reports show (ACKEE-21). Shown once a domain is connected to GA4.
const SourceSelect = () =>
  h(
    'div',
    { className: 'sourceSelect' },
    h(Select, {
      id: 'source-select',
      value: useSourceMode(),
      items: ITEMS,
      onChange: (event) => setSourceMode(event.target.value),
    }),
  )

export default SourceSelect
