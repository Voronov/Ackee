import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useLiveFeed from '../../hooks/useLiveFeed.js'
import flag from '../../utils/countryFlag.js'

import Headline from '../Headline.js'
import Text from '../Text.js'

// The path is what tells one visit from another. The host is the same for every row on
// this card, so showing it would only push the path out of view.
const pathOf = (siteLocation) => {
  try {
    const { pathname, search } = new URL(siteLocation)

    return `${pathname}${search}`
  } catch {
    return siteLocation
  }
}

// Where the visit came from, in the fewest words that still say it.
const originOf = (visit) => {
  if (visit.source != null) return visit.source
  if (visit.siteReferrer == null) return 'Direct'

  try {
    return new URL(visit.siteReferrer).hostname.replace(/^www\./, '')
  } catch {
    return visit.siteReferrer
  }
}

const deviceOf = (visit) => [visit.browserName, visit.osName].filter(Boolean).join(' · ')

// A plain builder rather than a component: the row has no state, and a component here
// would only add a layer between the list and its flex layout.
const row = (visit) =>
  h(
    'div',
    { key: visit.id, className: 'flexList__row live__row' },
    h('div', { className: 'live__flag' }, flag(visit.country) || '·'),
    h(
      'div',
      { className: 'flexList__column flexList__column--text-adjustment live__path' },
      h('span', { className: 'flexList__truncated', title: visit.siteLocation }, pathOf(visit.siteLocation)),
    ),
    h('div', { className: 'live__meta' }, h('span', { className: 'flexList__truncated' }, originOf(visit))),
    h(
      'div',
      { className: 'live__meta live__meta--device' },
      h('span', { className: 'flexList__truncated' }, deviceOf(visit)),
    ),
  )

const CardLive = (props) => {
  const { items, connected } = useLiveFeed(props.domainId)

  return h(
    'div',
    { className: 'card card--wide' },
    h(
      'div',
      { className: 'card__inner' },
      h('div', { className: 'card__group' }, h(Headline, { type: 'h2', size: 'medium' }, 'Live')),
      h(
        Text,
        { type: 'div', spacing: false },
        h(
          'div',
          { className: 'status' },
          h('span', {
            className: connected === true ? 'live__dot live__dot--on' : 'live__dot',
          }),
          connected === true ? 'Listening for visits' : 'Reconnecting…',
        ),
      ),
      items.length === 0
        ? h(
            'div',
            { className: 'emptyState' },
            h(Text, { type: 'div', spacing: false }, 'Visits appear here the moment they happen.'),
          )
        : h(
            'div',
            { className: 'flexList' },
            h(
              'div',
              { className: 'flexList__inner' },
              items.map((visit) => row(visit)),
            ),
          ),
    ),
  )
}

CardLive.propTypes = {
  domainId: PropTypes.string.isRequired,
}

export default CardLive
