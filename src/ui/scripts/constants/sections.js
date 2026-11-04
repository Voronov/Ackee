import * as routes from './routes.js'

// Reports that belong together share a section of the navigation and switch with tabs. The
// routes stay the ones of v1.0, so links and keys keep working.
export const TRAFFIC = {
  label: 'Traffic',
  tabs: [
    { key: routes.VIEWS, label: 'Views', path: '/insights/views', hotkey: 'v' },
    { key: routes.PAGES, label: 'Pages', path: '/insights/pages', hotkey: 'p' },
    { key: routes.REFERRERS, label: 'Referrers', path: '/insights/referrers', hotkey: 'r' },
    { key: routes.DURATIONS, label: 'Durations', path: '/insights/durations', hotkey: 'd' },
  ],
}

export const AUDIENCE = {
  label: 'Audience',
  tabs: [
    { key: routes.SYSTEMS, label: 'Systems', path: '/insights/systems' },
    { key: routes.DEVICES, label: 'Devices', path: '/insights/devices' },
    { key: routes.BROWSERS, label: 'Browsers', path: '/insights/browsers' },
    { key: routes.SIZES, label: 'Sizes', path: '/insights/sizes' },
    { key: routes.LANGUAGES, label: 'Languages', path: '/insights/languages' },
    { key: routes.COUNTRIES, label: 'Countries', path: '/insights/countries' },
  ],
}

export const sectionOf = (routeKey) =>
  [TRAFFIC, AUDIENCE].find((section) => section.tabs.some((tab) => tab.key === routeKey))
