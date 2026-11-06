import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import ListRow from './ListRow.js'
import sumByProperty from '../../utils/sumByProperty.js'

const Row = (props) => {
  return h(
    ListRow,
    {
      className: 'flexList__row',
      url: props.url,
      filter: props.filter,
      label: props.text,
    },
    h(
      'div',
      {
        className:
          'flexList__column flexList__column--text-adjustment flexList__column--fixed-width flexList__column--spacing-left flexList__column--spacing-right',
        style: { '--width': `${props.counterWidth}px` },
      },
      h('div', { className: 'flexList__bar flexList__bar--counter', style: { '--width': `${props.barWidth}%` } }),
      h('span', { className: 'color-primary' }, `${props.count}`),
    ),
    h(
      'div',
      { className: 'flexList__column flexList__column--text-adjustment' },
      h('span', { className: 'flexList__truncated' }, props.text),
    ),
  )
}

const PresentationCounterList = (props) => {
  const totalCount = props.items.reduce(sumByProperty('count'), 0)
  const proportionalWidth = ({ count }) => (count / totalCount) * 100

  const counterWidth = props.items.reduce((maxWidth, item) => {
    const formattedCount = props.formatter(item.count)
    const formattedLength = String(formattedCount).length

    const averageCharacterWidth = 9
    const formattedWidth = formattedLength * averageCharacterWidth

    if (formattedWidth > maxWidth) return formattedWidth
    return maxWidth
  }, 0)

  return h(
    'div',
    { className: 'flexList' },
    h(
      'div',
      { className: 'flexList__inner' },
      props.items.map((item, index) =>
        h(Row, {
          key: item.text + index,
          barWidth: proportionalWidth(item),
          counterWidth,
          count: props.formatter(item.count),
          url: item.url,
          filter: item.filter,
          text: item.text,
        }),
      ),
    ),
  )
}

PresentationCounterList.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      url: PropTypes.object,
      text: PropTypes.string.isRequired,
      count: PropTypes.number.isRequired,
    }),
  ).isRequired,
  formatter: PropTypes.func.isRequired,
}

export default PresentationCounterList
