import PropTypes from 'prop-types'
import { createElement as h, useContext } from 'react'

import formatDuration from '../../utils/formatDuration.js'
import formatNumber from '../../utils/formatNumber.js'
import pluralize from '../../utils/pluralize.js'

import useSource, { SOURCE_GA4, SplitContext } from '../../hooks/useSource.js'

import ChangeBadge from '../ChangeBadge.js'
import Headline from '../Headline.js'
import PresentationValueUnit from '../presentations/PresentationValueUnit.js'
import TextBadge from '../TextBadge.js'

const Presentation = (props) => {
  return h(
    'div',
    { className: 'facts__card' },
    h(
      Headline,
      {
        type: 'h2',
        size: 'small',
        className: 'facts__top',
      },
      props.headline,
    ),
    h(
      'div',
      {
        className: 'facts__left',
        title: props.title,
      },
      h(PresentationValueUnit, {
        value: props.value,
        unit: props.unit,
      }),
    ),
    props.addition != null &&
      h(
        'div',
        {
          className: 'facts__right',
        },
        props.addition,
      ),
  )
}

const CardFacts = (props) => {
  const { value } = props.hook(...props.hookArgs)
  // Google Analytics has no active visitors, and beside it the two halves must show the same cards
  const source = useSource()
  const isSplit = useContext(SplitContext)
  const showsLive = source !== SOURCE_GA4 && isSplit === false

  const { activeVisitors, averageViews, averageDuration, viewsToday, viewsMonth, viewsYear } = value

  return h(
    'div',
    {
      className: 'facts',
    },
    showsLive &&
      h(Presentation, {
        headline: 'Active visitors',
        value: activeVisitors,
        unit: pluralize(['visitors', 'visitor', 'visitors'], activeVisitors),
        addition: h(TextBadge, { type: 'positive', value: 'Live' }),
      }),
    h(Presentation, {
      headline: 'Average views',
      value: formatNumber(averageViews.count),
      unit: 'per day',
      title: `An average of ${averageViews.count} views per day during the last 14 days`,
      addition: averageViews.change != null && h(ChangeBadge, { value: averageViews.change }),
    }),
    h(Presentation, {
      headline: 'Average duration',
      value: formatDuration(averageDuration.count).value,
      unit: formatDuration(averageDuration.count).unit,
      title: `An average visit duration of ${formatDuration(averageDuration.count).value}${formatDuration(averageDuration.count).unit} per day during the last 14 days`,
      addition: averageDuration.change != null && h(ChangeBadge, { value: averageDuration.change }),
    }),
    h(Presentation, {
      headline: 'Views today',
      value: formatNumber(viewsToday),
      unit: pluralize(['views', 'view', 'views'], viewsToday),
    }),
    h(Presentation, {
      headline: 'Views this month',
      value: formatNumber(viewsMonth),
      unit: pluralize(['views', 'view', 'views'], viewsMonth),
    }),
    h(Presentation, {
      headline: 'Views this year',
      value: formatNumber(viewsYear),
      unit: pluralize(['views', 'view', 'views'], viewsYear),
    }),
  )
}

CardFacts.propTypes = {
  hook: PropTypes.func.isRequired,
  hookArgs: PropTypes.array.isRequired,
}

export default CardFacts
