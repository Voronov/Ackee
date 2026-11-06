import { createElement as h, useEffect, useState } from 'react'

import { PERIOD_MAX_DAYS } from '../../../constants/filters.js'
import useScope, { clearScope, isPeriod, isScoped, removeFilter, setPeriod } from '../hooks/useScope.js'

const LABELS = {
  SITE_LOCATION: 'Page',
  SITE_REFERRER: 'Referrer',
  SOURCE: 'Source',
  COUNTRY: 'Country',
  BROWSER_NAME: 'Browser',
  BROWSER_VERSION: 'Browser version',
  OS_NAME: 'System',
  OS_VERSION: 'System version',
  DEVICE_MANUFACTURER: 'Manufacturer',
  DEVICE_NAME: 'Device',
}

const countries = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })

const shown = ({ field, value }) => {
  if (value == null) return 'none'
  if (field !== 'COUNTRY') return value

  // A link can hold anything, and only a well-formed code has a name
  try {
    return countries.of(value)
  } catch {
    return value
  }
}

const problemOf = (from, to) => {
  if (from === '' || to === '') return 'Pick both days to apply the period.'
  if (from > to) return 'The period ends before it starts.'
  return `A period has at most ${PERIOD_MAX_DAYS} days.`
}

// The filters and the period of the reports (ACKEE-24), above them. A filter comes from a click
// on an entry of a list and goes with its ×; the period replaces the range of the lists.
const ScopeBar = () => {
  const scope = useScope()
  const [from, setFrom] = useState(scope.period?.from ?? '')
  const [to, setTo] = useState(scope.period?.to ?? '')

  // Back and forward change the address, the fields follow it
  useEffect(() => {
    setFrom(scope.period?.from ?? '')
    setTo(scope.period?.to ?? '')
  }, [scope.period])

  const apply = (nextFrom, nextTo) => {
    if (nextFrom === '' && nextTo === '') return setPeriod(null)
    if (isPeriod({ from: nextFrom, to: nextTo })) setPeriod({ from: nextFrom, to: nextTo })
  }

  const applied = scope.period == null ? '' : ` The reports still show ${scope.period.from} to ${scope.period.to}.`
  const differs = from !== (scope.period?.from ?? '') || to !== (scope.period?.to ?? '')

  return h(
    'div',
    { 'className': 'scopeBar', 'role': 'region', 'aria-label': 'Filters' },
    h(
      'ul',
      { className: 'scopeBar__filters' },
      scope.filters.map((filter) =>
        h(
          'li',
          { key: filter.field, className: 'scopeBar__filter' },
          h('span', { className: 'scopeBar__field' }, LABELS[filter.field] ?? filter.field),
          h('span', { className: 'scopeBar__value', title: shown(filter) }, shown(filter)),
          h(
            'button',
            {
              'type': 'button',
              'className': 'scopeBar__remove',
              'aria-label': `Remove the filter ${LABELS[filter.field] ?? filter.field}`,
              'onClick': () => removeFilter(filter.field),
            },
            '×',
          ),
        ),
      ),
    ),
    h(
      'div',
      { className: 'scopeBar__period' },
      h(
        'label',
        { className: 'scopeBar__day' },
        h('span', {}, 'From'),
        h('input', {
          type: 'date',
          className: 'input scopeBar__input',
          value: from,
          max: to || undefined,
          onChange: (event) => {
            setFrom(event.target.value)
            apply(event.target.value, to)
          },
        }),
      ),
      h(
        'label',
        { className: 'scopeBar__day' },
        h('span', {}, 'To'),
        h('input', {
          type: 'date',
          className: 'input scopeBar__input',
          value: to,
          min: from || undefined,
          onChange: (event) => {
            setTo(event.target.value)
            apply(from, event.target.value)
          },
        }),
      ),
      isScoped(scope) &&
        h('button', { type: 'button', className: 'scopeBar__clear link', onClick: clearScope }, 'Clear'),
    ),
    differs && h('p', { className: 'scopeBar__note', role: 'status' }, `${problemOf(from, to)}${applied}`),
  )
}

export default ScopeBar
