import PropTypes from 'prop-types'
import { Fragment, createElement as h, useRef, useState } from 'react'

import useViewer from '../api/hooks/users/useViewer.js'
import useDeleteToken from '../api/hooks/tokens/useDeleteToken.js'
import initials from '../utils/initials.js'

import Context, { BUTTON, CONTENT, SEPARATOR } from './Context.js'

// The menu opens under the avatar and is pinned to its right edge, so it never runs off
// the screen on a narrow window.
const calculateX = (measurement) => {
  const padding = 10

  return Math.max(
    padding,
    Math.min(
      measurement.body.width - measurement.element.width - padding,
      measurement.target.absolute.x + measurement.target.width - measurement.element.width,
    ),
  )
}

const calculateY = (measurement) => measurement.target.absolute.y + measurement.target.height + 10

const UserMenu = (props) => {
  const ref = useRef()
  const [open, setOpen] = useState(false)

  const { viewer } = useViewer()
  const deleteToken = useDeleteToken()

  const close = () => setOpen(false)

  const signOut = async () => {
    // The token is removed on the server as well, so signing out on one machine does not
    // leave a working session behind on another.
    await deleteToken.mutate({ variables: { id: props.token } })
    props.reset()
  }

  const items = [
    { type: CONTENT, children: viewer?.email ?? 'Signed in' },
    { type: SEPARATOR },
    { type: BUTTON, label: 'Settings', onClick: () => props.setRoute('/settings') },
    { type: SEPARATOR },
    { type: BUTTON, label: 'Sign out', onClick: signOut },
  ]

  return h(
    Fragment,
    {},
    h(
      'button',
      {
        ref,
        'className': 'header__avatar link',
        'onClick': () => setOpen(open === false),
        // The initials say little on their own, so the address is in the title as well.
        'title': viewer?.email,
        'aria-label': viewer?.email == null ? 'Account' : `Account: ${viewer.email}`,
      },
      initials(viewer?.email),
    ),
    open === true &&
      h(Context, {
        targetRef: ref,
        x: calculateX,
        y: calculateY,
        items,
        onItemClick: close,
        onAwayClick: close,
      }),
  )
}

UserMenu.propTypes = {
  token: PropTypes.string,
  reset: PropTypes.func.isRequired,
  setRoute: PropTypes.func.isRequired,
}

export default UserMenu
