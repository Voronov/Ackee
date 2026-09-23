import test from 'ava'
import { load as parseYaml } from 'js-yaml'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve(import.meta.dirname, '../.github/workflows')

const load = async (filename) => parseYaml(await readFile(path.join(directory, filename), 'utf8'))

test('every workflow is valid YAML with jobs', async (t) => {
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith('.yml'))

  t.true(filenames.includes('test.yml'))

  for (const filename of filenames) {
    const workflow = await load(filename)

    t.is(typeof workflow.name, 'string', filename)
    t.true(Object.keys(workflow.jobs).length > 0, filename)
  }
})

test('the unit job runs the suite on both supported Node versions', async (t) => {
  const { jobs } = await load('test.yml')

  t.deepEqual(jobs.test.strategy.matrix['node-version'], ['24.x', '26.x'])
  t.true(jobs.test.steps.some((step) => step.run?.trim() === 'npm test'))
})

// The integration suites skip themselves when ClickHouse and Redis are not configured, so
// without this job they would quietly never run — and they are the ones that prove the
// store returns the same numbers as MongoDB.
test('the integration job provides both services and runs test:ch', async (t) => {
  const { jobs } = await load('test.yml')
  const services = jobs.clickhouse.services

  t.deepEqual(Object.keys(services).toSorted(), ['clickhouse', 'redis'])
  t.true(services.clickhouse.image.startsWith('clickhouse/clickhouse-server'))
  t.true(services.redis.image.startsWith('redis'))
  t.deepEqual(services.clickhouse.ports, ['8123:8123'])
  t.deepEqual(services.redis.ports, ['6379:6379'])

  const step = jobs.clickhouse.steps.find((entry) => entry.run?.trim() === 'npm run test:ch')

  t.truthy(step)
  t.is(step.env.ACKEE_CLICKHOUSE, 'http://127.0.0.1:8123')
  t.is(step.env.ACKEE_REDIS_URL, 'redis://127.0.0.1:6379')
})

test('the compose file offers the same two services for local runs', async (t) => {
  const compose = parseYaml(await readFile(path.resolve(import.meta.dirname, '../docker-compose.dev.yml'), 'utf8'))

  t.true(compose.services.clickhouse.image.startsWith('clickhouse/clickhouse-server'))
  t.true(compose.services.redis.image.startsWith('redis'))
})
