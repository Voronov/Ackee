import {
  SIZES_TYPE_BROWSER_HEIGHT,
  SIZES_TYPE_BROWSER_RESOLUTION,
  SIZES_TYPE_BROWSER_WIDTH,
  SIZES_TYPE_SCREEN_HEIGHT,
  SIZES_TYPE_SCREEN_RESOLUTION,
  SIZES_TYPE_SCREEN_WIDTH,
} from '../../../constants/sizes.js'
import groupedRecords from './groupedRecords.js'

const properties = (type) => {
  if (type === SIZES_TYPE_BROWSER_WIDTH) return ['browserWidth']
  if (type === SIZES_TYPE_BROWSER_HEIGHT) return ['browserHeight']
  if (type === SIZES_TYPE_BROWSER_RESOLUTION) return ['browserWidth', 'browserHeight']
  if (type === SIZES_TYPE_SCREEN_WIDTH) return ['screenWidth']
  if (type === SIZES_TYPE_SCREEN_HEIGHT) return ['screenHeight']
  if (type === SIZES_TYPE_SCREEN_RESOLUTION) return ['screenWidth', 'screenHeight']
}

const toValue = (type) => (row) => {
  if (type === SIZES_TYPE_BROWSER_WIDTH) return `${row.browserWidth}px`
  if (type === SIZES_TYPE_BROWSER_HEIGHT) return `${row.browserHeight}px`
  if (type === SIZES_TYPE_BROWSER_RESOLUTION) return `${row.browserWidth}px x ${row.browserHeight}px`
  if (type === SIZES_TYPE_SCREEN_WIDTH) return `${row.screenWidth}px`
  if (type === SIZES_TYPE_SCREEN_HEIGHT) return `${row.screenHeight}px`
  if (type === SIZES_TYPE_SCREEN_RESOLUTION) return `${row.screenWidth}px x ${row.screenHeight}px`
}

export default (ids, sorting, type, range, limit, dateDetails) =>
  groupedRecords({
    ids,
    sorting,
    range,
    limit,
    dateDetails,
    properties: properties(type),
    toValue: toValue(type),
    idParts: [sorting, type, range, ...ids],
  })
