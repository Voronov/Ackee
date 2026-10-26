import { createElement as h } from 'react'

import useDomains from '../api/hooks/domains/useDomains.js'
import * as routes from '../constants/routes.js'
import useHotkey from '../hooks/useHotkey.js'
import useRoute from '../hooks/useRoute.js'
import whenBelow from '../utils/whenBelow.js'

import Header, { createButton, createDropdown, createDropdownButton, createDropdownSeparator } from './Header.js'
import DomainSelect from './DomainSelect.js'
import Modals from './modals/Modals.js'
import SourceSelect from './SourceSelect.js'

import { useGa4Connected } from '../api/hooks/ga4/useGa4.js'
import {
  SOURCE_ACKEE,
  SOURCE_BOTH,
  SOURCE_GA4,
  SourceContext,
  SplitContext,
  useSourceMode,
} from '../hooks/useSource.js'

import RouteBrowsers from './routes/RouteBrowsers.js'
import RouteDevices from './routes/RouteDevices.js'
import RouteDomain from './routes/RouteDomain.js'
import RouteDurations from './routes/RouteDurations.js'
import RouteEvents from './routes/RouteEvents.js'
import RouteLanguages from './routes/RouteLanguages.js'
import RouteLive from './routes/RouteLive.js'
import RouteOverview from './routes/RouteOverview.js'
import RoutePages from './routes/RoutePages.js'
import RouteReferrers from './routes/RouteReferrers.js'
import RouteSettings from './routes/RouteSettings.js'
import RouteSizes from './routes/RouteSizes.js'
import RouteSystems from './routes/RouteSystems.js'
import RouteViews from './routes/RouteViews.js'

const routeComponents = {
  [routes.OVERVIEW]: RouteOverview,
  [routes.DOMAIN]: RouteDomain,
  [routes.VIEWS]: RouteViews,
  [routes.PAGES]: RoutePages,
  [routes.REFERRERS]: RouteReferrers,
  [routes.DURATIONS]: RouteDurations,
  [routes.EVENTS]: RouteEvents,
  [routes.SYSTEMS]: RouteSystems,
  [routes.DEVICES]: RouteDevices,
  [routes.BROWSERS]: RouteBrowsers,
  [routes.SIZES]: RouteSizes,
  [routes.LANGUAGES]: RouteLanguages,
  [routes.LIVE]: RouteLive,
  [routes.SETTINGS]: RouteSettings,
}

// Routes that read the combined statistics. The domain page has its own domain, events belong to
// the workspace, and settings show no reports.
const PICKS_DOMAIN = new Set([
  routes.OVERVIEW,
  routes.VIEWS,
  routes.PAGES,
  routes.REFERRERS,
  routes.DURATIONS,
  routes.SYSTEMS,
  routes.DEVICES,
  routes.BROWSERS,
  routes.SIZES,
  routes.LANGUAGES,
])

// Pages that show reports, so the source switch belongs on them (ACKEE-21). Events are Ackee's own.
const READS_SOURCE = new Set([routes.DOMAIN, ...PICKS_DOMAIN])

const gotoDomainWhenDefined = (domains, setRoute, index) => {
  const domain = domains[index]
  if (domain != null) setRoute(`/domains/${domain.id}`)
}

