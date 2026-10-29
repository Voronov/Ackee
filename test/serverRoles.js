import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import Record from '../src/models/Record.js'
import server from '../src/server.js'
import { api } from './_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './resolvers/_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

const get = async (path, headers = {}) => fetch(new URL(path, await base), { headers })

const createRecord = (domainId) =>
  api(base, {
    query: gql`
      mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
        createRecord(domainId: $domainId, input: $input) {
          payload {
            id
          }
        }
      }
    `,
    variables: { domainId, input: { siteLocation: 'https://example.com/' } },
  })

const domains = (token) => api(base, { query: '{ domains { id } }' }, token)

test.serial('an ingest process serves the tracker and its views, and nothing else', async (t) => {
  const restore = mockedEnv({ ACKEE_ROLE: 'ingest', ACKEE_METRICS_TOKEN: 'secret' })

  // The tracker, the snippet with tracking rules, and the health check
  t.is((await get('/tracker.js')).status, 200)
  t.is((await get(`/t/${t.context.domain.id}.js`)).status, 200)
  const root = await get('/')
  t.is(root.status, 200)
  t.is(await root.text(), 'Ackee ingest')
  t.is((await get('/metrics', { Authorization: 'Bearer secret' })).status, 200)

  // The UI, the pages of email links and the live feed are not here
  for (const path of ['/index.js', '/index.html', '/verify?token=x', '/auth/google', '/api/live?domainId=x']) {
    t.is((await get(path)).status, 404, path)
  }

  // A view is taken, a report is refused with a clear answer
  const { json: view } = await createRecord(t.context.domain.id)
  t.is(view.errors, undefined)
  t.is(await Record.countDocuments({ id: view.data.createRecord.payload.id }), 1)

  const { json: report } = await domains(t.context.token.id)
  t.regex(report.errors[0].message, /views only/)
  t.is(report.data, undefined)

  restore()
})

test.serial('an api process serves everything the app needs', async (t) => {
  const restore = mockedEnv({ ACKEE_ROLE: 'api' })

  t.is((await get('/index.js')).status, 200)
  t.is((await get('/tracker.js')).status, 200)
  t.is((await domains(t.context.token.id)).json.errors, undefined)
  t.is((await createRecord(t.context.domain.id)).json.errors, undefined)

  restore()
})
