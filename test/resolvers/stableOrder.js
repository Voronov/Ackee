import test from 'ava'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import Action from '../../src/models/Action.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { day } from '../../src/utils/times.js'
import { getStats as getDomainStats } from './domainStatistics/_utils.js'
import { getStats as getEventStats } from './eventStatistics/_utils.js'
import { cleanup, connectToDatabase } from './_utils.js'

const base = listen(server)

const now = Date.now()

// Documents are inserted out of the order the reports return them, so a report that
// relies on the order it reads documents in gets a different list.
const browsers = [
  ['C', now],
  ['A', now],
  ['Z', now],
  ['B', now],
  ['Z', now],
  ['C', now],
  ['A', now],
  ['Z', now],
  ['B', now],
]

// "Late" was seen 1 and 5 days ago, its newest record comes first. "Mid" only 3 days ago.
// "Tie B" and "Tie A" were first seen at the same moment.
const firstSeen = [
  ['Late', now - day],
  ['Late', now - 5 * day],
  ['Mid', now - 3 * day],
  ['Tie B', now - 4 * day],
  ['Tie A', now - 4 * day],
]

const record =
  (domainId) =>
  ([browserName, created]) => ({
    domainId,
    siteLocation: 'https://example.com/',
    browserName,
    created,
    updated: created,
  })

const action =
  (eventId) =>
  ([key, created]) => ({ eventId, key, value: 1, created, updated: created })

test.before(connectToDatabase)
test.after.always(cleanup(server))

test.before(async (t) => {
  const { user, workspace } = await users.add({
    email: 'stable-order@example.com',
    password: 'sufficiently-long',
    verified: true,
    workspaceTitle: 'Stable order',
  })

  const ties = await Domain.create({ title: 'ties.example.com', workspaceId: workspace.id })
  const seen = await Domain.create({ title: 'seen.example.com', workspaceId: workspace.id })
  const event = await Event.create({ title: 'Ties', type: 'TOTAL_CHART', workspaceId: workspace.id })
  const seenEvent = await Event.create({ title: 'Seen', type: 'TOTAL_CHART', workspaceId: workspace.id })

  await Record.insertMany(browsers.map(record(ties.id)))
  await Record.insertMany(firstSeen.map(record(seen.id)))
  await Action.insertMany(browsers.map(action(event.id)))
  await Action.insertMany(firstSeen.map(action(seenEvent.id)))

  Object.assign(t.context, {
    token: await Token.create({ userId: user.id }),
    ties,
    seen,
    event,
    seenEvent,
  })
})

const browsersOf = async (t, domain, sorting, limit = 14) => {
  const statistics = await getDomainStats({
    base,
    token: t.context.token.id,
    domainId: domain.id,
    fragment: `browsers(sorting: ${sorting}, type: NO_VERSION, range: LAST_30_DAYS, limit: ${limit}) { value count created }`,
  })
  return statistics.browsers
}

const listOf = async (t, event, sorting, limit = 14) => {
  const statistics = await getEventStats({
    base,
    token: t.context.token.id,
    eventId: event.id,
    fragment: `list(sorting: ${sorting}, type: TOTAL, range: LAST_30_DAYS, limit: ${limit}) { value count created }`,
  })
  return statistics.list
}

const values = (entries) => entries.map((entry) => entry.value)

test('two identical TOP requests return the same order', async (t) => {
  const first = await browsersOf(t, t.context.ties, 'TOP')
  const second = await browsersOf(t, t.context.ties, 'TOP')

  t.deepEqual(first, second)
})

test('TOP breaks ties by value', async (t) => {
  t.deepEqual(values(await browsersOf(t, t.context.ties, 'TOP')), ['Z', 'A', 'B', 'C'])
})

test('TOP keeps the same entries when the limit cuts through a tie', async (t) => {
  t.deepEqual(values(await browsersOf(t, t.context.ties, 'TOP', 2)), ['Z', 'A'])
  t.deepEqual(values(await browsersOf(t, t.context.ties, 'TOP', 2)), ['Z', 'A'])
})

test('NEW orders by when an entry was first seen', async (t) => {
  const entries = await browsersOf(t, t.context.seen, 'NEW')

  t.deepEqual(values(entries), ['Mid', 'Tie A', 'Tie B', 'Late'])
  t.is(new Date(entries.at(-1).created).getTime(), now - 5 * day)
})

test('two identical NEW requests return the same order', async (t) => {
  t.deepEqual(await browsersOf(t, t.context.seen, 'NEW'), await browsersOf(t, t.context.seen, 'NEW'))
})

test('two identical TOP requests for events return the same order', async (t) => {
  const first = await listOf(t, t.context.event, 'TOP')

  t.deepEqual(values(first), ['Z', 'A', 'B', 'C'])
  t.deepEqual(first, await listOf(t, t.context.event, 'TOP'))
})

test('NEW for events orders by when a key was first seen', async (t) => {
  const entries = await listOf(t, t.context.seenEvent, 'NEW')

  t.deepEqual(values(entries), ['Mid', 'Tie A', 'Tie B', 'Late'])
  t.is(new Date(entries.at(-1).created).getTime(), now - 5 * day)
  t.deepEqual(entries, await listOf(t, t.context.seenEvent, 'NEW'))
})
