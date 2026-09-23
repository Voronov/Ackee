import { getChart, getList } from '../../database/actions.js'
import browsersReport from '../../database/browsers.js'
import countriesReport from '../../database/countries.js'
import devicesReport from '../../database/devices.js'
import durationsReport from '../../database/durations.js'
import activeVisitorsReport from '../../database/facts.js'
import languagesReport from '../../database/languages.js'
import pagesReport from '../../database/pages.js'
import referrersReport from '../../database/referrers.js'
import sizesReport from '../../database/sizes.js'
import systemsReport from '../../database/systems.js'
import viewsReport from '../../database/views.js'
import { timeReport } from '../../utils/metrics.js'

export { add as addRecord, update as touchRecord, anonymize, del as deleteRecords } from '../../database/records.js'
export { add as addAction, update as touchAction, del as deleteActions } from '../../database/actions.js'

// There is no second store to bring up to date
export const mirrorRecord = async () => {}
export const mirrorAction = async () => {}

const timed = (report, fn) => timeReport(report, 'mongo', fn)

export const views = timed('views', viewsReport)
export const pages = timed('pages', pagesReport)
export const referrers = timed('referrers', referrersReport)
export const durations = timed('durations', durationsReport)
export const systems = timed('systems', systemsReport)
export const devices = timed('devices', devicesReport)
export const browsers = timed('browsers', browsersReport)
export const sizes = timed('sizes', sizesReport)
export const languages = timed('languages', languagesReport)
export const countries = timed('countries', countriesReport)
export const activeVisitors = timed('activeVisitors', activeVisitorsReport)
export const actionsChart = timed('actionsChart', getChart)
export const actionsList = timed('actionsList', getList)
