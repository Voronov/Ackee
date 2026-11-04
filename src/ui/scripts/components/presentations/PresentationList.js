import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import ListRow from './ListRow.js'

const Row = (props) => {
  return h(
    ListRow,
    {
      className: 'flexList__row flexList__row--has-hover',
      url: props.url,
      filter: props.filter,
      label: props.text,
      onEnter: props.onEnter,
      onLeave: props.onLeave,
    },
    h(
      'div',
      { className: 'flexList__column flexList__column--text-adjustment' },
      h('span', { className: 'flexList__truncated', title: props.text }, props.text),
    ),
  )
}

const PresentationList = (props) => {
  return h(
    'div',
    { className: 'flexList' },
    h(
      'div',
      { className: 'flexList__inner' },
      props.items.map((item, index) =>
        h(Row, {
          key: item.text + index,
          onEnter: () => props.onItemEnter(index),
          onLeave: () => props.onItemLeave(index),
          ...item,
        }),
      ),
    ),
  )
}

PresentationList.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      url: PropTypes.object,
      text: PropTypes.string.isRequired,
    }),
  ).isRequired,
  onItemEnter: PropTypes.func.isRequired,
  onItemLeave: PropTypes.func.isRequired,
}

export default PresentationList
