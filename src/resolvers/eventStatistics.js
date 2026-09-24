import { getEventStore } from '../stores/index.js'
import requireAuth from '../middlewares/requireAuth.js'
import pipe from '../utils/pipe.js'

export default {
  EventStatistics: {
    id: pipe(requireAuth, (event) => {
      return event.id
    }),
    chart: pipe(requireAuth, (event, { type, interval, limit }, { dateDetails }) => {
      const ids = [event.id]
      return getEventStore().actionsChart(ids, type, interval, limit, dateDetails)
    }),
    list: pipe(requireAuth, (event, { sorting, type, range, limit }, { dateDetails }) => {
      const ids = [event.id]
      return getEventStore().actionsList(ids, sorting, type, range, limit, dateDetails)
    }),
  },
}
