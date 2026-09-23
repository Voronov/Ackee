import classNames from 'classnames'
import PropTypes from 'prop-types'
import { createElement as h } from 'react'

/*
 * The sections, laid out in the open instead of inside a dropdown.
 *
 * The header keeps its menu for keyboard shortcuts and for narrow screens, but a list of
 * twelve sections behind a dropdown means every move costs two clicks and a guess about
 * what is in there.
 */
const Tabs = (props) => {
  return h(
    'nav',
    { 'className': 'tabs', 'aria-label': 'Sections' },
    h(
      'div',
      { className: 'tabs__inner' },
      props.items.map((item) =>
        h(
          'button',
          {
            'key': item.route,
            'type': 'button',
            'className': classNames({ 'tabs__tab': true, 'tabs__tab--active': item.route === props.route }),
            'aria-current': item.route === props.route ? 'page' : undefined,
            'onClick': () => props.setRoute(item.route),
          },
          item.label,
        ),
      ),
    ),
  )
}

Tabs.propTypes = {
  items: PropTypes.array.isRequired,
  route: PropTypes.string.isRequired,
  setRoute: PropTypes.func.isRequired,
}

export default Tabs
