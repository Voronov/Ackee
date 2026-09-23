import classNames from 'classnames'
import PropTypes from 'prop-types'
import { createElement as h, useState } from 'react'

import CurrentStatus from '../CurrentStatus.js'
import ExportButtons from '../ExportButtons.js'
import Headline from '../Headline.js'
import Text from '../Text.js'

const CardStatistics = (props) => {
  const { value, status } = props.hook(...props.hookArgs)

  // Use thin space as initial value to avoid that the label changes the height once rendered
  const [statusLabel, setStatusLabel] = useState(' ')

  return h(
    'div',
    {
      className: classNames({
        'card': true,
        'card--wide': props.wide === true,
      }),
    },
    h(
      'div',
      { className: 'card__inner' },
      h(
        Headline,
        {
          type: 'h2',
          size: 'medium',
          onClick: props.onMore,
        },
        props.headline,
      ),
      h(
        Text,
        {
          type: 'div',
          spacing: false,
        },
        h(CurrentStatus, status, statusLabel),
      ),
      h(props.renderer, {
        ...props.rendererProps,
        items: value,
        setStatusLabel,
      }),
    ),
    // Only a card that shows one domain can be exported. The merged cards add up several
    // domains, and a file of those numbers would not say which domain each came from.
    props.exportAs != null && h(ExportButtons, props.exportAs),
  )
}

CardStatistics.propTypes = {
  wide: PropTypes.bool,
  headline: PropTypes.string.isRequired,
  onMore: PropTypes.func,
  hook: PropTypes.func.isRequired,
  hookArgs: PropTypes.array.isRequired,
  renderer: PropTypes.elementType.isRequired,
  rendererProps: PropTypes.object,
  exportAs: PropTypes.shape({
    domainId: PropTypes.string.isRequired,
    report: PropTypes.string.isRequired,
    range: PropTypes.string,
    limit: PropTypes.number,
  }),
}

export default CardStatistics
