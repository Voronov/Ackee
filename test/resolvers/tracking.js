import test from 'ava'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import AuditLog from '../../src/models/AuditLog.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

const account = async (email) => {
  const { user, workspace } = await users.add({ email, password: 'sufficiently-long' })
  const token = await Token.create({ userId: user.id })
  const domain = await Domain.create({ title: 'shop.example.com', workspaceId: workspace.id, ingestKey: 'the-key' })

  return { user, workspace, domain, call: (query, variables) => api(base, { query, variables }, token.id) }
}

const fields = gql`
  {
    gtmId
    outbound
    downloads
    downloadExtensions
    scroll
    vitals
    rules {
      id
      type
      selector
      label
      path
    }
    events {
      clicks
      seen
      forms
      outbound
      downloads
      scroll
      vitals
    }
  }
`

const save = (call, id, input) =>
  call(
    gql`
      mutation updateDomainTracking($id: ID!, $input: DomainTrackingInput!) {
        updateDomainTracking(id: $id, input: $input) {
          payload ${fields}
        }
      }
    `,
    { id, input },
  )

const read = async (call, id) => {
  const { json } = await call(
    gql`
      query domain($id: ID!) {
        domain(id: $id) {
          tracking ${fields}
        }
      }
    `,
    { id },
  )
  return json.data.domain.tracking
}

const get = async (path) => {
  const response = await fetch(new URL(path, await base).href)
  return { status: response.status, headers: response.headers, body: await response.text() }
}

const rules = [
  { type: 'CLICK', selector: '#buy', label: 'Buy button' },
  { type: 'VISIBLE', selector: '.pricing', label: 'Pricing', path: '/product/*' },
]

test('a domain collects nothing extra until the owner switches it on', async (t) => {
  const { call, domain } = await account('tracking-1@example.com')
  const tracking = await read(call, domain.id)

  t.like(tracking, { gtmId: '', outbound: false, downloads: false, scroll: false, vitals: false, rules: [] })
  t.true(tracking.downloadExtensions.includes('pdf'))
  t.deepEqual(Object.values(tracking.events).filter(Boolean), [])
})

test('switching kinds on creates one event per kind in the workspace, once', async (t) => {
  const { call, domain, workspace, user } = await account('tracking-2@example.com')

  const { json } = await save(call, domain.id, { rules, outbound: true, vitals: true, gtmId: 'GTM-ABC1234' })
  const saved = json.data.updateDomainTracking.payload

  t.is(saved.gtmId, 'GTM-ABC1234')
  t.truthy(saved.rules[0].id)
  t.deepEqual(
    Object.entries(saved.events)
      .filter(([, id]) => id != null)
      .map(([kind]) => kind)
      .toSorted(),
    ['clicks', 'outbound', 'seen', 'vitals'],
  )

  const events = await Event.find({ workspaceId: workspace.id }).lean()
  t.deepEqual(events.map((event) => event.title).toSorted(), [
    'shop.example.com · Clicks',
    'shop.example.com · Outbound links',
    'shop.example.com · Seen',
    'shop.example.com · Web Vitals',
  ])
  t.is(events.find((event) => event.title.endsWith('Web Vitals')).type, 'AVERAGE_LIST')

  // Saving again keeps the events and the rule ids
  const again = (await save(call, domain.id, { rules: saved.rules, outbound: true, vitals: true })).json
  t.deepEqual(again.data.updateDomainTracking.payload.events, saved.events)
  t.is(again.data.updateDomainTracking.payload.rules[0].id, saved.rules[0].id)
  t.is(await Event.countDocuments({ workspaceId: workspace.id }), 4)

  // An event deleted by hand comes back
  await Event.deleteOne({ id: saved.events.clicks })
  const restored = (await save(call, domain.id, { rules: saved.rules })).json.data.updateDomainTracking.payload
  t.not(restored.events.clicks, saved.events.clicks)
  t.truthy(await Event.findOne({ id: restored.events.clicks }))

  t.true((await AuditLog.countDocuments({ userId: user.id, action: 'domain.tracking' })) >= 3)
})

