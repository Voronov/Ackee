import test from 'ava'

import { defaults, parseOptions } from '../../scripts/migrate-to-clickhouse.js'
import { actionRow, recordRow } from '../../src/stores/clickhouse/index.js'

const now = Date.parse('2026-09-21T12:00:00.000Z')

test('parses options with defaults', (t) => {
  t.deepEqual(parseOptions([]), {
    batch: defaults.batch,
    from: undefined,
    reset: false,
    dryRun: false,
    stopAfter: undefined,
  })
})

test('parses options from arguments', (t) => {
  t.deepEqual(
    parseOptions(['--batch', '500', '--from', '2026-09-21T12:00:00.000Z', '--reset', '--dry-run', '--stop-after', '2']),
    {
      batch: 500,
      from: now,
      reset: true,
      dryRun: true,
      stopAfter: 2,
    },
  )
})

test('rejects invalid options', (t) => {
  t.throws(() => parseOptions(['--batch', '0']), { message: 'Option --batch must be a positive integer' })
  t.throws(() => parseOptions(['--batch', '10abc']), { message: 'Option --batch must be a positive integer' })
  t.throws(() => parseOptions(['--stop-after', 'two']), { message: 'Option --stop-after must be a positive integer' })
  t.throws(() => parseOptions(['--from', 'yesterday']), { message: 'Option --from must be a valid date' })
  t.throws(() => parseOptions(['--unknown']))
})

test('maps an anonymized record to an empty clientId, null fields and the given version', (t) => {
  const record = {
    id: 'record',
    clientId: null,
    domainId: 'domain',
    siteLocation: 'https://example.com/',
    siteReferrer: 'https://google.com/',
    siteLanguage: null,
    screenWidth: null,
    browserName: null,
    created: new Date(now),
    updated: new Date(now + 1000),
  }

  const row = recordRow(record, record.updated.getTime())

  t.is(row.clientId, '')
  t.is(row.siteLanguage, null)
  t.is(row.screenWidth, null)
  t.is(row.browserName, null)
  t.is(row.deviceName, null)
  t.is(row.siteReferrer, 'https://google.com/')
  t.is(row.created, '2026-09-21T12:00:00.000Z')
  t.is(row.updated, '2026-09-21T12:00:01.000Z')
  t.is(row.version, now + 1000)
})

test('versions rows with the clock when no version is given', (t) => {
  const before = Date.now()
  const record = recordRow({
    id: 'record',
    domainId: 'domain',
    siteLocation: 'https://example.com/',
    created: now,
    updated: now,
  })
  const action = actionRow({ id: 'action', eventId: 'event', created: now, updated: now })

  t.true(record.version >= before)
  t.true(action.version > record.version)
  t.is(action.key, null)
})
