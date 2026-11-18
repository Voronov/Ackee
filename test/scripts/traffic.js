import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import test from 'ava'

const script = path.resolve('deploy/ackee-traffic')

const events = [
  { id: 'event-cart', title: 'Add to cart' },
  { id: 'event-steps', title: 'Checkout steps' },
  { id: 'event-order', title: 'Order value' },
  { id: 'event-read', title: 'Read time by article' },
]
const countries = ['UA', 'PL', 'DE', 'US', 'GB', 'NL', 'FR', 'CZ', 'IT', 'CA', 'LT', 'MD', 'ES', 'SE', 'AT']
const pool = Object.fromEntries(countries.map((code, index) => [code, [`203.0.${index}.1`, `203.0.${index}.2`]]))

// Stands in for docker: the domain from mongosh, addresses from the geo database, mongoimport into a file
const testDomain = { id: 'domain-1', key: 'key-1', events }

const stand = (domain) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ackee-traffic-'))
  const bin = path.join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(path.join(root, 'domain'), JSON.stringify(domain))
  writeFileSync(path.join(root, 'pool'), JSON.stringify(pool))
  writeFileSync(
    path.join(bin, 'docker'),
    [
      '#!/bin/sh',
      `root='${root}'`,
      'case "$*" in',
      '  *mongoimport*records*) cat > "$root/records.jsonl" ;;',
      '  *mongoimport*actions*) cat > "$root/actions.jsonl" ;;',
      '  *mongosh*) cat "$root/domain" ;;',
      '  *node*) cat "$root/pool" ;;',
      'esac',
      '',
    ].join('\n'),
  )
  chmodSync(path.join(bin, 'docker'), 0o755)
  return { root, bin }
}

// Stands in for the API of a stand and keeps every request
const api = async () => {
  const requests = []
  let next = 0
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const { query, variables } = JSON.parse(body)
      requests.push({ headers: request.headers, query, variables })
      let data = { updateRecord: { success: true } }
      if (query.includes('createRecord')) data = { createRecord: { payload: { id: `record-${++next}` } } }
      if (query.includes('createAction')) data = { createAction: { payload: { id: `action-${++next}` } } }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { requests, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

const run = ({ root, bin }, args = [], environment = {}) =>
  new Promise((resolve) => {
    const child = spawn('python3', [script, ...args], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ACKEE_TRAFFIC_STATE: path.join(root, 'state', 'state.json'),
        ACKEE_TRAFFIC_SEED: '7',
        ...environment,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })

const lines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

test('a minute sends views of the test domain the way the tracker does', async (t) => {
  const server = await api()
  const paths = stand(testDomain)
  const { status, stdout } = await run(paths, [], { ACKEE_TRAFFIC_URL: server.url, ACKEE_TRAFFIC_RATE: '200' })
  server.close()

  t.is(status, 0)
  t.regex(stdout, /live: \+\d+ visits/)
  const views = server.requests.filter((request) => request.query.includes('createRecord'))
  t.true(views.length > 0)
  for (const view of views) {
    t.is(view.variables.id, 'domain-1.key-1')
    t.is(view.headers.origin, 'https://northwind-coffee.example')
    t.true(Object.values(pool).flat().includes(view.headers['x-forwarded-for']))
    t.true(view.variables.input.siteLocation.startsWith('https://northwind-coffee.example/'))
  }
  t.false(stdout.includes('dev:'))
})

test('the next minute keeps the open visits alive and drops the ended ones', async (t) => {
  const server = await api()
  const paths = stand(testDomain)
  await run(paths, [], { ACKEE_TRAFFIC_URL: server.url, ACKEE_TRAFFIC_RATE: '50' })
  const opened = JSON.parse(readFileSync(path.join(paths.root, 'state', 'state.json'), 'utf8')).live

  await run(paths, [], { ACKEE_TRAFFIC_URL: server.url, ACKEE_TRAFFIC_RATE: '0' })
  server.close()

  const updates = server.requests.filter((request) => request.query.includes('updateRecord'))
  t.deepEqual(updates.map((request) => request.variables.id).toSorted(), opened.map((visit) => visit.id).toSorted())
  const left = JSON.parse(readFileSync(path.join(paths.root, 'state', 'state.json'), 'utf8')).live
  t.true(left.every((visit) => visit.ends > Date.now() / 1000 - 60))
})

test('events go only to the events the workspace has', async (t) => {
  const server = await api()
  const { status } = await run(stand(testDomain), [], { ACKEE_TRAFFIC_URL: server.url, ACKEE_TRAFFIC_RATE: '400' })
  server.close()

  t.is(status, 0)
  const sent = server.requests.filter((request) => request.query.includes('createAction'))
  t.true(sent.length > 0)
  t.true(sent.every((request) => events.some((event) => event.id === request.variables.id)))
})

test('a stand without the test domain gets nothing', async (t) => {
  const server = await api()
  const { status, stdout } = await run(stand(null), [], { ACKEE_TRAFFIC_URL: server.url })
  server.close()

  t.is(status, 0)
  t.regex(stdout, /no stand or no domain northwind-coffee\.example/)
  t.is(server.requests.length, 0)
})

test('backfill writes records as the API stores them, with older views anonymized', async (t) => {
  const paths = stand(testDomain)
  const { status, stdout } = await run(paths, ['backfill', '2026-11-10T00:00:00', '2026-11-11T00:00:00'], {
    ACKEE_TRAFFIC_RATE: '20',
  })

  t.is(status, 0, stdout)
  const records = lines(path.join(paths.root, 'records.jsonl'))
  t.true(records.length > 1000)
  for (const record of records) {
    t.is(record.domainId, 'domain-1')
    t.false(record.siteLocation.endsWith('/'))
    t.false(record.siteLocation.includes('?'))
    t.regex(record.created.$date, /^2026-11-10T/)
  }
  const anonymized = records.filter((record) => record.clientId === null)
  t.true(anonymized.length > 0)
  t.true(
    anonymized.every((record) => record.country === null && record.osName === null && record.siteLanguage === null),
  )
  // Each visitor of a day keeps one record with its details
  const kept = records.filter((record) => record.clientId !== null).map((record) => record.clientId)
  t.is(new Set(kept).size, kept.length)
  t.true(
    lines(path.join(paths.root, 'actions.jsonl')).every((action) =>
      events.some((event) => event.id === action.eventId),
    ),
  )
})
