import PropTypes from 'prop-types'
import { createElement as h } from 'react'

const IconMenu = (props) => {
  return h(
    'svg',
    {
      viewBox: '0 0 512 512',
      className: props.className,
    },
    h('rect', { x: 48, y: 104, width: 416, height: 40, rx: 20 }),
    h('rect', { x: 48, y: 236, width: 416, height: 40, rx: 20 }),
    h('rect', { x: 48, y: 368, width: 416, height: 40, rx: 20 }),
  )
}

IconMenu.propTypes = {
  className: PropTypes.string,
}

export default IconMenu
