import PropTypes from 'prop-types'
import { Fragment, createElement as h, useState } from 'react'

import downloadReport from '../utils/downloadReport.js'

// The footer of a report card: the same numbers the card shows, in a file.
const ExportButtons = (props) => {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const save = (format) => async () => {
    setBusy(format)
    setError(null)

    try {
      await downloadReport(props.domainId, props.report, format, { range: props.range, limit: props.limit })
    } catch (downloadError) {
      setError(downloadError.message)
    } finally {
      setBusy(null)
    }
  }

  const button = (format, label) =>
    h(
      'button',
      {
        type: 'button',
        className: 'card__button card__button--primary link align-center',
        disabled: busy != null,
        onClick: save(format),
      },
      busy === format ? 'Saving…' : label,
    )

  return h(
    Fragment,
    {},
    error != null &&
      h('div', { className: 'card__footer' }, h('div', { className: 'card__button color-destructive' }, error)),
    h(
      'div',
      { className: 'card__footer' },
      button('csv', 'Export CSV'),
      h('div', { className: 'card__separator' }),
      button('json', 'Export JSON'),
    ),
  )
}

ExportButtons.propTypes = {
  domainId: PropTypes.string.isRequired,
  report: PropTypes.string.isRequired,
  range: PropTypes.string,
  limit: PropTypes.number,
}

export default ExportButtons
