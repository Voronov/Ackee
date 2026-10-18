import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'

import identifier from '../../src/utils/identifier.js'
import { job } from '../../src/utils/salt.js'

test.after.always(() => {
  job.cancel()
})

test('return different identifiers', async (t) => {
  const domainId = uuid()

  const request = () => ({
    headers: {
      'user-agent': uuid(),
    },
    connection: {
      remoteAddress: uuid(),
    },
  })

  const requestA = request()
  const requestB = request()

  const a = await identifier(requestA, requestA.headers['user-agent'], domainId)
  const b = await identifier(requestB, requestB.headers['user-agent'], domainId)

  t.not(a, b)
})

test('return same identifiers', async (t) => {
  const domainId = uuid()

  const request = {
    headers: {
      'user-agent': uuid(),
    },
    connection: {
      remoteAddress: uuid(),
    },
  }

  const a = await identifier(request, request.headers['user-agent'], domainId)
  const b = await identifier(request, request.headers['user-agent'], domainId)

  t.is(a, b)
})
