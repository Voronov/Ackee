import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'
import listen from 'test-listen'

import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

const defaultTitle = uuid()
const defaultType = 'TOTAL_CHART'
const updatedTitle = uuid()
const updatedType = 'TOTAL_LIST'

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test.serial('create event', async (t) => {
  const body = {
    query: gql`
      mutation createEvent($input: CreateEventInput!) {
        createEvent(input: $input) {
          success
          payload {
            id
            title
            type
          }
        }
      }
    `,
    variables: {
      input: {
        title: defaultTitle,
        type: defaultType,
      },
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.true(json.data.createEvent.success)
  t.is(typeof json.data.createEvent.payload.id, 'string')
  t.is(json.data.createEvent.payload.title, defaultTitle)
  t.is(json.data.createEvent.payload.type, defaultType)

  // Save event for the next test
})

test.serial('update event', async (t) => {
  const body = {
    query: gql`
      mutation updateEvent($id: ID!, $input: UpdateEventInput!) {
        updateEvent(id: $id, input: $input) {
          success
          payload {
            id
            title
            type
          }
        }
      }
    `,
    variables: {
      id: t.context.event.id,
      input: {
        title: updatedTitle,
        type: updatedType,
      },
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.true(json.data.updateEvent.success)
  t.is(json.data.updateEvent.payload.id, t.context.event.id)
  t.is(json.data.updateEvent.payload.title, updatedTitle)
  t.is(json.data.updateEvent.payload.type, updatedType)

  // Save event for the next test
})

test.serial('fetch events', async (t) => {
  const body = {
    query: gql`
      query fetchEvents {
        events {
          id
          title
          type
        }
      }
    `,
  }

  const { json } = await api(base, body, t.context.token.id)

  const events = json.data.events
  const event = events.find((event) => event.id === t.context.event.id)

  t.is(event.title, t.context.event.title)
  t.is(event.type, t.context.event.type)
})

test.serial('fetch event', async (t) => {
  const body = {
    query: gql`
      query fetchEvent($id: ID!) {
        event(id: $id) {
          id
          title
          type
        }
      }
    `,
    variables: {
      id: t.context.event.id,
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.is(json.data.event.id, t.context.event.id)
  t.is(json.data.event.title, t.context.event.title)
  t.is(json.data.event.type, t.context.event.type)
})

test.serial('delete event', async (t) => {
  const body = {
    query: gql`
      mutation deleteEvent($id: ID!) {
        deleteEvent(id: $id) {
          success
        }
      }
    `,
    variables: {
      id: t.context.event.id,
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.true(json.data.deleteEvent.success)
})
