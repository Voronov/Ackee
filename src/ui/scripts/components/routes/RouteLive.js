import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import useDomains from '../../api/hooks/domains/useDomains.js'
import useLiveVisits, {
  LIVE_CONNECTING,
  LIVE_OPEN,
  LIVE_PAUSED,
  LIVE_RECONNECTING,
  LIVE_STOPPED,
} from '../../hooks/useLiveVisits.js'

import Headline from '../Headline.js'
import Message from '../Message.js'
import Spacer from '../Spacer.js'
import Status, { ICON_LOADER, ICON_UPDATER } from '../Status.js'
import Text from '../Text.js'
import TextBadge from '../TextBadge.js'

const statusLabels = {
  [LIVE_CONNECTING]: [ICON_LOADER, 'Connecting'],
  [LIVE_OPEN]: [ICON_UPDATER, 'Live'],
  [LIVE_RECONNECTING]: [ICON_LOADER, 'Reconnecting'],
  [LIVE_PAUSED]: [undefined, 'Paused while the tab is hidden'],
  [LIVE_STOPPED]: [undefined, 'Stopped'],
}

const parseUrl = (value) => {
  try {
    return new URL(value)
  } catch {
    return
  }
}

// Only web addresses become links: the location comes from the tracker, which anyone can call
const isWebUrl = (url) => url != null && (url.protocol === 'https:' || url.protocol === 'http:')

const pageLabel = (url, value) => (url == null ? value : `${url.host}${url.pathname}${url.search}`)

const referrerLabel = (visit) => {
  if (visit.source != null) return visit.source
  if (visit.siteReferrer == null) return

  return parseUrl(visit.siteReferrer)?.host ?? visit.siteReferrer
}

const details = (visit) => {
  const referrer = referrerLabel(visit)
  const device = [visit.deviceManufacturer, visit.deviceName].filter(Boolean).join(' ')

  return [
    referrer == null ? undefined : `from ${referrer}`,
    visit.browserName,
    visit.osName,
    device,
    visit.siteLanguage,
  ].filter(Boolean)
}

const formatTime = (date) =>
  date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const VisitRow = (props) => {
  const { visit, domainTitle } = props
  const created = new Date(visit.created)
  const url = parseUrl(visit.siteLocation)
  const label = pageLabel(url, visit.siteLocation)
  const linked = isWebUrl(url)

  return h(
    'div',
    { className: 'live__row' },
    h(
      'time',
      { className: 'live__time', dateTime: visit.created, title: created.toLocaleString() },
      formatTime(created),
    ),
    h(
      'div',
      { className: 'live__main' },
      h(
        linked === true ? 'a' : 'span',
        {
          className: 'live__page',
          title: visit.siteLocation,
          ...(linked === true ? { href: url.href, target: '_blank', rel: 'noopener noreferrer' } : {}),
        },
        label,
      ),
      h('div', { className: 'live__details' }, details(visit).join(' · ')),
    ),
    h('div', { className: 'live__domain' }, h(TextBadge, { type: 'neutral', value: domainTitle })),
  )
}

VisitRow.propTypes = {
  visit: PropTypes.shape({
    siteLocation: PropTypes.string.isRequired,
    siteReferrer: PropTypes.string,
    source: PropTypes.string,
    siteLanguage: PropTypes.string,
    browserName: PropTypes.string,
    osName: PropTypes.string,
    deviceManufacturer: PropTypes.string,
    deviceName: PropTypes.string,
    created: PropTypes.string.isRequired,
  }).isRequired,
  domainTitle: PropTypes.string.isRequired,
}

const GapRow = () => {
  return h(
    'div',
    { className: 'live__row live__row--gap' },
    'More views came in than the feed can show at once. Some of them were skipped.',
  )
}

const EmptyState = () => {
  return h(
    'div',
    { className: 'live__empty' },
    h(
      Text,
      { type: 'p', spacing: false },
      'Waiting for new views. The feed shows views as they come in, use the reports for older ones.',
    ),
  )
}

const RouteLive = (props) => {
  const domains = useDomains()
  const live = useLiveVisits(props.token, props.reset)

  const titles = new Map(domains.value.map((domain) => [domain.id, domain.title]))
  // A domain added in another tab is in the feed before it is in the cached list of domains
  const domainTitle = (domainId) => titles.get(domainId) ?? 'New domain'

  const [icon, statusLabel] = statusLabels[live.status]
  const hasMessage = live.message != null

  const rows = live.visits.map((visit) =>
    visit.gap === true
      ? h(GapRow, { key: visit.key })
      : h(VisitRow, { key: visit.key, visit, domainTitle: domainTitle(visit.domainId) }),
  )

  return h(
    'div',
    { className: 'card card--wide' },
    h(
      'div',
      { className: 'card__inner' },
      h(Headline, { type: 'h2', size: 'medium' }, 'Live'),
      h(Text, { type: 'div', spacing: false }, h(Status, { icon }, statusLabel)),
      h(Spacer, { size: 1.6 }),
      hasMessage === true && h(Message, { status: live.status === LIVE_STOPPED ? 'error' : 'warning' }, live.message),
      rows.length === 0 ? h(EmptyState) : h('div', { className: 'live' }, rows),
      h(Spacer, { size: 1 }),
      h(
        Text,
        { type: 'p', spacing: false, className: 'live__hint color-light' },
        'Ackee ignores your own views in this browser. Open your site in a private window to see one come in.',
      ),
    ),
  )
}

RouteLive.propTypes = {
  token: PropTypes.string.isRequired,
  reset: PropTypes.func.isRequired,
}

export default RouteLive
