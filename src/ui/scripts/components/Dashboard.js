import { createElement as h } from 'react'

import useDomains from '../api/hooks/domains/useDomains.js'
import * as routes from '../constants/routes.js'
import useHotkey from '../hooks/useHotkey.js'
import useRoute from '../hooks/useRoute.js'
import whenBelow from '../utils/whenBelow.js'

import Header, { createButton, createDropdown, createDropdownButton, createDropdownSeparator } from './Header.js'
import Modals from './modals/Modals.js'
import Tabs from './Tabs.js'
import UserMenu from './UserMenu.js'

import RouteBrowsers from './routes/RouteBrowsers.js'
import RouteDevices from './routes/RouteDevices.js'
import RouteDomain from './routes/RouteDomain.js'
import RouteDurations from './routes/RouteDurations.js'
import RouteEvents from './routes/RouteEvents.js'
import RouteCountries from './routes/RouteCountries.js'
import RouteLanguages from './routes/RouteLanguages.js'
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
  [routes.COUNTRIES]: RouteCountries,
  [routes.SETTINGS]: RouteSettings,
}

const gotoDomainWhenDefined = (domains, setRoute, index) => {
  const domain = domains[index]
  if (domain != null) setRoute(`/domains/${domain.id}`)
}

const Dashboard = (props) => {
  const currentRoute = useRoute(props.route)
  const domains = useDomains()

  useHotkey('o', () => props.setRoute('/'))
  useHotkey('v', () => props.setRoute('/insights/views'))
  useHotkey('p', () => props.setRoute('/insights/pages'))
  useHotkey('r', () => props.setRoute('/insights/referrers'))
  useHotkey('d', () => props.setRoute('/insights/durations'))
  useHotkey('e', () => props.setRoute('/insights/events'))
  useHotkey('c', () => props.setRoute('/insights/countries'))
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
    createDropdownButton('Systems', '/insights/systems', props.route, props.setRoute),
    createDropdownButton('Devices', '/insights/devices', props.route, props.setRoute),
    createDropdownButton('Browsers', '/insights/browsers', props.route, props.setRoute),
    createDropdownButton('Sizes', '/insights/sizes', props.route, props.setRoute),
    createDropdownButton('Languages', '/insights/languages', props.route, props.setRoute),
    createDropdownButton('Countries', '/insights/countries', props.route, props.setRoute, 'c'),
  ]

  // Settings is not here any more: it belongs to the person, so it lives in the menu
  // under their avatar on the right. The `s` shortcut still goes there.
  const items = [
    createButton('Overview', '/', props.route, props.setRoute),
    hasDomains === true ? createDropdown(domainsLabel, domainsItems) : undefined,
    createDropdown(insightsLabel, insightsItems),
  ].filter(Boolean)

  // The same sections as the Insights menu, in the open. The menu stays for its keyboard
  // shortcuts; the tabs are for finding things without opening anything first.
  const tabs = [
    { label: 'Overview', route: '/' },
    { label: 'Views', route: '/insights/views' },
    { label: 'Pages', route: '/insights/pages' },
    { label: 'Referrers', route: '/insights/referrers' },
    { label: 'Durations', route: '/insights/durations' },
    { label: 'Countries', route: '/insights/countries' },
    { label: 'Events', route: '/insights/events' },
    { label: 'Systems', route: '/insights/systems' },
    { label: 'Devices', route: '/insights/devices' },
    { label: 'Browsers', route: '/insights/browsers' },
    { label: 'Sizes', route: '/insights/sizes' },
    { label: 'Languages', route: '/insights/languages' },
  ]

  return h(
    'div',
    {},
    h(Modals, {
      modals: props.modals,
      removeModal: props.removeModal,
    }),
    h(
      Header,
      {
        loading: props.loading,
        items,
      },
      h(UserMenu, {
        token: props.token,
        reset: props.reset,
        setRoute: props.setRoute,
      }),
    ),
    // Hidden on the settings page and on a single domain, where the sections do not apply.
    props.route.startsWith('/settings') === false &&
      props.route.startsWith('/domains/') === false &&
      h(Tabs, {
        items: tabs,
        route: props.route,
        setRoute: props.setRoute,
      }),
    h(
      'main',
      { className: 'content' },
      h(routeComponents[currentRoute.key], {
        reset: props.reset,
        route: props.route,
        setRoute: props.setRoute,
        token: props.token,
        addModal: props.addModal,
        filters: props.filters,
      }),
    ),
  )
}

export default Dashboard
