import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import { homepage } from '../../../../../package.json'
import formatErrors from '../../utils/formatErrors.js'

import Headline from '../Headline.js'
import Message from '../Message.js'
import Spacer from '../Spacer.js'
import Text from '../Text.js'
import Textarea from '../Textarea.js'

const OverlayFailure = (props) => {
  // Keeps the session: a token that really failed ends on the login before this page
  const onClick = () => {
    globalThis.location.hash = ''
    globalThis.location.reload()
  }

  return h(
    'div',
    { className: 'card card--overlay' },
    h(
      'div',
      { className: 'card__inner align-center' },

      h(Spacer, { size: 2.4 }),

      h(
        Headline,
        {
          type: 'h1',
        },
        'Oops',
      ),
      h(
        Text,
        {
          type: 'p',
        },
        'Something went wrong.',
      ),

      h(Spacer, { size: 2.5 }),

      h(Message, { status: 'error' }, `Please report this issue on GitHub if you can't resolve it by yourself.`),

      h(Textarea, {
        rows: 6,
        value: formatErrors(props.errors),
        readOnly: true,
      }),

      h(Spacer, { size: 1 }),
    ),
    h(
      'div',
      { className: 'card__footer' },

      h(
        'a',
        {
          className: 'card__button link',
          href: homepage,
          target: '_blank',
          rel: 'noopener',
        },
        'Help',
      ),

      h('div', {
        className: 'card__separator',
      }),

      h(
        'button',
        {
          className: 'card__button card__button--primary link color-white',
          onClick,
        },
        'Reload Ackee',
      ),
    ),
  )
}

OverlayFailure.propTypes = {
  errors: PropTypes.array.isRequired,
}

export default OverlayFailure
