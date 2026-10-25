import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import Text from './Text.js'

// What to do next on a page that has nothing to show yet
const Hint = (props) => {
  return h(
    'div',
    { className: 'card' },
    h('div', { className: 'card__inner' }, h(Text, { type: 'p', spacing: false }, props.children)),
  )
}

Hint.propTypes = {
  children: PropTypes.node.isRequired,
}

export default Hint
