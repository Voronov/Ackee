import test from 'ava'
import mockedEnv from 'mocked-env'

import * as clientIp from '../../src/utils/clientIp.js'

const express = (forwardedFor, extra = {}) => ({
  headers: { 'x-forwarded-for': forwardedFor, ...extra },
  socket: { remoteAddress: '10.0.0.1' },
})

test.serial('reads the socket and ignores client headers without ACKEE_TRUST_PROXY', (t) => {
  const restore = mockedEnv({ ACKEE_TRUST_PROXY: undefined })

  t.is(clientIp.ofExpress(express('1.2.3.4', { 'x-client-ip': '5.6.7.8', 'cf-connecting-ip': '9.9.9.9' })), '10.0.0.1')

  restore()
})

test.serial('trusts only the entries added by the given number of proxies', (t) => {
  const restore = mockedEnv({ ACKEE_TRUST_PROXY: '1' })

  // The client wrote 1.2.3.4 itself, our proxy appended the real address 203.0.113.5
  t.is(clientIp.ofExpress(express('1.2.3.4, 203.0.113.5')), '203.0.113.5')
  t.is(clientIp.ofExpress(express()), '10.0.0.1')

  restore()
})

test.serial('takes the entry the platform appended in a serverless function', (t) => {
  const restore = mockedEnv({ ACKEE_TRUST_PROXY: undefined })

  t.is(
    clientIp.ofFetch(new Request('https://x.test', { headers: { 'X-Forwarded-For': '1.2.3.4, 198.51.100.2' } })),
    '198.51.100.2',
  )
  t.is(clientIp.ofFetch(new Request('https://x.test', { headers: { 'X-Real-IP': '198.51.100.3' } })), '198.51.100.3')

  restore()
})
