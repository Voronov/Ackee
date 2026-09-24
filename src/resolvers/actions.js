import * as actions from '../database/actions.js'
import { enqueue } from '../queue/redis.js'
import { getEventStore } from '../stores/index.js'
import { usesQueue } from '../utils/config.js'
import { actionsCreated } from '../utils/metrics.js'
import * as events from '../database/events.js'
import KnownError from '../utils/KnownError.js'
import messages from '../utils/messages.js'

const polish = (obj) => {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    value = typeof value === 'string' ? value.trim() : value
    value = value == null ? undefined : value
    value = value === '' ? undefined : value

    acc[key] = value
    return acc
  }, {})
}

export default {
  Mutation: {
    createAction: async (parent, { eventId, input }, { isIgnored }) => {
      // Ignore your own actions when logged in
      if (isIgnored === true) {
        return {
          success: true,
          payload: {
            id: '88888888-8888-8888-8888-888888888888',
          },
        }
      }

      const data = polish({ ...input, eventId })

      // Recording an action is unauthenticated, like tracking a page view, so the event
      // is looked up without a workspace filter.
      const event = await events.getUnscoped(eventId)

      if (event == null) throw new KnownError('Unknown event')

      // With the queue the tracker gets the same answer, but from the validated, not yet
      // saved action: the worker creates it later with this id and these dates
      if (usesQueue() === true) {
        let validated

        try {
          validated = await actions.validate(data)
        } catch (error) {
          if (error.name === 'ValidationError') {
            throw new KnownError(messages(error.errors))
          }

          throw error
        }

        await enqueue('action.create', { ...data, ...validated })
        actionsCreated.inc()

        return {
          success: true,
          payload: validated,
        }
      }

      let entry

      try {
        entry = await getEventStore().addAction(data)
      } catch (error) {
        if (error.name === 'ValidationError') {
          throw new KnownError(messages(error.errors))
        }

        throw error
      }

      actionsCreated.inc()

      return {
        success: true,
        payload: entry,
      }
    },
    updateAction: async (parent, { id, input }, { isIgnored }) => {
      // Ignore your own actions when logged in
      if (isIgnored === true) {
        return {
          success: true,
        }
      }

      if (usesQueue() === true) {
        await enqueue('action.touch', { id, ...input, updated: Date.now() })

        return {
          success: true,
        }
      }

      let entry

      try {
        entry = await getEventStore().touchAction(id, input)
      } catch (error) {
        if (error.name === 'ValidationError') {
          throw new KnownError(messages(error.errors))
        }

        throw error
      }

      if (entry == null) {
        throw new KnownError('Unknown action')
      }

      return {
        success: true,
      }
    },
  },
}