const Dashboard = (props) => {
  const currentRoute = useRoute(props.route)
  const domains = useDomains()
  const ga4Connected = useGa4Connected()
  const sourceMode = useSourceMode()

  useHotkey('o', () => props.setRoute('/'))
  useHotkey('v', () => props.setRoute('/insights/views'))
  useHotkey('p', () => props.setRoute('/insights/pages'))
  useHotkey('r', () => props.setRoute('/insights/referrers'))
  useHotkey('d', () => props.setRoute('/insights/durations'))
  useHotkey('e', () => props.setRoute('/insights/events'))
  useHotkey('l', () => props.setRoute('/insights/live'))
  useHotkey('s', () => props.setRoute('/settings'))
  useHotkey('0,1,2,3,4,5,6,7,8,9', (event, { key }) => gotoDomainWhenDefined(domains.value, props.setRoute, key), {}, [
    domains.value,
  ])

  const hasDomains = domains.value.length > 0

  const domainsLabel = (activeItem) => (activeItem == null ? 'Domains' : activeItem.label)
  const insightsLabel = (activeItem) => (activeItem == null ? 'Insights' : activeItem.label)

  const domainsItems = domains.value.map((domain, index) =>
    createDropdownButton(domain.title, `/domains/${domain.id}`, props.route, props.setRoute, whenBelow(index, 10)),
  )

  const insightsItems = [
    createDropdownButton('Views', '/insights/views', props.route, props.setRoute, 'v'),
    createDropdownButton('Pages', '/insights/pages', props.route, props.setRoute, 'p'),
    createDropdownButton('Referrers', '/insights/referrers', props.route, props.setRoute, 'r'),
    createDropdownButton('Durations', '/insights/durations', props.route, props.setRoute, 'd'),
    createDropdownSeparator(),
    createDropdownButton('Events', '/insights/events', props.route, props.setRoute, 'e'),
    createDropdownSeparator(),
    createDropdownButton('Live', '/insights/live', props.route, props.setRoute, 'l'),
    createDropdownSeparator(),
    createDropdownButton('Systems', '/insights/systems', props.route, props.setRoute),
    createDropdownButton('Devices', '/insights/devices', props.route, props.setRoute),
    createDropdownButton('Browsers', '/insights/browsers', props.route, props.setRoute),
    createDropdownButton('Sizes', '/insights/sizes', props.route, props.setRoute),
    createDropdownButton('Languages', '/insights/languages', props.route, props.setRoute),
  ]

  const items = [
    createButton('Overview', '/', props.route, props.setRoute),
    hasDomains === true ? createDropdown(domainsLabel, domainsItems) : undefined,
    createDropdown(insightsLabel, insightsItems),
    createButton('Settings', '/settings', props.route, props.setRoute),
  ].filter(Boolean)

  const route = h(routeComponents[currentRoute.key], {
    reset: props.reset,
    route: props.route,
    setRoute: props.setRoute,
    token: props.token,
    addModal: props.addModal,
    filters: props.filters,
  })
  // Without a GA4 connection everything reads Ackee, so there is nothing to switch
  const showsSource = ga4Connected.value === true && READS_SOURCE.has(currentRoute.key)

  return h(
    'div',
    {},
    h(Modals, {
      modals: props.modals,
      removeModal: props.removeModal,
      addModal: props.addModal,
    }),
    h(Header, {
      loading: props.loading,
      items,
    }),
    h(
      'main',
      { className: 'content' },
      PICKS_DOMAIN.has(currentRoute.key) &&
        h(DomainSelect, { domains: domains.value, loaded: domains.status.isInitializing !== true }),
      showsSource && h(SourceSelect),
      showsSource &&
        sourceMode !== SOURCE_ACKEE &&
        h(
          'p',
          { className: 'sourceNote' },
          'Google Analytics data arrives with a delay: the Google API reports hours and days that are already counted, not the last minutes.',
        ),
      ...(showsSource && sourceMode === SOURCE_BOTH
        ? [
            h(
              'div',
              { key: 'both', className: 'sourceSplit' },
              ...[
                [SOURCE_ACKEE, 'Ackee'],
                [SOURCE_GA4, 'Google Analytics'],
              ].map(([source, label]) =>
                h(
                  SourceContext.Provider,
                  { key: source, value: source },
                  h(
                    SplitContext.Provider,
                    { value: true },
                    h(
                      'div',
                      { className: 'sourceSplit__half' },
                      h('h2', { className: 'sourceSplit__title' }, label),
                      route,
                    ),
                  ),
                ),
              ),
            ),
          ]
        : // Where the switch is not shown, a choice remembered from elsewhere must not empty the page
          [showsSource ? route : h(SourceContext.Provider, { key: 'own', value: SOURCE_ACKEE }, route)]),
    ),
  )
}

export default Dashboard
