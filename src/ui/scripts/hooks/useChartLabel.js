import relativeFn from '../utils/relativeFn.js'
import useScope, { periodLabel } from './useScope.js'
import useSource, { SOURCE_GA4 } from './useSource.js'

// Names a bar of a chart of views or durations. GA4 has no periods, its bars still end today.
export default (interval) => {
  const { period } = useScope()
  const source = useSource()

  if (period == null || source === SOURCE_GA4) return relativeFn(interval)
  return (offset) => periodLabel(period, interval, offset)
}
