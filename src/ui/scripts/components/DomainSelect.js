import PropTypes from 'prop-types'
import { createElement as h, useEffect } from 'react'

import useSelectedDomain, { setSelectedDomain } from '../hooks/useSelectedDomain.js'
import Select from './Select.js'

const ALL = ''

// Picks which domain the overview and insights show (ACKEE-81). Hidden with a single domain:
// there is nothing to pick.
const DomainSelect = (props) => {
  const selected = useSelectedDomain()
  const known = props.domains.some((domain) => domain.id === selected)

  // A domain the viewer lost access to, or one that was deleted, falls back to all domains
  useEffect(() => {
    if (props.loaded === true && selected != null && known === false) setSelectedDomain(null)
  }, [props.loaded, selected, known])

  if (props.domains.length < 2) return null

  const items = [
    { value: ALL, label: 'All domains' },
    ...props.domains.map((domain) => ({ value: domain.id, label: domain.title })),
  ]

  return h(
    'div',
    { className: 'domainSelect' },
    h(Select, {
      id: 'domain-select',
      value: known === true ? selected : ALL,
      items,
      onChange: (event) => setSelectedDomain(event.target.value === ALL ? null : event.target.value),
    }),
  )
}

DomainSelect.propTypes = {
  domains: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired, title: PropTypes.string.isRequired }))
    .isRequired,
  loaded: PropTypes.bool.isRequired,
}

export default DomainSelect
