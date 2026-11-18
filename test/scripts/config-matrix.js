import test from 'ava'

import {
  buildMatrix,
  documentedVariables,
  isSecret,
  maskValue,
  parseEnv,
  readWhy,
  render,
} from '../../scripts/config-matrix.js'

// Made-up values that must never reach the output
const PASSWORD = 'hunter2-not-a-real-password'
const KEY = 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0'

test('secret-like names are recognised', (t) => {
  for (const name of [
    'ACKEE_PASSWORD',
    'ACKEE_SMTP_PASSWORD',
    'ACKEE_SECRET_KEY',
    'ACKEE_METRICS_TOKEN',
    'ACKEE_GOOGLE_CLIENT_SECRET',
    'ACKEE_GOOGLE_CLIENT_ID',
    'ACKEE_USERNAME',
    'ACKEE_SMTP_USER',
  ]) {
    t.true(isSecret(name), name)
  }

  for (const name of ['ACKEE_URL', 'ACKEE_TRUST_PROXY', 'ACKEE_INGEST_QUEUE', 'ACKEE_AUTO_ORIGIN']) {
    t.false(isSecret(name), name)
  }
})

test('a secret value is only reported as set', (t) => {
  t.is(maskValue('ACKEE_PASSWORD', PASSWORD), 'set')
  t.is(maskValue('ACKEE_PASSWORD', ''), 'empty')
  t.is(maskValue('ACKEE_PASSWORD'), 'not set')
})

test('credentials and keys under a harmless name are masked too', (t) => {
  t.is(maskValue('ACKEE_MONGODB', `mongodb://ackee:${PASSWORD}@mongo:27017/ackee`), 'set (URI with credentials)')
  t.is(maskValue('ACKEE_INGEST_QUEUE', `redis://:${PASSWORD}@redis:6379`), 'set (URI with credentials)')
  t.is(maskValue('ACKEE_SOMETHING', KEY), 'set (looks like a key)')
})

test('a harmless value is shown, with pipes escaped for the table', (t) => {
  t.is(maskValue('ACKEE_MONGODB', 'mongodb://mongo:27017/ackee_dev'), '`mongodb://mongo:27017/ackee_dev`')
  t.is(maskValue('ACKEE_GA4_SYNC_SCHEDULE', '*/10 * * * *'), '`*/10 * * * *`')
  t.is(maskValue('ACKEE_TRACKER', 'a|b'), '`a\\|b`')
})

test('env is read from docker inspect and from an env file', (t) => {
  const inspect = parseEnv('["ACKEE_URL=https://a.example","ACKEE_SMTP_FROM=Ackee <a=b@example.com>"]\n')
  t.is(inspect.get('ACKEE_URL'), 'https://a.example')
  t.is(inspect.get('ACKEE_SMTP_FROM'), 'Ackee <a=b@example.com>')

  const file = parseEnv("# comment\nACKEE_TTL=1000\nexport ACKEE_DEMO='true'\nnot a variable\n")
  t.deepEqual(
    [...file],
    [
      ['ACKEE_TTL', '1000'],
      ['ACKEE_DEMO', 'true'],
    ],
  )
})

test('documented variables come from the code blocks of Options.md', (t) => {
  const markdown = '# Options\n\nACKEE_PROSE=1\n\n```\nACKEE_PORT=3000\nPORT=3000\n```\n\n```graphql\nmutation\n```\n'
  t.deepEqual([...documentedVariables(markdown)], ['ACKEE_PORT', 'PORT'])
})

const matrix = () =>
  buildMatrix({
    documented: new Set(['ACKEE_GEO', 'ACKEE_PASSWORD', 'ACKEE_TRUST_PROXY', 'ACKEE_URL']),
    stands: new Map([
      ['local', new Map([['ACKEE_URL', 'http://localhost:3000']])],
      [
        'dev',
        new Map([
          ['ACKEE_URL', 'https://dev.example'],
          ['ACKEE_PASSWORD', PASSWORD],
          ['ACKEE_TRUST_PROXY', '1'],
          ['ACKEE_BUILD', 'sha-1'],
          ['PATH', '/usr/bin'],
        ]),
      ],
      [
        'live',
        new Map([
          ['ACKEE_URL', 'https://live.example'],
          ['ACKEE_PASSWORD', PASSWORD],
          ['ACKEE_TRUST_PROXY', '1'],
        ]),
      ],
    ]),
  })

test('unknown and unset variables are flagged', (t) => {
  const { rows, platform } = matrix()
  const status = Object.fromEntries(rows.map((row) => [row.name, row.status]))

  t.is(status.ACKEE_BUILD, 'unknown')
  t.is(status.ACKEE_GEO, 'set nowhere')
  t.is(status.ACKEE_URL, 'differs')
  t.is(status.ACKEE_TRUST_PROXY, 'differs (dev = live)')
  t.deepEqual(platform, ['PATH'])
  t.false(rows.some((row) => row.name === 'PATH'))
})

test('a secret shared by two stands is reported without its value', (t) => {
  const row = matrix().rows.find((entry) => entry.name === 'ACKEE_PASSWORD')

  t.deepEqual(row.cells, ['not set', 'set', 'set, same as dev'])
  t.is(row.status, 'differs (dev = live)')
})

test('the rendered table keeps the hand-written why and no secret', (t) => {
  const why = readWhy(
    '| `ACKEE_URL`   | x | y | z | differs | Own address per stand |\n| `ACKEE_GEO` | - | - | - | set nowhere |  |\n',
  )
  t.is(why.get('ACKEE_URL'), 'Own address per stand')
  t.is(why.get('ACKEE_GEO'), '')

  const text = render(matrix(), ['local', 'dev', 'live'], why)
  t.true(
    text.includes(
      '| `ACKEE_URL` | `http://localhost:3000` | `https://dev.example` | `https://live.example` | differs | Own address per stand |',
    ),
  )
  t.true(text.includes('Not in Options.md: `ACKEE_BUILD`.'))
  t.true(text.includes('Documented but set nowhere: `ACKEE_GEO`.'))
  t.true(text.includes('Set by the image, not compared: `PATH`.'))
  t.false(text.includes(PASSWORD))
})
