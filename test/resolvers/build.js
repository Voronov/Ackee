import test from 'ava'
import mockedEnv from 'mocked-env'
import { readFileSync } from 'node:fs'
import listen from 'test-listen'

import server from '../../src/server.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

// Without a token, as the smoke test after a deploy asks.
const ask = async () => {
  const url = new URL('/api', await base)
  const response = await fetch(url.href, {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: gql`
        query {
          build {
            id
            version
            database
          }
        }
      `,
    }),
  })

  return response.json()
}

test.serial('a stand tells which build it runs, without a token', async (t) => {
  const restore = mockedEnv({ ACKEE_BUILD: 'sha-1a2b3c4' })

  const json = await ask()

  restore()

  t.is(json.errors, undefined)
  t.deepEqual(json.data.build, { id: 'sha-1a2b3c4', version, database: true })
})

test.serial('outside CI the build is local', async (t) => {
  const restore = mockedEnv({ ACKEE_BUILD: undefined })

  t.is((await ask()).data.build.id, 'local')

  restore()
})
