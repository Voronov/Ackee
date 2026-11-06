import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import enhanceUrl from '../../enhancers/enhanceUrl.js'
import { addFilters } from '../../hooks/useScope.js'

/*
 * The row of a list. An entry with a filter (ACKEE-24) is a button that narrows every report to
 * it; its address, when it has one, opens from the arrow next to it, as a link cannot sit in a
 * button. Entries without a filter, like those of GA4, stay as they were.
 */
const ListRow = (props) => {
  const href = props.url == null ? undefined : enhanceUrl(props.url).href
  const hover = { onMouseEnter: props.onEnter, onMouseLeave: props.onLeave }

  if (props.filter == null) {
    const link = href == null ? {} : { href, target: '_blank', rel: 'noopener' }
    return h(
      href == null ? (props.as ?? 'div') : 'a',
      { className: props.className, ...hover, ...link },
      props.children,
    )
  }

  return h(
    'div',
    { className: `${props.className} flexList__row--filter`, ...hover },
    h(
      'button',
      {
        type: 'button',
        className: 'flexList__filter',
        title: `Show the reports of ${props.label} only`,
        onClick: () => addFilters(props.filter),
      },
      props.children,
    ),
    href != null &&
      h(
        'a',
        {
          'className': 'flexList__open',
          href,
          'target': '_blank',
          'rel': 'noopener',
          'aria-label': `Open ${props.label}`,
        },
        '↗',
      ),
  )
}

ListRow.propTypes = {
  className: PropTypes.string.isRequired,
  as: PropTypes.string,
  url: PropTypes.object,
  filter: PropTypes.arrayOf(PropTypes.shape({ field: PropTypes.string.isRequired, value: PropTypes.string })),
  label: PropTypes.string.isRequired,
  onEnter: PropTypes.func,
  onLeave: PropTypes.func,
  children: PropTypes.node.isRequired,
}

export default ListRow
