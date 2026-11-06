import classNames from 'classnames'
import PropTypes from 'prop-types'
import { createElement as h, useEffect, useRef, useState } from 'react'

import { COMPACT_QUERY } from '../constants/compact.js'
import * as routes from '../constants/routes.js'
import { AUDIENCE, TRAFFIC, sectionOf } from '../constants/sections.js'
import useHotkey from '../hooks/useHotkey.js'
import useScope, { withScope } from '../hooks/useScope.js'
import whenBelow from '../utils/whenBelow.js'

import IconMenu from './icons/IconMenu.js'
import KeyHint from './KeyHint.js'

const Spinner = (props) => {
  return h('div', {
    className: classNames({
      'navigation__spinner': true,
      'navigation__spinner--white': props.color === 'white',
      'navigation__spinner--primary': props.color === 'primary',
      'navigation__spinner--visible': props.loading === true,
    }),
  })
}

const Logo = (props) => {
  return h(
    'div',
    { className: 'navigation__logo' },
    h(Spinner, { color: 'white', loading: props.loading }),
    h(Spinner, { color: 'primary', loading: props.loading }),
  )
}

const Item = (props) => {
  const hotkey = props.hotkey == null ? undefined : String(props.hotkey)
  // Read so the link follows the filters and the period of the address (ACKEE-24)
  useScope()

  return h(
    'li',
    {},
    h(
      'a',
      {
        'className': classNames({
          navigation__item: true,
          active: props.active === true,
        }),
        'href': withScope(`#${props.path}`),
        'title': props.title,
        'aria-current': props.active === true ? 'page' : undefined,
        'aria-keyshortcuts': hotkey,
        'onClick': props.onClick,
      },
      h('span', { className: 'navigation__label' }, props.label),
      // The key is announced by aria-keyshortcuts, so it is not read out as part of the name
      hotkey != null && h('div', { 'aria-hidden': true }, h(KeyHint, {}, hotkey)),
    ),
  )
}

Item.propTypes = {
  label: PropTypes.string.isRequired,
  path: PropTypes.string.isRequired,
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  hotkey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  title: PropTypes.string,
}

// Everything next to the element and next to its ancestors, which is the whole page but the element
const outsideOf = (element) => {
  const outside = []

  for (let node = element; node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node) outside.push(sibling)
    }
  }

  return outside
}

const Navigation = (props) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef()
  const toggleRef = useRef()
  const panelRef = useRef()
  const wasOpen = useRef(false)

  const close = () => setOpen(false)

  // A page picked by a key closes the menu just like one picked by a click
  useEffect(close, [props.route])

  // On a wide screen there is no menu to see, and one left open would keep the page inert
  useEffect(() => {
    const compact = globalThis.matchMedia(COMPACT_QUERY)
    const handleChange = () => {
      if (compact.matches === false) setOpen(false)
    }

    compact.addEventListener('change', handleChange)
    return () => compact.removeEventListener('change', handleChange)
  }, [])

  // Tab must not wander into the content under the backdrop. Elements that are inert already,
  // like those of another dialog, stay so.
  useEffect(() => {
    if (open === false) return

    const made = outsideOf(rootRef.current).filter((element) => element.inert === false)
    for (const element of made) element.inert = true

    return () => {
      for (const element of made) element.inert = false
    }
  }, [open])

  useEffect(() => {
    if (open === true) panelRef.current.querySelector('a').focus()

    // The picked link is hidden with the menu, and the focus would drop to the body with it
    if (open === false && wasOpen.current === true && panelRef.current.contains(document.activeElement)) {
      document.querySelector('#content').focus()
    }

    wasOpen.current = open
  }, [open])

  useHotkey(
    'escape',
    () => {
      setOpen(false)
      toggleRef.current.focus()
    },
    { enabled: open },
  )

  const section = sectionOf(props.routeKey)
  const item = (label, path, active, hotkey) => h(Item, { key: path, label, path, active, hotkey, onClick: close })

  return h(
    'div',
    {
      ref: rootRef,
      className: classNames({
        'navigation': true,
        'navigation--open': open === true,
      }),
    },
    h(
      'div',
      { className: 'navigation__bar' },
      h(Logo, { loading: props.loading }),
      h(
        'button',
        {
          'ref': toggleRef,
          'type': 'button',
          'className': 'navigation__toggle link',
          'aria-label': 'Menu',
          'aria-expanded': open,
          'aria-controls': 'navigation',
          'onClick': () => setOpen(!open),
        },
        h(IconMenu, { className: 'navigation__icon' }),
      ),
    ),
    open === true && h('div', { className: 'navigation__backdrop', onClick: close }),
    h(
      'nav',
      { 'ref': panelRef, 'id': 'navigation', 'className': 'navigation__panel', 'aria-label': 'Main' },
      h(
        'ul',
        { className: 'navigation__list' },
        item('Overview', '/', props.routeKey === routes.OVERVIEW, 'o'),
        item(TRAFFIC.label, TRAFFIC.tabs[0].path, section === TRAFFIC, TRAFFIC.tabs[0].hotkey),
        item('Events', '/insights/events', props.routeKey === routes.EVENTS, 'e'),
        item('Live', '/insights/live', props.routeKey === routes.LIVE, 'l'),
        item(AUDIENCE.label, AUDIENCE.tabs[0].path, section === AUDIENCE),
      ),
      // The domains scroll on their own, so a long list pushes neither the reports nor Settings away
      props.domains.length > 0 &&
        h(
          'div',
          { className: 'navigation__domains' },
          h('div', { id: 'navigation-domains', className: 'navigation__heading' }, 'Domains'),
          h(
            'ul',
            { 'className': 'navigation__list', 'aria-labelledby': 'navigation-domains' },
            props.domains.map((domain, index) =>
              h(Item, {
                key: domain.id,
                label: domain.title,
                title: domain.title,
                path: `/domains/${domain.id}`,
                active: props.route === `/domains/${domain.id}`,
                hotkey: whenBelow(index, 10),
                onClick: close,
              }),
            ),
          ),
        ),
      h(
        'ul',
        { className: 'navigation__list navigation__list--end' },
        item('Settings', '/settings', props.routeKey === routes.SETTINGS, 's'),
      ),
    ),
  )
}

Navigation.propTypes = {
  loading: PropTypes.bool.isRequired,
  route: PropTypes.string.isRequired,
  routeKey: PropTypes.symbol.isRequired,
  domains: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired, title: PropTypes.string.isRequired }))
    .isRequired,
}

export default Navigation