test('settings that could break the page or the reports are refused', async (t) => {
  const { call, domain } = await account('tracking-3@example.com')
  const refused = async (input) => (await save(call, domain.id, input)).json.errors[0].message

  t.regex(await refused({ gtmId: 'UA-12345' }), /GTM-ABC1234/)
  t.regex(
    await refused({ rules: [{ type: 'CLICK', selector: '</script><script>alert(1)', label: 'x' }] }),
    /cannot contain/,
  )
  t.regex(await refused({ rules: [{ type: 'CLICK', selector: '  ', label: 'x' }] }), /selector/)
  t.regex(await refused({ rules: [{ type: 'CLICK', selector: '#a', label: '' }] }), /name/)
  t.regex(await refused({ rules: Array.from({ length: 51 }, () => rules[0]) }), /at most 50/i)
  t.regex(await refused({ downloadExtensions: ['.pdf'] }), /extension/)
  t.regex(await refused({ rules: [{ type: 'HOVER', selector: '#a', label: 'x' }] }), /HOVER/)
  t.regex(await refused({ rules: [{ type: 'CLICK', selector: '#a', label: 'x', path: 'product/*' }] }), /page/)
  t.regex(await refused({ rules: [{ type: 'CLICK', selector: '#a', label: 'x', path: '/a b' }] }), /page/)
})

test('only someone who manages the domain can change what it collects', async (t) => {
  const { domain } = await account('tracking-4@example.com')
  const stranger = await account('tracking-4b@example.com')

  const { json } = await save(stranger.call, domain.id, { outbound: true })
  t.regex(json.errors[0].message, /unknown domain/i)
  t.false((await Domain.findOne({ id: domain.id }).lean()).tracking?.outbound === true)
})

test('the snippet serves the tracker with the rules and the event ids', async (t) => {
  const { call, domain } = await account('tracking-5@example.com')
  const saved = (await save(call, domain.id, { rules, scroll: true })).json.data.updateDomainTracking.payload

  const { status, headers, body } = await get(`/t/${domain.id}.the-key.js`)

  t.is(status, 200)
  t.regex(headers.get('content-type'), /javascript/)
  t.regex(headers.get('cache-control'), /max-age=60/)
  t.true(body.includes('ackeeTracker'))
  t.true(body.includes(`"domainId":"${domain.id}.the-key"`))
  t.true(body.includes(`"clicks":"${saved.events.clicks}"`))
  t.true(body.includes('"selector":"#buy"'))
  // Several rules at once, each with its own page or every page
  t.true(body.includes('"label":"Pricing","path":"/product/*"'))
  t.true(body.includes('"label":"Buy button","path":""'))
  t.true(body.includes('"scroll":true'))
})

test('the snippet refuses a wrong key, and a missing one where the domain demands it', async (t) => {
  const { domain } = await account('tracking-6@example.com')

  t.is((await get(`/t/${domain.id}.wrong.js`)).status, 404)
  t.is((await get('/t/unknown-domain.js')).status, 404)
  t.is((await get('/t/../../etc/passwd')).status, 404)

  // Without the key while the domain is not strict: the plain id still works
  t.is((await get(`/t/${domain.id}.js`)).status, 200)
  await Domain.updateOne({ id: domain.id }, { $set: { strictIngest: true } })
  t.is((await get(`/t/${domain.id}.js`)).status, 404)
})

test('a label cannot end the script it is served in', async (t) => {
  const { call, domain } = await account('tracking-7@example.com')
  await save(call, domain.id, {
    rules: [{ type: 'CLICK', selector: '#a', label: '</script><img src=x onerror=alert(1)>' }],
  })

  const { body } = await get(`/t/${domain.id}.the-key.js`)

  t.false(body.toLowerCase().includes('</script'))
  t.true(body.includes(String.raw`\u003c/script>`))
})

test.serial('one address cannot load the snippet without end', async (t) => {
  const { domain } = await account('tracking-8@example.com')
  const from = { 'X-Forwarded-For': '203.0.113.25' }
  const statuses = []

  for (let index = 0; index < 1001; index++) {
    statuses.push((await fetch(new URL(`/t/${domain.id}.the-key.js`, await base).href, { headers: from })).status)
  }

  t.is(statuses.filter((status) => status === 200).length, 1000)
  t.is(statuses.at(-1), 429)
})

test('a forged Host header does not reach the script', async (t) => {
  const { domain } = await account('tracking-9@example.com')
  const response = await fetch(new URL(`/t/${domain.id}.the-key.js`, await base).href, {
    headers: { 'X-Forwarded-Host': 'evil.example.com"</script>' },
  })
  const body = await response.text()

  // The script reports to the server's own address, whatever the request claims
  t.is(JSON.parse(/"server":("[^"]*")/.exec(body)[1]), new URL(await base).origin)
})
