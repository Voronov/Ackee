import test from 'ava'
import mockedEnv from 'mocked-env'
import net from 'node:net'

import { check, send } from '../../src/utils/mailer.js'

// Just enough SMTP to accept one message, like Mailpit: no TLS, no login.
const listen = () =>
  new Promise((resolve) => {
    const received = []

    const server = net.createServer((socket) => {
      let data = false

      socket.write('220 test ESMTP\r\n')
      socket.on('data', (chunk) => {
        for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
          if (data) {
            if (line === '.') {
              data = false
              socket.write('250 OK\r\n')
            } else {
              received.push(line)
            }
          } else if (/^(EHLO|HELO)/i.test(line)) {
            socket.write('250 test\r\n')
          } else if (/^DATA/i.test(line)) {
            data = true
            socket.write('354 go ahead\r\n')
          } else if (/^QUIT/i.test(line)) {
            socket.end('221 bye\r\n')
          } else {
            socket.write('250 OK\r\n')
          }
        }
      })
    })

    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }))
  })

test('an email reaches an SMTP server without TLS or a login', async (t) => {
  const { server, port, received } = await listen()
  const restore = mockedEnv({
    ACKEE_SMTP_HOST: '127.0.0.1',
    ACKEE_SMTP_PORT: String(port),
    ACKEE_SMTP_USER: undefined,
    ACKEE_SMTP_FROM: 'ackee@localhost',
  })

  t.true(await check())
  t.true(await send({ to: 'someone@example.com', subject: 'Delivered', text: 'Hello' }))

  restore()
  server.close()

  t.true(received.includes('Subject: Delivered'))
})
