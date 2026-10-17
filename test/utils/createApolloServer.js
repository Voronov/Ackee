import { expressMiddleware } from '@as-integrations/express5'
import test from 'ava'
import express from 'express'
import gql from 'graphql-tag'
import http from 'node:http'
import listen from 'test-listen'

import createApolloServer from '../../src/utils/createApolloServer.js'
import { job as saltJob } from '../../src/utils/salt.js'

// The resolvers start the daily salt job, which would keep the test process alive.
test.after.always(() => saltJob.cancel())

// A real Express server with the same Apollo setup, and a context that asks for two cookies.
const serve = async (cookies) => {
  const apollo = createApolloServer()
  await apollo.start()

  const app = express()
  app.use(
    '/api',
    express.json(),
    expressMiddleware(apollo, { context: () => Promise.resolve({ setCookies: cookies, setHeaders: [] }) }),
  )

  const server = http.createServer(app)
  const url = await listen(server)

  // Keep-alive connections from fetch would hold the server open past the test.
  const close = () => {
    server.closeAllConnections()
    return Promise.all([apollo.stop(), new Promise((resolve) => server.close(resolve))])
  }

  return { url, close }
}

const ask = (url) =>
  fetch(`${url}/api`, {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: gql`
        {
          __typename
        }
      `.loc.source.body,
    }),
  })

test('two cookies give two Set-Cookie headers', async (t) => {
  const { url, close } = await serve([
    'first=1; Path=/',
    { name: 'second', value: '2', options: { path: '/', httpOnly: true } },
  ])

  const response = await ask(url)
  await close()

  t.deepEqual(response.headers.getSetCookie(), ['first=1; Path=/', 'second=2; Path=/; HttpOnly'])
})

test('no cookies, no Set-Cookie header', async (t) => {
  const { url, close } = await serve([])

  const response = await ask(url)
  await close()

  t.deepEqual(response.headers.getSetCookie(), [])
})
