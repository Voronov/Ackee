import classNames from 'classnames'
import PropTypes from 'prop-types'
import { createElement as h, useState } from 'react'

import CurrentStatus from '../CurrentStatus.js'
import Headline from '../Headline.js'
import Text from '../Text.js'
import useScope, { exportParameters } from '../../hooks/useScope.js'
import useSource, { SOURCE_GA4 } from '../../hooks/useSource.js'
import downloadReport from '../../utils/downloadReport.js'

const CardStatistics = (props) => {
  const { value, status } = props.hook(...props.hookArgs)
  const source = useSource()
  const scope = useScope()

  // Use thin space as initial value to avoid that the label changes the height once rendered
  const [statusLabel, setStatusLabel] = useState(' ')
  const [exportFailed, setExportFailed] = useState(false)

  // The card of one domain saves what it shows (ACKEE-22): the same arguments, source, filters
  // and period. GA4 has no filters or periods, so its cards show and save without them.
  const download = (format) => {
    const [domainId, parameters] = props.hookArgs
    setExportFailed(false)
    const scoped = source === SOURCE_GA4 ? {} : exportParameters(scope)
    downloadReport(props.exportReport, format, { domainId, source, ...parameters, ...scoped }).catch(() =>
      setExportFailed(true),
    )
  }

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
      { className: classNames({ 'card__inner': true, 'card__inner--export': props.exportReport != null }) },
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
      props.exportReport != null &&
        h(
          'div',
          { className: 'card__export' },
          exportFailed === true && h('span', { role: 'status' }, 'Export failed'),
          ...['csv', 'json'].map((format) =>
            h(
              'button',
              {
                'key': format,
                'type': 'button',
                'className': 'card__exportButton link',
                'aria-label': `Download ${props.headline} as ${format.toUpperCase()}`,
                'onClick': () => download(format),
              },
              format.toUpperCase(),
            ),
          ),
        ),
      h(props.renderer, {
        ...props.rendererProps,
        items: value,
        setStatusLabel,
      }),
    ),
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
  exportReport: PropTypes.string,
}

export default CardStatistics
