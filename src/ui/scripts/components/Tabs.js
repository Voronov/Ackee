import classNames from 'classnames'
import PropTypes from 'prop-types'
import { createElement as h, useRef } from 'react'

import KeyHint from './KeyHint.js'

// Every tab is a route of its own, so a tab is picked the moment it gets the focus: the address,
// the history and the keys of the reports stay as they were.
const Tabs = (props) => {
  const refs = useRef([])
  const last = props.tabs.length - 1

  // The tab that is open already would only add the same page to the history once more
  const open = (index) => {
    if (props.tabs[index].key !== props.routeKey) props.setRoute(props.tabs[index].path)
  }

  const select = (index) => {
    open(index)
    refs.current[index].focus()
  }

  const handleKeyDown = (event, index) => {
    // With a modifier the arrows belong to the browser, like going back
    if (event.altKey || event.metaKey || event.ctrlKey) return

    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key]

    if (target == null) return

    event.preventDefault()
    select(target)
  }

  return h(
    'div',
    { className: 'tabs' },
    h(
      'div',
      { 'className': 'tabs__list', 'role': 'tablist', 'aria-label': props.label },
      props.tabs.map((tab, index) => {
        const selected = tab.key === props.routeKey

        return h(
          'button',
          {
            'key': tab.path,
            'ref': (element) => {
              refs.current[index] = element
            },
            'type': 'button',
            'role': 'tab',
            'className': classNames({
              'tabs__tab': true,
              'link': true,
              'active': selected === true,
              'color-white': selected === true,
            }),
            'aria-selected': selected,
            'aria-keyshortcuts': tab.hotkey,
            'tabIndex': selected === true ? 0 : -1,
            'onClick': () => open(index),
            'onKeyDown': (event) => handleKeyDown(event, index),
          },
          tab.label,
          tab.hotkey != null && h('div', { 'aria-hidden': true }, h(KeyHint, {}, tab.hotkey)),
        )
      }),
    ),
  )
}

Tabs.propTypes = {
  label: PropTypes.string.isRequired,
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.symbol.isRequired,
      label: PropTypes.string.isRequired,
      path: PropTypes.string.isRequired,
      hotkey: PropTypes.string,
    }),
  ).isRequired,
  routeKey: PropTypes.symbol.isRequired,
  setRoute: PropTypes.func.isRequired,
}

export default Tabs
